-- Keys that let Claude's sessions push finished SMM files to the SMM admins through the club bot (function smm-send).
-- Only the SHA-256 of a key is stored; the key itself stays on the machine that sends.
create table if not exists smm_send_keys(hash text primary key, note text, created_at timestamptz default now());
alter table smm_send_keys enable row level security;
