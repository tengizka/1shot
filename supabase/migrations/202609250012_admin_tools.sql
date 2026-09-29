-- Desk 1.6: staff-only anonymous bookings, account entry and next-day arrival.
begin;
alter table public.club_bookings alter column telegram_id drop not null;
alter table public.club_bookings alter column gizmo_user_id drop not null;
alter table public.club_bookings add column admin_created boolean not null default false;
alter table public.club_bookings add column guest_name text;
alter table public.club_bookings add column admin_login_request uuid;
alter table public.club_bookings add constraint club_booking_owner check(admin_created or (telegram_id is not null and gizmo_user_id is not null));
create unique index club_manual_request on public.club_bookings(client_request_id) where admin_created;
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
 select * into h from hosts_cache where host_id=p_host for update;
 if not found or h.updated_at is null or h.updated_at<now()-interval '30 seconds' or h.updated_at>now()+interval '30 seconds' then raise exception 'Нет свежих данных о компьютере'; end if;
 if p_host='1' or lower(h.zone)='ps5' then raise exception 'PS5 — только по телефону'; end if;
 if h.status<>'free' then raise exception 'Прости, но он занят.. Выберите свободный ПК'; end if;
 if p_mode not in ('arrival','scheduled') or p_kind not in ('hour','range','open') then raise exception 'Некорректный вариант брони'; end if;
 if p_mode='arrival' then
  p_start:=now();finish:=p_start+interval '1 hour';p_kind:='hour';
  if h.status<>'free' then raise exception 'Компьютер сейчас недоступен'; end if;
 else
  if p_start is null or p_start<now() or (p_start at time zone 'Europe/Moscow')::date>(now() at time zone 'Europe/Moscow')::date+1 then raise exception 'Выберите будущее время сегодня или завтра по Москве'; end if;
  if extract(minute from p_start at time zone 'Europe/Moscow')::integer%5<>0 or extract(second from p_start)<>0 then raise exception 'Выберите время с шагом 5 минут'; end if;
  p_kind:='range';p_end:=p_start+interval '30 minutes';
  finish:=case when p_kind='hour' then p_start+interval '1 hour' when p_kind='open' then (((p_start at time zone 'Europe/Moscow')::date+1)::timestamp at time zone 'Europe/Moscow') else p_end end;
  if finish is null or finish<p_start+interval '15 minutes' or finish>((((p_start at time zone 'Europe/Moscow')::date+1)::timestamp) at time zone 'Europe/Moscow')+interval '30 minutes' then raise exception 'Интервал: от 15 минут до конца сегодняшнего дня'; end if;
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

create function public.club_admin_booking(p_worker uuid,p_mode text,p_host text,p_start timestamptz,p_guest text,p_request uuid,p_uid integer default null,p_booking uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare b club_bookings; h hosts_cache; finish timestamptz;
begin
 perform pg_advisory_xact_lock(15837812);
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now() and protocol>=2) or not exists(select 1 from club_settings where enabled and flow_version=2) then raise exception 'Панель не готова'; end if;
 if p_request is null or p_mode not in ('reserve','login') or length(coalesce(p_guest,''))>60 then raise exception 'Некорректная заявка'; end if;
 if p_mode='login' and (p_uid is null or p_uid<=0) then raise exception 'Выберите аккаунт'; end if;
 select * into b from club_bookings where admin_created and (client_request_id=p_request or admin_login_request=p_request);
 if found then
  if b.host_id<>p_host or (p_mode='reserve' and (b.instant or b.admin_login_request=p_request)) or (p_mode='login' and b.admin_login_request is null and not b.instant) or (p_mode='login' and b.gizmo_user_id is distinct from p_uid) then raise exception 'Запрос уже использован для другого действия'; end if;
  return b.id;
 end if;
 select * into h from hosts_cache where host_id=p_host for update;
 if not found or h.updated_at is null or h.updated_at<now()-interval '30 seconds' or h.updated_at>now()+interval '30 seconds' then raise exception 'Нет свежего статуса ПК'; end if;
 if p_host='1' or lower(h.zone)='ps5' then raise exception 'PS5 — только по телефону'; end if;
 if p_booking is not null then
  if p_mode<>'login' then raise exception 'Некорректная операция'; end if;
  select * into b from club_bookings where id=p_booking and host_id=p_host and admin_created and not instant for update;
  if not found or b.status<>'holding' or b.hold_until<=now() or h.status not in ('free','reserved') then raise exception 'Бронь уже изменилась или ПК занят'; end if;
  update club_bookings set gizmo_user_id=p_uid,admin_login_request=p_request,status='checkin_pending',updated_at=now() where id=b.id;
  return b.id;
 end if;
 if h.status<>'free' then raise exception 'Вход и новая бронь разрешены только на свободный ПК'; end if;
 if p_mode='login' then p_start:=now();finish:=p_start+interval '5 minutes';
 else
  if p_start is null or p_start<=now() or (p_start at time zone 'Europe/Moscow')::date>(now() at time zone 'Europe/Moscow')::date+1 then raise exception 'Выберите время сегодня или завтра по Москве'; end if;
  if extract(minute from p_start at time zone 'Europe/Moscow')::integer%5<>0 or extract(second from p_start)<>0 then raise exception 'Шаг времени — 5 минут'; end if;
  finish:=p_start+interval '30 minutes';
 end if;
 if exists(select 1 from club_bookings where host_id=p_host and status not in ('cancelled','expired','completed') and (status in ('in_session','attention','cancel_requested','release_requested') or tstzrange(starts_at,ends_at,'[)') && tstzrange(p_start,finish,'[)'))) then raise exception 'Этот ПК или интервал уже занят бронью'; end if;
 if exists(select 1 from reservations where host_id=p_host and status in ('pending','confirmed') and created_at>now()-interval '1 hour') then raise exception 'Действует бронь старой системы'; end if;
 insert into club_bookings(telegram_id,gizmo_user_id,host_id,mode,duration_kind,starts_at,ends_at,hold_until,client_request_id,protocol,instant,admin_created,guest_name)
 values(null,case when p_mode='login' then p_uid else null end,p_host,case when p_mode='login' then 'arrival' else 'scheduled' end,'range',p_start,finish,finish,p_request,2,p_mode='login',true,nullif(trim(p_guest),'')) returning * into b;
 if p_mode='reserve' then insert into club_events(booking_id,kind) values(b.id,'created'); end if;
 return b.id;
end $$;
create function public.club_admin_cancel(p_worker uuid,p_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(15837812);
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'Lease истёк'; end if;
 if exists(select 1 from club_bookings where id=p_id and status in ('cancel_requested','cancelled')) then return true; end if;
 update club_bookings set status='cancel_requested',code_hash=null,updated_at=now() where id=p_id and status in ('requested','waiting','holding','attention','checkin_pending','release_requested','in_session');
 return found;
end $$;
revoke all on function public.club_admin_booking(uuid,text,text,timestamptz,text,uuid,integer,uuid),public.club_admin_cancel(uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_admin_booking(uuid,text,text,timestamptz,text,uuid,integer,uuid),public.club_admin_cancel(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
