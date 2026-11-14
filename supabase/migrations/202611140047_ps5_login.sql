-- Desk can log a guest into the PS5 (host 1) right away. Booking the PS5 ahead is still by phone only.
CREATE OR REPLACE FUNCTION public.club_admin_booking(p_worker uuid, p_mode text, p_host text, p_start timestamp with time zone, p_guest text, p_request uuid, p_uid integer DEFAULT NULL::integer, p_booking uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
 if (p_host='1' or lower(h.zone)='ps5') and (p_mode<>'login' or p_booking is not null) then raise exception 'PS5 — бронь только по телефону'; end if;
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
end $function$;
