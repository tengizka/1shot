-- Scheduled channel posts: the maker stores when to publish and which preview message to copy (keeps custom emoji).
alter table public.smm_posts add column if not exists scheduled_at timestamptz, add column if not exists preview_chat bigint, add column if not exists preview_msg bigint;
create index if not exists smm_posts_due on public.smm_posts (scheduled_at) where published_at is null and scheduled_at is not null;
-- The cron job itself (every 5 minutes, POST smm-maker?cron=1 with an x-smm-key) is created outside the repo so the key stays out of git.
