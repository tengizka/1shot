-- /smm in the club bot: ready SMM posts for the admins listed in smm_bot_admins (service role only).
create table if not exists public.smm_bot_admins(telegram_id bigint primary key,note text,created_at timestamptz default now());
create table if not exists public.smm_posts(id bigserial primary key,day date not null,title text not null,feed_image text,feed_text text,story_image text,story_text text,created_at timestamptz default now());
alter table public.smm_bot_admins enable row level security;
alter table public.smm_posts enable row level security;
revoke all on public.smm_bot_admins,public.smm_posts from anon,authenticated;
insert into public.smm_bot_admins(telegram_id,note) values(6058630016,'Тенгиз, SMM') on conflict do nothing;
