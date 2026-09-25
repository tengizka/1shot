begin;
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
create or replace function public.club_cancel(p_user bigint,p_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from club_bookings where id=p_id and telegram_id=p_user and status in ('cancel_requested','cancelled')) then return true; end if;
 update club_bookings set status='cancel_requested',code_hash=null,updated_at=now()
 where id=p_id and telegram_id=p_user and status in ('requested','waiting','holding','attention','checkin_pending','release_requested','in_session');
 return found;
end $$;
create or replace function public.club_booking_action(p_user bigint,p_id uuid,p_action text) returns boolean language plpgsql security definer set search_path=public as $$
begin
 if p_action='cancel' then return club_cancel(p_user,p_id); end if;
 if p_action not in ('enter','release') then return false; end if;
 if not exists(select 1 from club_worker where protocol>=2 and lease_until>now()) then return false; end if;
 update club_bookings set status=case when p_action='enter' then 'checkin_pending' else 'release_requested' end,code_hash=null,updated_at=now()
 where id=p_id and telegram_id=p_user and protocol=2 and status='holding' and hold_until>now()
 and for_friend=(p_action='release')
 and exists(select 1 from hosts_cache h where h.host_id=club_bookings.host_id and h.status in ('free','reserved') and h.updated_at between now()-interval '30 seconds' and now()+interval '30 seconds');
 return found;
end $$;
create or replace function public.club_checkin(p_user bigint,p_id uuid,p_hash text)
returns text language plpgsql security definer set search_path=public as $$
declare b public.club_bookings;
begin
 select * into b from club_bookings where id=p_id and telegram_id=p_user for update;
 if not found then return 'not_found'; end if;
 if b.status in ('checkin_pending','in_session') then return b.status; end if;
 if b.status<>'holding' or b.hold_until<=now() then return 'not_waiting'; end if;
 if not exists(select 1 from hosts_cache h where h.host_id=b.host_id and h.status in ('free','reserved') and h.updated_at between now()-interval '30 seconds' and now()+interval '30 seconds') then return 'not_waiting'; end if;
 if b.code_attempts>=5 then return 'too_many_attempts'; end if;
 if b.code_hash is null or b.code_expires_at<=now() then return 'code_expired'; end if;
 update club_bookings set code_attempts=code_attempts+1 where id=p_id;
 if b.code_hash<>p_hash then return 'invalid_code'; end if;
 update club_bookings set status='checkin_pending',code_hash=null,updated_at=now() where id=p_id;
 insert into club_events(booking_id,kind) values(p_id,'checkin');
 return 'checkin_pending';
end $$;
notify pgrst,'reload schema';
commit;
