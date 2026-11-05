-- Who writes to the bot (counted from today on), and the numbers behind the owner's /stats command in the bot.
create table if not exists public.club_bot_users(
 telegram_id bigint primary key,
 first_seen timestamptz not null default now(),
 last_seen timestamptz not null default now()
);
alter table public.club_bot_users enable row level security;
revoke all on public.club_bot_users from public,anon,authenticated;
grant all on public.club_bot_users to service_role;

create or replace function public.club_bot_seen(p_id bigint) returns void
language sql security definer set search_path=public as $$
 insert into club_bot_users(telegram_id) values(p_id) on conflict(telegram_id) do update set last_seen=now();
 insert into club_bot_reach(telegram_id,reachable) values(p_id,true) on conflict(telegram_id) do update set reachable=true,checked_at=now();
$$;

create or replace function public.club_bot_stats() returns jsonb
language sql stable security definer set search_path=public as $$
 with day as (select date_trunc('day',now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow' as start)
 select jsonb_build_object(
  'miniapp',(select count(*) from profiles where telegram_id>0),
  'miniapp_week',(select count(*) from profiles where telegram_id>0 and created_at>now()-interval '7 days'),
  'android',(select count(*) from profiles where telegram_id<0),
  'reachable',(select count(*) from profiles p join club_bot_reach r using(telegram_id) where p.telegram_id>0 and r.reachable),
  'bot_users',(select count(*) from club_bot_users),
  'bot_only',(select count(*) from club_bot_users u where not exists(select 1 from profiles p where p.telegram_id=u.telegram_id)),
  'bot_week',(select count(*) from club_bot_users where last_seen>now()-interval '7 days'),
  'bookings_today',(select count(*) from club_bookings,day where created_at>=day.start),
  'bookings_week',(select count(*) from club_bookings where created_at>now()-interval '7 days'),
  'came_week',(select count(*) from club_bookings where created_at>now()-interval '7 days' and status in ('in_session','completed')),
  'bookers_week',(select count(distinct telegram_id) from club_bookings where created_at>now()-interval '7 days')
 ) $$;

revoke all on function public.club_bot_seen(bigint),public.club_bot_stats() from public,anon,authenticated;
grant execute on function public.club_bot_seen(bigint),public.club_bot_stats() to service_role;
notify pgrst,'reload schema';
