-- Price list layout shown on the reception screen (written by smm-maker for SMM admins, read publicly through it).
create table if not exists public.smm_price_screens(
  id text primary key,
  cfg jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.smm_price_screens enable row level security;
