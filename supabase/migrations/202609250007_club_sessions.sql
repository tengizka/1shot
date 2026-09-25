-- Deploy new functions and Desk >=1.1 before setting flow_version=2.
begin;
alter table public.club_settings add column flow_version integer not null default 1 check(flow_version in (1,2));
alter table public.club_worker add column protocol integer not null default 1;
alter table public.club_bookings add column protocol integer not null default 1;
alter table public.club_bookings add column for_friend boolean not null default false;
alter table public.club_bookings add column instant boolean not null default false;
alter table public.club_bookings drop constraint club_bookings_status_check;
alter table public.club_bookings add constraint club_bookings_status_check check(status in ('requested','waiting','holding','checkin_pending','in_session','attention','cancel_requested','release_requested','cancelled','expired','completed'));
create table public.club_accounts(
 telegram_id bigint primary key references public.profiles(telegram_id),gizmo_user_id integer not null,
 requested_at timestamptz not null default now(),updated_at timestamptz, data jsonb
);
create table public.club_commands(
 id uuid primary key default gen_random_uuid(),telegram_id bigint not null references public.profiles(telegram_id),gizmo_user_id integer not null,
 kind text not null check(kind in ('profile_edit','logout','password_request')),payload jsonb not null default '{}',
 status text not null default 'queued' check(status in ('queued','running','awaiting_admin','done','attention','rejected')),
 message text,request_id uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(telegram_id,request_id)
);
alter table public.club_accounts enable row level security;
alter table public.club_commands enable row level security;
revoke all on public.club_accounts,public.club_commands from public,anon,authenticated;
grant all on public.club_accounts,public.club_commands to service_role;
create function public.club_create_v2(p_user bigint,p_host text,p_mode text,p_kind text,p_start timestamptz,p_end timestamptz,p_request uuid,p_friend boolean)
returns public.club_bookings language plpgsql security definer set search_path=public as $$
declare b club_bookings;
begin
 perform pg_advisory_xact_lock(15837812);
 if not exists(select 1 from club_settings where enabled and flow_version=2) or not exists(select 1 from club_worker where protocol>=2 and lease_until>now()) then raise exception 'Обновлённая панель клуба пока не готова'; end if;
 select * into b from club_bookings where telegram_id=p_user and client_request_id=p_request;
 if found then return b; end if;
 if p_mode not in ('arrival','scheduled','instant') or p_mode='instant' and p_friend then raise exception 'Некорректный режим входа'; end if;
 if p_mode='scheduled' and p_kind not in ('range','open') then raise exception 'Выберите интервал или «Как пойдёт»'; end if;
 b:=club_create_booking(p_user,p_host,case when p_mode='instant' then 'arrival' else p_mode end,p_kind,p_start,p_end,p_request);
 update club_bookings set protocol=2,for_friend=p_friend,instant=(p_mode='instant'),hold_until=case when p_mode='instant' then starts_at+interval '5 minutes' else hold_until end where id=b.id returning * into b;
 return b;
end $$;
create or replace function public.club_cancel(p_user bigint,p_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from club_bookings where id=p_id and telegram_id=p_user and status in ('cancel_requested','cancelled')) then return true; end if;
 update club_bookings set status='cancel_requested',code_hash=null,updated_at=now()
 where id=p_id and telegram_id=p_user and status in ('requested','waiting','holding');
 return found;
end $$;
create function public.club_booking_action(p_user bigint,p_id uuid,p_action text) returns boolean language plpgsql security definer set search_path=public as $$
begin
 if p_action='cancel' then return club_cancel(p_user,p_id); end if;
 if p_action not in ('enter','release') then return false; end if;
 if not exists(select 1 from club_worker where protocol>=2 and lease_until>now()) then return false; end if;
 update club_bookings set status=case when p_action='enter' then 'checkin_pending' else 'release_requested' end,code_hash=null,updated_at=now()
 where id=p_id and telegram_id=p_user and protocol=2 and status='holding' and hold_until>now()
 and for_friend=(p_action='release');
 return found;
end $$;
create function public.club_account_request(p_user bigint) returns void language plpgsql security definer set search_path=public as $$
declare gid integer;
begin
 select gizmo_user_id into gid from profiles where telegram_id=p_user;
 if gid is null then raise exception 'Войдите в аккаунт клуба'; end if;
 insert into club_accounts(telegram_id,gizmo_user_id) values(p_user,gid)
 on conflict(telegram_id) do update set requested_at=now(),gizmo_user_id=excluded.gizmo_user_id,
 data=case when club_accounts.gizmo_user_id=excluded.gizmo_user_id then club_accounts.data else null end,
 updated_at=case when club_accounts.gizmo_user_id=excluded.gizmo_user_id then club_accounts.updated_at else null end;
end $$;
create function public.club_command(p_user bigint,p_kind text,p_payload jsonb,p_request uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare gid integer; cid uuid; cached club_accounts;
begin
 perform pg_advisory_xact_lock(15837812);
 if not exists(select 1 from club_settings where enabled and flow_version=2) or not exists(select 1 from club_worker where protocol>=2 and lease_until>now()) then raise exception 'Панель клуба не готова'; end if;
 select gizmo_user_id into gid from profiles where telegram_id=p_user;
 if gid is null then raise exception 'Войдите заново'; end if;
 select id into cid from club_commands where telegram_id=p_user and request_id=p_request;
 if found then return cid; end if;
 if exists(select 1 from club_commands where telegram_id=p_user and kind=p_kind and status in ('queued','running','awaiting_admin')) then raise exception 'Предыдущий запрос ещё обрабатывается'; end if;
 if p_kind not in ('profile_edit','logout','password_request') then raise exception 'Неизвестная операция'; end if;
 if p_kind='logout' then
  select * into cached from club_accounts where telegram_id=p_user and gizmo_user_id=gid and updated_at>now()-interval '30 seconds';
  if not found or cached.data->'session' is null or cached.data->'session'='null'::jsonb or cached.data->'session'->>'key' is distinct from p_payload->>'session_key' then raise exception 'Сессия изменилась. Обновите профиль'; end if;
  p_payload:=cached.data->'session';
 elsif p_kind='profile_edit' then
  if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('username','firstName','lastName','email','mobilePhone')) or jsonb_typeof(p_payload)<>'object' or length(p_payload::text)>2000 then raise exception 'Нельзя изменять эти поля'; end if;
  if (p_payload ? 'username') and (p_payload->>'username' !~ '^[A-Za-z0-9_.-]{3,30}$') then raise exception 'Логин: 3–30 латинских букв, цифр, точек, дефисов'; end if;
 else p_payload:='{}'; end if;
 insert into club_commands(telegram_id,gizmo_user_id,kind,payload,request_id,status)
 values(p_user,gid,p_kind,p_payload,p_request,case when p_kind='password_request' then 'awaiting_admin' else 'queued' end) returning id into cid;
 return cid;
end $$;
revoke all on function public.club_create_v2(bigint,text,text,text,timestamptz,timestamptz,uuid,boolean),public.club_booking_action(bigint,uuid,text),public.club_account_request(bigint),public.club_command(bigint,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.club_create_v2(bigint,text,text,text,timestamptz,timestamptz,uuid,boolean),public.club_booking_action(bigint,uuid,text),public.club_account_request(bigint),public.club_command(bigint,text,jsonb,uuid) to service_role;
create or replace function public.club_worker_lease(p_worker uuid) returns boolean language plpgsql security definer set search_path=public as $$
begin
 update club_worker set protocol=case when worker_id is distinct from p_worker then 1 else protocol end,worker_id=p_worker,lease_until=now()+interval '30 seconds'
 where id=true and (worker_id=p_worker or lease_until is null or lease_until<now());
 return found;
end $$;
-- release_requested remains unavailable until confirmed by the owning agent.
create or replace function public.club_create_booking(p_user bigint,p_host text,p_mode text,p_kind text,p_start timestamptz,p_end timestamptz,p_request uuid)
returns public.club_bookings language plpgsql security definer set search_path=public as $$
declare b public.club_bookings; h public.hosts_cache; gid integer; finish timestamptz; hold timestamptz;
begin
 perform pg_advisory_xact_lock(15837812);
 if not exists(select 1 from club_settings where enabled) then raise exception 'Новая система пока не включена администратором'; end if;
 select * into b from club_bookings where telegram_id=p_user and client_request_id=p_request;
 if found then return b; end if;
 if not exists(select 1 from club_worker where lease_until>now()) then raise exception 'Панель клуба не на связи. Позвоните администратору'; end if;
 select gizmo_user_id into gid from profiles where telegram_id=p_user;
 if gid is null or gid<=0 then raise exception 'Войдите в аккаунт клуба заново'; end if;
 select * into h from hosts_cache where host_id=p_host;
 if not found or h.updated_at is null or h.updated_at<now()-interval '30 seconds' or h.updated_at>now()+interval '30 seconds' then raise exception 'Нет свежих данных о компьютере'; end if;
 if p_host='1' or lower(h.zone)='ps5' then raise exception 'PS5 — только по телефону'; end if;
 if p_mode not in ('arrival','scheduled') or p_kind not in ('hour','range','open') then raise exception 'Некорректный вариант брони'; end if;
 if p_mode='arrival' then
  p_start:=now();finish:=p_start+interval '1 hour';p_kind:='hour';
  if h.status<>'free' then raise exception 'Компьютер сейчас недоступен'; end if;
 else
  if p_start is null or p_start<now() or (p_start at time zone 'Europe/Moscow')::date<>(now() at time zone 'Europe/Moscow')::date then raise exception 'Выберите будущее время сегодня по Москве'; end if;
  finish:=case when p_kind='hour' then p_start+interval '1 hour' when p_kind='open' then (((p_start at time zone 'Europe/Moscow')::date+1)::timestamp at time zone 'Europe/Moscow') else p_end end;
  if finish is null or finish<p_start+interval '15 minutes' or finish>((((p_start at time zone 'Europe/Moscow')::date+1)::timestamp) at time zone 'Europe/Moscow') then raise exception 'Интервал: от 15 минут до конца сегодняшнего дня'; end if;
  if h.status='broken' then raise exception 'Компьютер не работает'; end if;
 end if;
 hold:=least(p_start+interval '1 hour',finish);
 -- Unreleased/uncertain locks continue to consume availability, even past deadline.
 if (select count(*) from club_bookings where telegram_id=p_user and status not in ('cancelled','expired','completed'))>=2 then raise exception 'Максимум две активные брони. Больше — по телефону'; end if;
 if exists(select 1 from club_bookings where host_id=p_host and status not in ('cancelled','expired','completed')
  and (status in ('in_session','attention','cancel_requested','release_requested') or tstzrange(starts_at,ends_at,'[)') && tstzrange(p_start,finish,'[)'))) then raise exception 'Этот интервал уже занят или требует проверки администратора'; end if;
 if exists(select 1 from reservations where host_id=p_host and status in ('pending','confirmed') and created_at>now()-interval '1 hour') then raise exception 'На ПК ещё действует бронь старой системы'; end if;
 insert into club_bookings(telegram_id,gizmo_user_id,host_id,mode,duration_kind,starts_at,ends_at,hold_until,client_request_id)
 values(p_user,gid,p_host,p_mode,p_kind,p_start,finish,hold,p_request) returning * into b;
 insert into club_events(booking_id,kind) values(b.id,'created');
 return b;
end $$;
notify pgrst, 'reload schema';
commit;
