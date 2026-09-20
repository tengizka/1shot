-- ============================================================================
-- 1shot mini-app: начальная схема
--
-- hosts_cache    — кэш списка хостов и их статусов (питается из Gizmo)
-- users_map      — маппинг telegram_id -> gizmo_user_id
-- reservations   — брони из мини-аппа, защита от гонок через
--                  EXCLUDE-констрейнт (непересекающиеся слоты на хост)
-- ============================================================================

create extension if not exists btree_gist with schema extensions;

-- Кэш хостов: один ряд на хост Gizmo, перезаписывается edge-функцией hosts
create table if not exists public.hosts_cache (
  gizmo_host_id   bigint primary key,
  name            text not null,
  number          integer,
  group_id        bigint,
  status          integer not null default 0, -- 0=offline, 1=free, 2=busy (см. README)
  is_free         boolean not null default false,
  is_out_of_order boolean not null default false,
  is_locked       boolean not null default false,
  meta            jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);

-- Кто из гостей Telegram уже существует в Gizmo
create table if not exists public.users_map (
  telegram_id    bigint primary key,
  username       text not null default '',
  first_name     text not null default '',
  gizmo_user_id  bigint,
  gizmo_username text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

do $$
begin
  create type public.reservation_status as enum ('active', 'cancelled', 'failed', 'done');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.reservations (
  id                   bigint generated always as identity primary key,
  telegram_id          bigint not null,
  host_id              bigint not null,
  host_name            text not null,
  pin                  text,
  starts_at            timestamptz not null,
  ends_at              timestamptz not null,
  status               public.reservation_status not null default 'active',
  gizmo_user_id        bigint,
  gizmo_reservation_id bigint,
  created_at           timestamptz not null default now(),
  cancelled_at         timestamptz,
  -- Главное: два активных слота на одном хосте пересекаться не могут.
  -- При одновременном бронировании один запрос упадёт с кодом 23P01 —
  -- edge-функция превращает его в 409 «уже занят».
  constraint reservations_no_overlap
    exclude using gist (
      host_id with =,
      tstzrange(starts_at, ends_at) with &&
    ) where (status = 'active')
);

create index if not exists reservations_tg_idx
  on public.reservations (telegram_id, status, starts_at desc);
create index if not exists reservations_host_idx
  on public.reservations (host_id, status);

-- Данные доступны только из edge-функций (service role, обходит RLS).
-- Прямой доступ через PostgREST (anon/service без JWT) закрыт.
alter table public.hosts_cache  enable row level security;
alter table public.users_map    enable row level security;
alter table public.reservations enable row level security;
