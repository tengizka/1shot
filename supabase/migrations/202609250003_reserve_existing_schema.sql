-- Compatible with the actual reservations columns supplied by the club.
-- No new table or columns. Atomic limits against concurrent requests.
create or replace function public.reserve_club_host(p_telegram_id bigint, p_host_id text)
returns public.reservations
language plpgsql security definer set search_path = public
as $$
declare result public.reservations; host public.hosts_cache;
begin
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
revoke all on function public.reserve_club_host(bigint,text) from public, anon, authenticated;
grant execute on function public.reserve_club_host(bigint,text) to service_role;
notify pgrst, 'reload schema';
