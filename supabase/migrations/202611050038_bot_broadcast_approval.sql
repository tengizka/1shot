-- A post goes out only once it is approved here, and only once: the bot marks started_at when it begins.
alter table public.club_bot_broadcasts add column if not exists approved boolean not null default false;
alter table public.club_bot_broadcasts alter column started_at drop not null, alter column started_at drop default;
insert into public.club_bot_broadcasts(key,approved,started_at) values('missyou-2026-11',true,null) on conflict(key) do nothing;
notify pgrst,'reload schema';
