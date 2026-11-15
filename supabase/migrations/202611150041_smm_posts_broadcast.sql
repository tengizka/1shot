-- «Сделать рассылку» under a channel post preview: the post goes once to every guest the bot knows.
alter table smm_posts add column if not exists broadcast_started_at timestamptz,
 add column if not exists broadcast_sent int, add column if not exists broadcast_failed int;
