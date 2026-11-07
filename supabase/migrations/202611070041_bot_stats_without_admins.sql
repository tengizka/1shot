-- /stats: the bot admins' own (test) bookings stay out of the booking numbers.
create or replace function public.club_bot_stats() returns jsonb
language sql stable security definer set search_path=public as $$
 with day as (select date_trunc('day',now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow' as start),
 b as (select * from club_bookings where telegram_id not in (select telegram_id from smm_bot_admins))
 select jsonb_build_object(
  'miniapp',(select count(*) from profiles where telegram_id>0),
  'miniapp_week',(select count(*) from profiles where telegram_id>0 and created_at>now()-interval '7 days'),
  'android',(select count(*) from profiles where telegram_id<0),
  'reachable',(select count(*) from profiles p join club_bot_reach r using(telegram_id) where p.telegram_id>0 and r.reachable),
  'bot_users',(select count(*) from club_bot_users),
  'bot_only',(select count(*) from club_bot_users u where not exists(select 1 from profiles p where p.telegram_id=u.telegram_id)),
  'bot_week',(select count(*) from club_bot_users where last_seen>now()-interval '7 days'),
  'bookings_today',(select count(*) from b,day where b.created_at>=day.start),
  'bookings_week',(select count(*) from b where created_at>now()-interval '7 days'),
  'came_week',(select count(*) from b where created_at>now()-interval '7 days' and status in ('in_session','completed')),
  'bookers_week',(select count(distinct telegram_id) from b where created_at>now()-interval '7 days')
 ) $$;
revoke all on function public.club_bot_stats() from public,anon,authenticated;
grant execute on function public.club_bot_stats() to service_role;
