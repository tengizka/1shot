-- Bot posts to every guest (sent by the owner from the bot). One row per post, so a double tap never sends it twice.
create table if not exists public.club_bot_broadcasts(
 key text primary key,
 started_at timestamptz not null default now(),
 sent int not null default 0,
 failed int not null default 0,
 finished_at timestamptz
);
alter table public.club_bot_broadcasts enable row level security;
revoke all on public.club_bot_broadcasts from public,anon,authenticated;
grant all on public.club_bot_broadcasts to service_role;
notify pgrst,'reload schema';
