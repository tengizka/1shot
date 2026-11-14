-- Cleanup 14.11: an index for the booking events journal (it grows with every booking) and a fixed search_path
-- for the shared updated_at trigger. Applied on the live project the same day.
create index if not exists club_events_booking_id_idx on public.club_events(booking_id);
alter function public.set_updated_at() set search_path=public;
