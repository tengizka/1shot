-- Applies only to mini-app reservations, not manually created Gizmo bookings.
-- Existing rows are retained; updates to status are still allowed.
begin;
create or replace function public.reject_app_ps5_booking()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if lower(trim(new.host_id)) in ('1','ps5') or exists (
    select 1 from public.hosts_cache where host_id=new.host_id and lower(zone)='ps5'
  ) then
    raise exception 'PS5 бронируется только по телефону: +7 (495) 583-78-11';
  end if;
  return new;
end;
$$;
revoke all on function public.reject_app_ps5_booking() from public, anon, authenticated;
drop trigger if exists reservations_ps5_phone_only on public.reservations;
create trigger reservations_ps5_phone_only before insert or update of host_id
on public.reservations for each row execute function public.reject_app_ps5_booking();
commit;
