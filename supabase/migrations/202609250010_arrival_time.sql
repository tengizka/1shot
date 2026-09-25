-- 1.3: arrival time +30 min, no new friend bookings, silent instant intents.
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
create or replace function public.club_create_v2(p_user bigint,p_host text,p_mode text,p_kind text,p_start timestamptz,p_end timestamptz,p_request uuid,p_friend boolean)
returns public.club_bookings language plpgsql security definer set search_path=public as $$
declare b club_bookings;
begin
 perform pg_advisory_xact_lock(15837812);
 if not exists(select 1 from club_settings where enabled and flow_version=2) or not exists(select 1 from club_worker where protocol>=2 and lease_until>now()) then raise exception 'Обновлённая панель клуба пока не готова'; end if;
 select * into b from club_bookings where telegram_id=p_user and client_request_id=p_request;
 if found then if b.instant then delete from club_events where booking_id=b.id and kind='created'; end if;
 return b; end if;
 if p_friend then raise exception 'Бронирование для друга больше недоступно'; end if;
 if p_mode not in ('arrival','scheduled','instant') or p_mode='instant' and p_friend then raise exception 'Некорректный режим входа'; end if;
 if p_mode='scheduled' then
  if p_start is null or extract(minute from p_start at time zone 'Europe/Moscow')::integer%5<>0 or extract(second from p_start)<>0 then raise exception 'Выберите время с шагом 5 минут'; end if;
  p_kind:='range';p_end:=p_start+interval '30 minutes';
 end if;
 b:=club_create_booking(p_user,p_host,case when p_mode='instant' then 'arrival' else p_mode end,p_kind,p_start,p_end,p_request);
 update club_bookings set protocol=2,for_friend=p_friend,instant=(p_mode='instant'),hold_until=case when p_mode='instant' then starts_at+interval '5 minutes' else hold_until end where id=b.id returning * into b;
 if b.instant then delete from club_events where booking_id=b.id and kind='created'; end if;
 return b;
end $$;
notify pgrst,'reload schema';
commit;
