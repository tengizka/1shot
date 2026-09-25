-- Opt-in beta. Does not alter legacy reservations or create Gizmo reservations.
begin;
create table public.club_settings(id boolean primary key default true check(id),enabled boolean not null default false);
insert into public.club_settings(id,enabled) values(true,false);
create table public.club_worker(id boolean primary key default true check(id),worker_id uuid,lease_until timestamptz);
insert into public.club_worker(id) values(true);
create table public.club_bookings(
 id uuid primary key default gen_random_uuid(), telegram_id bigint not null references public.profiles(telegram_id),
 gizmo_user_id integer not null check(gizmo_user_id>0), host_id text not null,
 mode text not null check(mode in ('arrival','scheduled')),
 duration_kind text not null check(duration_kind in ('hour','range','open')),
 starts_at timestamptz not null, ends_at timestamptz not null, hold_until timestamptz not null,
 status text not null default 'requested' check(status in ('requested','waiting','holding','checkin_pending','in_session','attention','cancel_requested','cancelled','expired','completed')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 client_request_id uuid not null, message text, code_hash text, code_expires_at timestamptz, code_attempts integer not null default 0,
 unique(telegram_id,client_request_id),check(ends_at>starts_at),check(hold_until>starts_at)
);
create index on public.club_bookings(host_id,starts_at,ends_at);
create index on public.club_bookings(telegram_id,created_at);
create table public.club_events(id bigint generated always as identity primary key, booking_id uuid references public.club_bookings(id),kind text not null,created_at timestamptz not null default now());
alter table public.club_settings enable row level security;
alter table public.club_worker enable row level security;
alter table public.club_bookings enable row level security;
alter table public.club_events enable row level security;
revoke all on public.club_settings,public.club_worker,public.club_bookings,public.club_events from anon,authenticated;
grant all on public.club_settings,public.club_worker,public.club_bookings,public.club_events to service_role;
grant usage,select on sequence public.club_events_id_seq to service_role;

create function public.club_create_booking(p_user bigint,p_host text,p_mode text,p_kind text,p_start timestamptz,p_end timestamptz,p_request uuid)
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
  and (status in ('in_session','attention','cancel_requested') or tstzrange(starts_at,ends_at,'[)') && tstzrange(p_start,finish,'[)'))) then raise exception 'Этот интервал уже занят или требует проверки администратора'; end if;
 if exists(select 1 from reservations where host_id=p_host and status in ('pending','confirmed') and created_at>now()-interval '1 hour') then raise exception 'На ПК ещё действует бронь старой системы'; end if;
 insert into club_bookings(telegram_id,gizmo_user_id,host_id,mode,duration_kind,starts_at,ends_at,hold_until,client_request_id)
 values(p_user,gid,p_host,p_mode,p_kind,p_start,finish,hold,p_request) returning * into b;
 insert into club_events(booking_id,kind) values(b.id,'created');
 return b;
end $$;
create function public.club_checkin(p_user bigint,p_id uuid,p_hash text)
returns text language plpgsql security definer set search_path=public as $$
declare b public.club_bookings;
begin
 select * into b from club_bookings where id=p_id and telegram_id=p_user for update;
 if not found then return 'not_found'; end if;
 if b.status in ('checkin_pending','in_session') then return b.status; end if;
 if b.status<>'holding' or b.hold_until<=now() then return 'not_waiting'; end if;
 if b.code_attempts>=5 then return 'too_many_attempts'; end if;
 if b.code_hash is null or b.code_expires_at<=now() then return 'code_expired'; end if;
 update club_bookings set code_attempts=code_attempts+1 where id=p_id;
 if b.code_hash<>p_hash then return 'invalid_code'; end if;
 update club_bookings set status='checkin_pending',code_hash=null,updated_at=now() where id=p_id;
 insert into club_events(booking_id,kind) values(p_id,'checkin');
 return 'checkin_pending';
end $$;
create function public.club_cancel(p_user bigint,p_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
begin
 update club_bookings set status='cancel_requested',code_hash=null,updated_at=now()
 where id=p_id and telegram_id=p_user and status in ('requested','waiting','holding');
 return found;
end $$;
create function public.club_worker_lease(p_worker uuid) returns boolean language plpgsql security definer set search_path=public as $$
begin
 update club_worker set worker_id=p_worker,lease_until=now()+interval '30 seconds'
 where id=true and (worker_id=p_worker or lease_until is null or lease_until<now());
 return found;
end $$;
create function public.club_worker_transition(p_worker uuid,p_id uuid,p_from text,p_to text,p_message text,p_hash text default null,p_code_expiry timestamptz default null)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then return false; end if;
 if p_to not in ('waiting','holding','checkin_pending','in_session','attention','cancelled','expired','completed') then return false; end if;
 update club_bookings set status=p_to,message=left(p_message,500),code_hash=p_hash,code_expires_at=p_code_expiry,code_attempts=case when p_hash is not null then 0 else code_attempts end,updated_at=now()
 where id=p_id and status=p_from;
 if not found then return false; end if;
 if p_to in ('attention','waiting') and p_to<>p_from then insert into club_events(booking_id,kind) values(p_id,p_to); end if;
 return true;
end $$;
revoke all on function public.club_create_booking(bigint,text,text,text,timestamptz,timestamptz,uuid),public.club_checkin(bigint,uuid,text),public.club_cancel(bigint,uuid),public.club_worker_lease(uuid),public.club_worker_transition(uuid,uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.club_create_booking(bigint,text,text,text,timestamptz,timestamptz,uuid),public.club_checkin(bigint,uuid,text),public.club_cancel(bigint,uuid),public.club_worker_lease(uuid),public.club_worker_transition(uuid,uuid,text,text,text,text,timestamptz) to service_role;
create or replace function public.reserve_club_host(p_telegram_id bigint, p_host_id text)
returns public.reservations
language plpgsql security definer set search_path = public
as $$
declare result public.reservations; host public.hosts_cache;
begin
  perform pg_advisory_xact_lock(15837812);
  if exists(select 1 from club_settings where enabled) or exists(select 1 from club_bookings where status not in ('cancelled','expired','completed')) then
    raise exception 'Используйте новую систему бронирования. Обновите приложение';
  end if;
  perform pg_advisory_xact_lock(15837811);
  if (select count(*) from public.reservations
      where telegram_id=p_telegram_id and status in ('pending','confirmed')
      and created_at > now()-interval '60 minutes') >= 2 then
    raise exception 'Максимум две активные брони. Позвоните в клуб: +7 (495) 583-78-11';
  end if;
  select * into host from public.hosts_cache where host_id=p_host_id for update;
  if not found or host.updated_at is null or host.updated_at < now()-interval '30 seconds' then
    raise exception 'Нет свежих статусов от агента. Попробуйте позже';
  end if;
  if host.status <> 'free' or exists(select 1 from public.reservations
      where host_id=p_host_id and status in ('pending','confirmed')
      and created_at > now()-interval '60 minutes') then
    raise exception 'Компьютер уже недоступен для бронирования';
  end if;
  insert into public.reservations(telegram_id,host_id,duration_hours,price,status)
    values(p_telegram_id,p_host_id,1,0,'pending') returning * into result;
  return result;
end;
$$;

commit;
