-- Auth uses profiles; reservations must reference that same identity table.
-- No users are fabricated, no reservations or users_map rows are deleted.
begin;

-- Reject the migration if any historical reservation would lose its reference.
do $$
begin
  if exists (
    select 1 from public.reservations r
    where not exists (
      select 1 from public.profiles p where p.telegram_id = r.telegram_id
    )
  ) then
    raise exception 'Migration stopped: some reservations have no matching profiles. Keep existing data; inspect the orphan-check query in supabase/README.md before retrying.';
  end if;
end $$;

-- Validate the NEW relationship before removing the OLD one. The transaction
-- also rolls back fully if profiles.telegram_id lacks a unique constraint.
alter table public.reservations
  add constraint reservations_profile_telegram_id_fkey
  foreign key (telegram_id) references public.profiles(telegram_id) not valid;

alter table public.reservations
  validate constraint reservations_profile_telegram_id_fkey;

alter table public.reservations
  drop constraint reservations_telegram_id_fkey;

alter table public.reservations
  rename constraint reservations_profile_telegram_id_fkey to reservations_telegram_id_fkey;

notify pgrst, 'reload schema';
commit;

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.reservations'::regclass
  and conname = 'reservations_telegram_id_fkey';
