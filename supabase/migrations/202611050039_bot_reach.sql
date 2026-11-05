-- Which guests the bot can write to (they pressed «Старт» in the bot). Filled by club-bot GET ?reach=1; names never leave the database.
create table if not exists public.club_bot_reach(
 telegram_id bigint primary key,
 reachable boolean not null,
 checked_at timestamptz not null default now()
);
alter table public.club_bot_reach enable row level security;
revoke all on public.club_bot_reach from public,anon,authenticated;
grant all on public.club_bot_reach to service_role;
notify pgrst,'reload schema';
