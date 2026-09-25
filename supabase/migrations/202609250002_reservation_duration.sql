-- Run in Supabase SQL Editor before testing a new booking.
-- The deployed reservations function inserts duration_minutes, but the column
-- is missing in the current database (PGRST204/schema-cache error).
begin;
alter table public.reservations
  add column if not exists duration_minutes integer not null default 60;
notify pgrst, 'reload schema';
commit;

-- Verify after running:
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'reservations'
  and column_name = 'duration_minutes';
