-- 1SHOT: full schema of the Supabase project (public), exported 2026-10-29.
-- Run on a fresh Supabase/Postgres as the owner. Then data.sql.
set check_function_bodies=off;
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create sequence if not exists public."club_events_id_seq";
create table if not exists public."auth_requests" (
  "id" uuid default gen_random_uuid() not null,
  "telegram_id" bigint not null,
  "action" text not null,
  "username" text not null,
  "password" text not null,
  "first_name" text,
  "last_name" text,
  "status" text default 'pending'::text not null,
  "gizmo_user_id" integer,
  "error_message" text,
  "created_at" timestamp with time zone default now() not null,
  "processed_at" timestamp with time zone,
  constraint "auth_requests_pkey" PRIMARY KEY (id),
  constraint "auth_requests_action_check" CHECK ((action = ANY (ARRAY['login'::text, 'register'::text]))),
  constraint "auth_requests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'done'::text, 'invalid_credentials'::text, 'username_taken'::text, 'failed'::text])))
);
CREATE INDEX IF NOT EXISTS auth_requests_telegram_id_idx ON public.auth_requests USING btree (telegram_id);
CREATE INDEX IF NOT EXISTS auth_requests_status_created_at_idx ON public.auth_requests USING btree (status, created_at) WHERE (status = 'pending'::text);
alter table public."auth_requests" enable row level security;
create table if not exists public."club_accounts" (
  "telegram_id" bigint not null,
  "gizmo_user_id" integer not null,
  "requested_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone,
  "data" jsonb,
  constraint "club_accounts_pkey" PRIMARY KEY (telegram_id)
);
alter table public."club_accounts" enable row level security;
create table if not exists public."club_auth_requests" (
  "id" uuid not null,
  "telegram_id" bigint not null,
  "cipher" text,
  "status" text default 'pending'::text not null,
  "worker_id" uuid,
  "gizmo_user_id" integer,
  "created_at" timestamp with time zone default now() not null,
  "purpose" text default 'legacy'::text not null,
  constraint "club_auth_requests_pkey" PRIMARY KEY (id),
  constraint "club_auth_requests_purpose_check" CHECK ((purpose = ANY (ARRAY['legacy'::text, 'login'::text]))),
  constraint "club_auth_requests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'failed'::text, 'invalid_credentials'::text, 'username_taken'::text])))
);
CREATE INDEX IF NOT EXISTS club_auth_requests_telegram_id_created_at_idx ON public.club_auth_requests USING btree (telegram_id, created_at);
alter table public."club_auth_requests" enable row level security;
create table if not exists public."club_bookings" (
  "id" uuid default gen_random_uuid() not null,
  "telegram_id" bigint,
  "gizmo_user_id" integer,
  "host_id" text not null,
  "mode" text not null,
  "duration_kind" text not null,
  "starts_at" timestamp with time zone not null,
  "ends_at" timestamp with time zone not null,
  "hold_until" timestamp with time zone not null,
  "status" text default 'requested'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "client_request_id" uuid not null,
  "message" text,
  "code_hash" text,
  "code_expires_at" timestamp with time zone,
  "code_attempts" integer default 0 not null,
  "protocol" integer default 1 not null,
  "for_friend" boolean default false not null,
  "instant" boolean default false not null,
  "admin_created" boolean default false not null,
  "guest_name" text,
  "admin_login_request" uuid,
  constraint "club_bookings_telegram_id_client_request_id_key" UNIQUE (telegram_id, client_request_id),
  constraint "club_bookings_pkey" PRIMARY KEY (id),
  constraint "club_bookings_duration_kind_check" CHECK ((duration_kind = ANY (ARRAY['hour'::text, 'range'::text, 'open'::text]))),
  constraint "club_bookings_gizmo_user_id_check" CHECK ((gizmo_user_id > 0)),
  constraint "club_booking_owner" CHECK ((admin_created OR ((telegram_id IS NOT NULL) AND (gizmo_user_id IS NOT NULL)))),
  constraint "club_bookings_status_check" CHECK ((status = ANY (ARRAY['requested'::text, 'waiting'::text, 'holding'::text, 'checkin_pending'::text, 'in_session'::text, 'attention'::text, 'cancel_requested'::text, 'release_requested'::text, 'cancelled'::text, 'expired'::text, 'completed'::text]))),
  constraint "club_bookings_mode_check" CHECK ((mode = ANY (ARRAY['arrival'::text, 'scheduled'::text]))),
  constraint "club_bookings_check" CHECK ((ends_at > starts_at)),
  constraint "club_bookings_check1" CHECK ((hold_until > starts_at))
);
CREATE INDEX IF NOT EXISTS club_bookings_telegram_id_created_at_idx ON public.club_bookings USING btree (telegram_id, created_at);
CREATE INDEX IF NOT EXISTS club_bookings_host_id_starts_at_ends_at_idx ON public.club_bookings USING btree (host_id, starts_at, ends_at);
CREATE UNIQUE INDEX IF NOT EXISTS club_manual_request ON public.club_bookings USING btree (client_request_id) WHERE admin_created;
alter table public."club_bookings" enable row level security;
create table if not exists public."club_commands" (
  "id" uuid default gen_random_uuid() not null,
  "telegram_id" bigint not null,
  "gizmo_user_id" integer not null,
  "kind" text not null,
  "payload" jsonb default '{}'::jsonb not null,
  "status" text default 'queued'::text not null,
  "message" text,
  "request_id" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "club_commands_telegram_id_request_id_key" UNIQUE (telegram_id, request_id),
  constraint "club_commands_pkey" PRIMARY KEY (id),
  constraint "club_commands_kind_check" CHECK ((kind = ANY (ARRAY['profile_edit'::text, 'logout'::text, 'password_request'::text, 'lock'::text, 'topup'::text]))),
  constraint "club_commands_status_check" CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'awaiting_admin'::text, 'done'::text, 'attention'::text, 'rejected'::text])))
);
alter table public."club_commands" enable row level security;
create table if not exists public."club_desk_reports" (
  "kind" text not null,
  "data" jsonb not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "club_desk_reports_pkey" PRIMARY KEY (kind),
  constraint "club_desk_reports_kind_check" CHECK ((kind ~ '^[a-z_]{2,40}$'::text))
);
alter table public."club_desk_reports" enable row level security;
create table if not exists public."club_events" (
  "id" bigint generated always as identity not null,
  "booking_id" uuid,
  "kind" text not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "club_events_pkey" PRIMARY KEY (id)
);
alter table public."club_events" enable row level security;
create table if not exists public."club_food_menu" (
  "id" integer not null,
  "group_name" text not null,
  "group_order" integer default 0 not null,
  "name" text not null,
  "price" numeric(10,2) not null,
  "image" text,
  "sort" integer default 0 not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "club_food_menu_pkey" PRIMARY KEY (id),
  constraint "club_food_menu_image_check" CHECK (((image IS NULL) OR ((image ~~ 'data:image/%'::text) AND (length(image) <= 60000)))),
  constraint "club_food_menu_price_check" CHECK ((price >= (0)::numeric))
);
alter table public."club_food_menu" enable row level security;
create table if not exists public."club_food_orders" (
  "id" uuid default gen_random_uuid() not null,
  "request_id" uuid not null,
  "telegram_id" bigint not null,
  "gizmo_user_id" integer not null,
  "host_id" text not null,
  "items" jsonb not null,
  "total" numeric(10,2) not null,
  "payment" text not null,
  "status" text default 'new'::text not null,
  "assistance_id" integer,
  "message" text default ''::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "club_food_orders_request_id_key" UNIQUE (request_id),
  constraint "club_food_orders_pkey" PRIMARY KEY (id),
  constraint "club_food_orders_payment_check" CHECK ((payment = ANY (ARRAY['deposit'::text, 'card'::text, 'cash'::text]))),
  constraint "club_food_orders_status_check" CHECK ((status = ANY (ARRAY['new'::text, 'sent'::text, 'accepted'::text, 'closed'::text])))
);
CREATE INDEX IF NOT EXISTS club_food_orders_user ON public.club_food_orders USING btree (telegram_id, created_at DESC);
CREATE INDEX IF NOT EXISTS club_food_orders_open ON public.club_food_orders USING btree (status) WHERE (status <> 'closed'::text);
alter table public."club_food_orders" enable row level security;
create table if not exists public."club_food_seats" (
  "gizmo_user_id" integer not null,
  "host_id" text not null,
  "seen_at" timestamp with time zone default now() not null,
  constraint "club_food_seats_pkey" PRIMARY KEY (gizmo_user_id)
);
alter table public."club_food_seats" enable row level security;
create table if not exists public."club_password_grants" (
  "id" uuid default gen_random_uuid() not null,
  "telegram_id" bigint not null,
  "gizmo_user_id" integer not null,
  "username" text not null,
  "group_id" integer not null,
  "minimum_length" integer not null,
  "source" text not null,
  "source_id" uuid not null,
  "status" text default 'authorized'::text not null,
  "authorized_by" uuid not null,
  "worker_id" uuid,
  "request_id" uuid,
  "cipher" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "expires_at" timestamp with time zone default (now() + '00:10:00'::interval) not null,
  constraint "club_password_grants_request_id_key" UNIQUE (request_id),
  constraint "club_password_grants_pkey" PRIMARY KEY (id),
  constraint "club_password_grants_gizmo_user_id_check" CHECK ((gizmo_user_id > 0)),
  constraint "club_password_grants_minimum_length_check" CHECK ((minimum_length = ANY (ARRAY[1, 8]))),
  constraint "club_password_grants_source_check" CHECK ((source = ANY (ARRAY['password_request'::text, 'registration'::text]))),
  constraint "club_password_grants_status_check" CHECK ((status = ANY (ARRAY['authorized'::text, 'queued'::text, 'processing'::text, 'done'::text, 'attention'::text, 'expired'::text, 'resolved'::text])))
);
CREATE UNIQUE INDEX IF NOT EXISTS club_password_one_owner ON public.club_password_grants USING btree (telegram_id) WHERE (status = ANY (ARRAY['authorized'::text, 'queued'::text, 'processing'::text, 'attention'::text]));
CREATE UNIQUE INDEX IF NOT EXISTS club_password_one_account ON public.club_password_grants USING btree (gizmo_user_id) WHERE (status = ANY (ARRAY['authorized'::text, 'queued'::text, 'processing'::text, 'attention'::text]));
alter table public."club_password_grants" enable row level security;
create table if not exists public."club_password_resolutions" (
  "grant_id" uuid not null,
  "proof_id" uuid not null,
  "worker_id" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "club_password_resolutions_proof_id_key" UNIQUE (proof_id),
  constraint "club_password_resolutions_pkey" PRIMARY KEY (grant_id)
);
alter table public."club_password_resolutions" enable row level security;
create table if not exists public."club_promo_codes" (
  "code" text not null,
  "channel" text not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "club_promo_codes_pkey" PRIMARY KEY (code),
  constraint "club_promo_codes_channel_check" CHECK (((length(channel) >= 1) AND (length(channel) <= 80))),
  constraint "club_promo_codes_code_check" CHECK ((code ~ '^[A-Z0-9_-]{2,32}$'::text))
);
alter table public."club_promo_codes" enable row level security;
create table if not exists public."club_promo_redemptions" (
  "registration_id" uuid not null,
  "telegram_id" bigint,
  "code" text not null,
  "status" text default 'awaiting_admin'::text not null,
  "gizmo_user_id" integer,
  "reward" text,
  "created_at" timestamp with time zone default now() not null,
  "decided_at" timestamp with time zone,
  "rewarded_at" timestamp with time zone,
  "source" text default 'telegram'::text not null,
  constraint "club_promo_redemptions_pkey" PRIMARY KEY (registration_id),
  constraint "club_promo_redemptions_gizmo_user_id_check" CHECK ((gizmo_user_id > 0)),
  constraint "club_promo_redemptions_reward_check" CHECK ((reward = ANY (ARRAY['granted'::text, 'failed'::text]))),
  constraint "club_promo_redemptions_source_check" CHECK ((source = ANY (ARRAY['telegram'::text, 'desk'::text]))),
  constraint "club_promo_redemptions_status_check" CHECK ((status = ANY (ARRAY['awaiting_admin'::text, 'processing'::text, 'attention'::text, 'done'::text, 'rejected'::text, 'expired'::text])))
);
CREATE INDEX IF NOT EXISTS club_promo_redemptions_code ON public.club_promo_redemptions USING btree (code, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS club_promo_redemptions_one_per_guest ON public.club_promo_redemptions USING btree (gizmo_user_id) WHERE (gizmo_user_id IS NOT NULL);
alter table public."club_promo_redemptions" enable row level security;
create table if not exists public."club_promo_testers" (
  "telegram_id" bigint not null,
  "note" text,
  "created_at" timestamp with time zone default now() not null,
  constraint "club_promo_testers_pkey" PRIMARY KEY (telegram_id)
);
alter table public."club_promo_testers" enable row level security;
create table if not exists public."club_registration_reconciliations" (
  "request_id" uuid not null,
  "proof_id" uuid not null,
  "gizmo_user_id" integer not null,
  "worker_id" uuid not null,
  "completed_at" timestamp with time zone default now() not null,
  constraint "club_registration_reconciliations_proof_id_key" UNIQUE (proof_id),
  constraint "club_registration_reconciliations_pkey" PRIMARY KEY (request_id),
  constraint "club_registration_reconciliations_gizmo_user_id_check" CHECK ((gizmo_user_id > 0))
);
alter table public."club_registration_reconciliations" enable row level security;
create table if not exists public."club_registration_requests" (
  "id" uuid not null,
  "telegram_id" bigint not null,
  "public_data" jsonb not null,
  "cipher" text,
  "status" text default 'awaiting_admin'::text not null,
  "worker_id" uuid,
  "gizmo_user_id" integer,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "expires_at" timestamp with time zone default (now() + '30 days'::interval) not null,
  constraint "club_registration_requests_pkey" PRIMARY KEY (id),
  constraint "club_registration_requests_gizmo_user_id_check" CHECK ((gizmo_user_id > 0)),
  constraint "club_registration_requests_status_check" CHECK ((status = ANY (ARRAY['awaiting_admin'::text, 'processing'::text, 'attention'::text, 'done'::text, 'rejected'::text, 'expired'::text])))
);
CREATE UNIQUE INDEX IF NOT EXISTS club_registration_one_active ON public.club_registration_requests USING btree (telegram_id) WHERE (status = ANY (ARRAY['awaiting_admin'::text, 'processing'::text, 'attention'::text]));
alter table public."club_registration_requests" enable row level security;
create table if not exists public."club_settings" (
  "id" boolean default true not null,
  "enabled" boolean default false not null,
  "flow_version" integer default 1 not null,
  "rota" jsonb default '{}'::jsonb not null,
  constraint "club_settings_pkey" PRIMARY KEY (id),
  constraint "club_settings_flow_version_check" CHECK ((flow_version = ANY (ARRAY[1, 2]))),
  constraint "club_settings_id_check" CHECK (id)
);
alter table public."club_settings" enable row level security;
create table if not exists public."club_test_removed" (
  "gizmo_user_id" integer not null,
  "removed_at" timestamp with time zone default now() not null,
  constraint "club_test_removed_pkey" PRIMARY KEY (gizmo_user_id)
);
alter table public."club_test_removed" enable row level security;
create table if not exists public."club_worker" (
  "id" boolean default true not null,
  "worker_id" uuid,
  "lease_until" timestamp with time zone,
  "protocol" integer default 1 not null,
  constraint "club_worker_pkey" PRIMARY KEY (id),
  constraint "club_worker_id_check" CHECK (id)
);
alter table public."club_worker" enable row level security;
create table if not exists public."hosts_cache" (
  "host_id" text not null,
  "zone" text not null,
  "status" text not null,
  "gizmo_host_id" text,
  "updated_at" timestamp with time zone default now() not null,
  "current_user_id" text,
  constraint "hosts_cache_pkey" PRIMARY KEY (host_id)
);
alter table public."hosts_cache" enable row level security;
create table if not exists public."profiles" (
  "telegram_id" bigint not null,
  "gizmo_user_id" integer not null,
  "username" text not null,
  "first_name" text,
  "last_name" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "profiles_pkey" PRIMARY KEY (telegram_id)
);
CREATE INDEX IF NOT EXISTS profiles_gizmo_user_id_idx ON public.profiles USING btree (gizmo_user_id);
alter table public."profiles" enable row level security;
create table if not exists public."reservations" (
  "id" uuid default gen_random_uuid() not null,
  "telegram_id" bigint not null,
  "host_id" text not null,
  "duration_hours" numeric not null,
  "price" numeric not null,
  "status" text default 'pending'::text not null,
  "gizmo_reservation_id" text,
  "error_message" text,
  "created_at" timestamp with time zone default now() not null,
  "processed_at" timestamp with time zone,
  "duration_minutes" integer default 60 not null,
  constraint "reservations_pkey" PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_reservation_per_host ON public.reservations USING btree (host_id) WHERE (status = ANY (ARRAY['pending'::text, 'confirmed'::text]));
CREATE INDEX IF NOT EXISTS idx_reservations_pending ON public.reservations USING btree (status, created_at) WHERE (status = 'pending'::text);
alter table public."reservations" enable row level security;
create table if not exists public."users_map" (
  "telegram_id" bigint not null,
  "telegram_username" text,
  "gizmo_user_id" text,
  "created_at" timestamp with time zone default now() not null,
  constraint "users_map_pkey" PRIMARY KEY (telegram_id)
);
alter table public."users_map" enable row level security;
alter table public."club_accounts" add constraint "club_accounts_telegram_id_fkey" FOREIGN KEY (telegram_id) REFERENCES profiles(telegram_id);
alter table public."club_bookings" add constraint "club_bookings_telegram_id_fkey" FOREIGN KEY (telegram_id) REFERENCES profiles(telegram_id);
alter table public."club_commands" add constraint "club_commands_telegram_id_fkey" FOREIGN KEY (telegram_id) REFERENCES profiles(telegram_id);
alter table public."club_events" add constraint "club_events_booking_id_fkey" FOREIGN KEY (booking_id) REFERENCES club_bookings(id);
alter table public."club_promo_redemptions" add constraint "club_promo_redemptions_code_fkey" FOREIGN KEY (code) REFERENCES club_promo_codes(code);
alter table public."reservations" add constraint "reservations_host_id_fkey" FOREIGN KEY (host_id) REFERENCES hosts_cache(host_id);
alter table public."reservations" add constraint "reservations_telegram_id_fkey" FOREIGN KEY (telegram_id) REFERENCES profiles(telegram_id);

-- Functions (live definitions)
CREATE OR REPLACE FUNCTION public.club_account_request(p_user bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare gid integer;
begin
 select gizmo_user_id into gid from profiles where telegram_id=p_user;
 if gid is null then raise exception 'Войдите в аккаунт клуба'; end if;
 insert into club_accounts(telegram_id,gizmo_user_id) values(p_user,gid)
 on conflict(telegram_id) do update set requested_at=now(),gizmo_user_id=excluded.gizmo_user_id,
 data=case when club_accounts.gizmo_user_id=excluded.gizmo_user_id then club_accounts.data else null end,
 updated_at=case when club_accounts.gizmo_user_id=excluded.gizmo_user_id then club_accounts.updated_at else null end;
end $function$;

CREATE OR REPLACE FUNCTION public.club_admin_booking(p_worker uuid, p_mode text, p_host text, p_start timestamp with time zone, p_guest text, p_request uuid, p_uid integer DEFAULT NULL::integer, p_booking uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b club_bookings; h hosts_cache; finish timestamptz;
begin
 perform pg_advisory_xact_lock(15837812);
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now() and protocol>=2) or not exists(select 1 from club_settings where enabled and flow_version=2) then raise exception 'Панель не готова'; end if;
 if p_request is null or p_mode not in ('reserve','login') or length(coalesce(p_guest,''))>60 then raise exception 'Некорректная заявка'; end if;
 if p_mode='login' and (p_uid is null or p_uid<=0) then raise exception 'Выберите аккаунт'; end if;
 select * into b from club_bookings where admin_created and (client_request_id=p_request or admin_login_request=p_request);
 if found then
  if b.host_id<>p_host or (p_mode='reserve' and (b.instant or b.admin_login_request=p_request)) or (p_mode='login' and b.admin_login_request is null and not b.instant) or (p_mode='login' and b.gizmo_user_id is distinct from p_uid) then raise exception 'Запрос уже использован для другого действия'; end if;
  return b.id;
 end if;
 select * into h from hosts_cache where host_id=p_host for update;
 if not found or h.updated_at is null or h.updated_at<now()-interval '30 seconds' or h.updated_at>now()+interval '30 seconds' then raise exception 'Нет свежего статуса ПК'; end if;
 if p_host='1' or lower(h.zone)='ps5' then raise exception 'PS5 — только по телефону'; end if;
 if p_booking is not null then
  if p_mode<>'login' then raise exception 'Некорректная операция'; end if;
  select * into b from club_bookings where id=p_booking and host_id=p_host and admin_created and not instant for update;
  if not found or b.status<>'holding' or b.hold_until<=now() or h.status not in ('free','reserved') then raise exception 'Бронь уже изменилась или ПК занят'; end if;
  update club_bookings set gizmo_user_id=p_uid,admin_login_request=p_request,status='checkin_pending',updated_at=now() where id=b.id;
  return b.id;
 end if;
 if h.status<>'free' then raise exception 'Вход и новая бронь разрешены только на свободный ПК'; end if;
 if p_mode='login' then p_start:=now();finish:=p_start+interval '5 minutes';
 else
  if p_start is null or p_start<=now() or (p_start at time zone 'Europe/Moscow')::date>(now() at time zone 'Europe/Moscow')::date+1 then raise exception 'Выберите время сегодня или завтра по Москве'; end if;
  if extract(minute from p_start at time zone 'Europe/Moscow')::integer%5<>0 or extract(second from p_start)<>0 then raise exception 'Шаг времени — 5 минут'; end if;
  finish:=p_start+interval '30 minutes';
 end if;
 if exists(select 1 from club_bookings where host_id=p_host and status not in ('cancelled','expired','completed') and (status in ('in_session','attention','cancel_requested','release_requested') or tstzrange(starts_at,ends_at,'[)') && tstzrange(p_start,finish,'[)'))) then raise exception 'Этот ПК или интервал уже занят бронью'; end if;
 if exists(select 1 from reservations where host_id=p_host and status in ('pending','confirmed') and created_at>now()-interval '1 hour') then raise exception 'Действует бронь старой системы'; end if;
 insert into club_bookings(telegram_id,gizmo_user_id,host_id,mode,duration_kind,starts_at,ends_at,hold_until,client_request_id,protocol,instant,admin_created,guest_name)
 values(null,case when p_mode='login' then p_uid else null end,p_host,case when p_mode='login' then 'arrival' else 'scheduled' end,'range',p_start,finish,finish,p_request,2,p_mode='login',true,nullif(trim(p_guest),'')) returning * into b;
 if p_mode='reserve' then insert into club_events(booking_id,kind) values(b.id,'created'); end if;
 return b.id;
end $function$;

CREATE OR REPLACE FUNCTION public.club_admin_cancel(p_worker uuid, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 perform pg_advisory_xact_lock(15837812);
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'Lease истёк'; end if;
 if exists(select 1 from club_bookings where id=p_id and status in ('cancel_requested','cancelled')) then return true; end if;
 update club_bookings set status='cancel_requested',code_hash=null,updated_at=now() where id=p_id and status in ('requested','waiting','holding','attention','checkin_pending','release_requested','in_session');
 return found;
end $function$;

CREATE OR REPLACE FUNCTION public.club_auth_claim(p_worker uuid)
 RETURNS SETOF club_auth_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r club_auth_requests;
begin
 update club_auth_requests set status='failed',cipher=null where status in ('pending','running') and created_at<now()-interval '3 minutes';
 delete from club_auth_requests where created_at<now()-interval '1 day';
 for r in select * from club_auth_requests where status='pending' order by created_at limit 5 for update skip locked loop
  update club_auth_requests set status='running',cipher=null,worker_id=p_worker where id=r.id;
  return next r;
 end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.club_auth_enqueue(p_id uuid, p_user bigint, p_cipher text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 perform pg_advisory_xact_lock(p_user);
 if (select count(*) from club_auth_requests where telegram_id=p_user and created_at>now()-interval '15 minutes')>=5 then raise exception 'Слишком много попыток. Подождите 15 минут'; end if;
 if exists(select 1 from club_auth_requests where telegram_id=p_user and status in ('pending','running') and created_at>now()-interval '3 minutes') then raise exception 'Предыдущий запрос ещё выполняется'; end if;
 insert into club_auth_requests(id,telegram_id,cipher,purpose) values(p_id,p_user,p_cipher,'login');
 return p_id;
end $function$;

CREATE OR REPLACE FUNCTION public.club_booking_action(p_user bigint, p_id uuid, p_action text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if p_action='cancel' then return club_cancel(p_user,p_id); end if;
 if p_action not in ('enter','release') then return false; end if;
 if not exists(select 1 from club_worker where protocol>=2 and lease_until>now()) then return false; end if;
 update club_bookings set status=case when p_action='enter' then 'checkin_pending' else 'release_requested' end,code_hash=null,updated_at=now()
 where id=p_id and telegram_id=p_user and protocol=2 and status='holding' and hold_until>now()
 and for_friend=(p_action='release')
 and exists(select 1 from hosts_cache h where h.host_id=club_bookings.host_id and h.status in ('free','reserved') and h.updated_at between now()-interval '30 seconds' and now()+interval '30 seconds');
 return found;
end $function$;

CREATE OR REPLACE FUNCTION public.club_cancel(p_user bigint, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if exists(select 1 from club_bookings where id=p_id and telegram_id=p_user and status in ('cancel_requested','cancelled')) then return true; end if;
 update club_bookings set status='cancel_requested',code_hash=null,updated_at=now()
 where id=p_id and telegram_id=p_user and status in ('requested','waiting','holding','attention','checkin_pending','release_requested','in_session');
 return found;
end $function$;

CREATE OR REPLACE FUNCTION public.club_checkin(p_user bigint, p_id uuid, p_hash text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b public.club_bookings;
begin
 select * into b from club_bookings where id=p_id and telegram_id=p_user for update;
 if not found then return 'not_found'; end if;
 if b.status in ('checkin_pending','in_session') then return b.status; end if;
 if b.status<>'holding' or b.hold_until<=now() then return 'not_waiting'; end if;
 if not exists(select 1 from hosts_cache h where h.host_id=b.host_id and h.status in ('free','reserved') and h.updated_at between now()-interval '30 seconds' and now()+interval '30 seconds') then return 'not_waiting'; end if;
 if b.code_attempts>=5 then return 'too_many_attempts'; end if;
 if b.code_hash is null or b.code_expires_at<=now() then return 'code_expired'; end if;
 update club_bookings set code_attempts=code_attempts+1 where id=p_id;
 if b.code_hash<>p_hash then return 'invalid_code'; end if;
 update club_bookings set status='checkin_pending',code_hash=null,updated_at=now() where id=p_id;
 insert into club_events(booking_id,kind) values(p_id,'checkin');
 return 'checkin_pending';
end $function$;

CREATE OR REPLACE FUNCTION public.club_client_state(p_user bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 return club_client_state_before_password_grants(p_user)||jsonb_build_object('password_grant',club_password_status(p_user));
end $function$;

CREATE OR REPLACE FUNCTION public.club_client_state_before_password_grants(p_user bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare gid integer;
begin
 perform club_account_request(p_user);
 select gizmo_user_id into gid from profiles where telegram_id=p_user;
 return jsonb_build_object(
  'bookings',coalesce((select jsonb_agg(x) from (select id,host_id,mode,duration_kind,starts_at,ends_at,hold_until,status,created_at,message,protocol,for_friend,instant from club_bookings where telegram_id=p_user and gizmo_user_id is not distinct from gid and status not in ('cancelled','expired','completed') order by created_at desc) x),'[]'::jsonb),
  'hosts',coalesce((select jsonb_agg(x) from (select host_id,zone,status,updated_at from hosts_cache order by host_id) x),'[]'::jsonb),
  'account',(select jsonb_build_object('data',data,'updated_at',updated_at) from club_accounts where telegram_id=p_user and gizmo_user_id is not distinct from gid),
  'commands',coalesce((select jsonb_agg(x) from (select id,kind,status,message,created_at from club_commands where telegram_id=p_user order by created_at desc limit 5) x),'[]'::jsonb),
  'password_request',(select to_jsonb(x) from (select id,status,message,created_at,updated_at from club_commands where telegram_id=p_user and kind='password_request' order by created_at desc limit 1) x)
 );
end $function$;

CREATE OR REPLACE FUNCTION public.club_command(p_user bigint, p_kind text, p_payload jsonb, p_request uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 cid uuid; gid integer; cached record; sum numeric;
begin
 perform pg_advisory_xact_lock(p_user);
 select gizmo_user_id into gid from profiles where telegram_id=p_user;
 if gid is null then raise exception 'Профиль не найден'; end if;
 if p_request is not null then
  select id into cid from club_commands where telegram_id=p_user and request_id=p_request;
  if found then return cid; end if;
 end if;
 update club_commands set status='rejected',message='Клуб не ответил',updated_at=now() where telegram_id=p_user and kind='topup' and status='queued' and created_at<now()-interval '2 minutes';
 if exists(select 1 from club_commands where telegram_id=p_user and kind=p_kind and status in ('queued','running','awaiting_admin')) then raise exception 'Предыдущий запрос ещё обрабатывается'; end if;
 if p_kind not in ('profile_edit','logout','password_request','lock','topup') then raise exception 'Неизвестная операция'; end if;
 if p_kind in ('logout','lock') then
  select * into cached from club_accounts where telegram_id=p_user and gizmo_user_id=gid and updated_at>now()-interval '30 seconds';
  if not found or cached.data->'session' is null or cached.data->'session'='null'::jsonb or cached.data->'session'->>'key' is distinct from p_payload->>'session_key' then raise exception 'Сессия изменилась. Обновите профиль'; end if;
  p_payload:=cached.data->'session';
 elsif p_kind='profile_edit' then
  if exists(select 1 from club_accounts where telegram_id=p_user and gizmo_user_id=gid and data->'session' is not null and data->'session'<>'null'::jsonb and updated_at>now()-interval '30 seconds') then raise exception 'Сначала завершите игровую сессию'; end if;
 elsif p_kind='topup' then
  if jsonb_typeof(p_payload->'amount') is distinct from 'number' then raise exception 'Укажите сумму'; end if;
  sum:=(p_payload->>'amount')::numeric;
  if sum<>trunc(sum) or sum<100 or sum>50000 then raise exception 'Сумма от 100 до 50 000 ₽'; end if;
  if (select count(*) from club_commands where telegram_id=p_user and kind='topup' and created_at>now()-interval '1 hour')>=10 then raise exception 'Слишком много попыток. Попробуй через час'; end if;
  p_payload:=jsonb_build_object('amount',sum::integer);
 end if;
 insert into club_commands(telegram_id,gizmo_user_id,kind,payload,request_id,status)
 values(p_user,gid,p_kind,p_payload,p_request,case when p_kind='password_request' then 'awaiting_admin' else 'queued' end) returning id into cid;
 return cid;
end;
$function$;

CREATE OR REPLACE FUNCTION public.club_create_booking(p_user bigint, p_host text, p_mode text, p_kind text, p_start timestamp with time zone, p_end timestamp with time zone, p_request uuid)
 RETURNS club_bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b public.club_bookings; h public.hosts_cache; gid integer; finish timestamptz; hold timestamptz;
begin
 perform pg_advisory_xact_lock(15837812);
 if not exists(select 1 from club_settings where enabled) then raise exception 'Новая система пока не включена администратором'; end if;
 select * into b from club_bookings where telegram_id=p_user and client_request_id=p_request;
 if found then return b; end if;
 if not exists(select 1 from club_worker where lease_until>now()) then raise exception 'Панель клуба не на связи. Позвоните администратору'; end if;
 select gizmo_user_id into gid from profiles where telegram_id=p_user;
 if gid is null or gid<=0 then raise exception 'Войдите в аккаунт клуба заново'; end if;
 select * into h from hosts_cache where host_id=p_host for update;
 if not found or h.updated_at is null or h.updated_at<now()-interval '30 seconds' or h.updated_at>now()+interval '30 seconds' then raise exception 'Нет свежих данных о компьютере'; end if;
 -- 2.3: the TV-zone PS5 can be booked from the app, but only for a time slot (no Gizmo login there).
 if (p_host='1' or lower(h.zone)='ps5') and p_mode<>'scheduled' then raise exception 'PS5 бронируется только на время'; end if;
 if h.status<>'free' then raise exception 'Прости, но он занят.. Выберите свободный ПК'; end if;
 if p_mode not in ('arrival','scheduled') or p_kind not in ('hour','range','open') then raise exception 'Некорректный вариант брони'; end if;
 if p_mode='arrival' then
  p_start:=now();finish:=p_start+interval '1 hour';p_kind:='hour';
  if h.status<>'free' then raise exception 'Компьютер сейчас недоступен'; end if;
 else
  if p_start is null or p_start<now() or (p_start at time zone 'Europe/Moscow')::date>(now() at time zone 'Europe/Moscow')::date+1 then raise exception 'Выберите будущее время сегодня или завтра по Москве'; end if;
  if extract(minute from p_start at time zone 'Europe/Moscow')::integer%5<>0 or extract(second from p_start)<>0 then raise exception 'Выберите время с шагом 5 минут'; end if;
  p_kind:='range';p_end:=p_start+interval '30 minutes';
  finish:=case when p_kind='hour' then p_start+interval '1 hour' when p_kind='open' then (((p_start at time zone 'Europe/Moscow')::date+1)::timestamp at time zone 'Europe/Moscow') else p_end end;
  if finish is null or finish<p_start+interval '15 minutes' or finish>((((p_start at time zone 'Europe/Moscow')::date+1)::timestamp) at time zone 'Europe/Moscow')+interval '30 minutes' then raise exception 'Интервал: от 15 минут до конца сегодняшнего дня'; end if;
  if h.status='broken' then raise exception 'Компьютер не работает'; end if;
 end if;
 hold:=least(p_start+interval '1 hour',finish);
 -- Unreleased/uncertain locks continue to consume availability, even past deadline.
 if (select count(*) from club_bookings where telegram_id=p_user and status not in ('cancelled','expired','completed'))>=2 then raise exception 'Максимум две активные брони. Больше — по телефону'; end if;
 if exists(select 1 from club_bookings where host_id=p_host and status not in ('cancelled','expired','completed')
  and (status in ('in_session','attention','cancel_requested','release_requested') or tstzrange(starts_at,ends_at,'[)') && tstzrange(p_start,finish,'[)'))) then raise exception 'Этот интервал уже занят или требует проверки администратора'; end if;
 if exists(select 1 from reservations where host_id=p_host and status in ('pending','confirmed') and created_at>now()-interval '1 hour') then raise exception 'На ПК ещё действует бронь старой системы'; end if;
 insert into club_bookings(telegram_id,gizmo_user_id,host_id,mode,duration_kind,starts_at,ends_at,hold_until,client_request_id)
 values(p_user,gid,p_host,p_mode,p_kind,p_start,finish,hold,p_request) returning * into b;
 insert into club_events(booking_id,kind) values(b.id,'created');
 return b;
end $function$;

CREATE OR REPLACE FUNCTION public.club_create_v2(p_user bigint, p_host text, p_mode text, p_kind text, p_start timestamp with time zone, p_end timestamp with time zone, p_request uuid, p_friend boolean)
 RETURNS club_bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b club_bookings;
begin
 perform pg_advisory_xact_lock(15837812);
 if not exists(select 1 from club_settings where enabled and flow_version=2) or not exists(select 1 from club_worker where protocol>=2 and lease_until>now()) then raise exception 'Обновлённая панель клуба пока не готова'; end if;
 select * into b from club_bookings where telegram_id=p_user and client_request_id=p_request;
 if found then if b.instant then delete from club_events where booking_id=b.id and kind='created'; end if;
 return b; end if;
 if p_friend then raise exception 'Бронирование для друга больше недоступно'; end if;
 if p_mode not in ('arrival','scheduled','instant') or p_mode='instant' and p_friend then raise exception 'Некорректный режим входа'; end if;
 if p_mode='scheduled' then
  if p_start is null or extract(minute from p_start at time zone 'Europe/Moscow')::integer%5<>0 or extract(second from p_start)<>0 then raise exception 'Выберите время с шагом 5 минут'; end if;
  p_kind:='range';p_end:=p_start+interval '30 minutes';
 end if;
 b:=club_create_booking(p_user,p_host,case when p_mode='instant' then 'arrival' else p_mode end,p_kind,p_start,p_end,p_request);
 update club_bookings set protocol=2,for_friend=p_friend,instant=(p_mode='instant'),hold_until=case when p_mode='instant' then starts_at+interval '5 minutes' else hold_until end where id=b.id returning * into b;
 if b.instant then delete from club_events where booking_id=b.id and kind='created'; end if;
 return b;
end $function$;

CREATE OR REPLACE FUNCTION public.club_desk_report(p_worker uuid, p_kind text, p_data jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 if length(p_data::text)>500000 then raise exception 'report_too_large'; end if;
 insert into club_desk_reports(kind,data,updated_at) values(p_kind,p_data,now()) on conflict(kind) do update set data=excluded.data,updated_at=now();
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.club_food_order(p_user bigint, p_request uuid, p_items jsonb, p_payment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid integer;v_seat text;v_items jsonb;v_total numeric;v_lines integer;v_order club_food_orders;
begin
 select * into v_order from club_food_orders where request_id=p_request and telegram_id=p_user;
 if found then return club_food_order_view(v_order); end if;
 select gizmo_user_id into v_uid from profiles where telegram_id=p_user;
 if v_uid is null then raise exception 'Сначала войдите в аккаунт клуба'; end if;
 if not exists(select 1 from club_worker where lease_until>now()) then raise exception 'Заказы сейчас не принимаются. Позовите администратора с ПК'; end if;
 select host_id into v_seat from club_food_seats where gizmo_user_id=v_uid and seen_at>now()-interval '60 seconds';
 if v_seat is null then raise exception 'Заказать можно, только когда вы сидите за ПК в клубе'; end if;
 if p_payment is null or p_payment not in ('deposit','card','cash') then raise exception 'Выберите способ оплаты'; end if;
 if exists(select 1 from club_food_orders where telegram_id=p_user and status in ('new','sent') and created_at>now()-interval '20 minutes') then raise exception 'Прошлый заказ ещё у администратора. Дождитесь ответа'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 10 then raise exception 'В заказе от 1 до 10 позиций'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) e where coalesce(jsonb_typeof(e->'id'),'')<>'number' or coalesce(jsonb_typeof(e->'qty'),'')<>'number' or (e->>'qty')::numeric not in (1,2,3,4,5)) then raise exception 'До 5 штук каждой позиции'; end if;
 if (select count(distinct e->>'id') from jsonb_array_elements(p_items) e)<>jsonb_array_length(p_items) then raise exception 'Позиции в заказе повторяются'; end if;
 select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'price',m.price,'qty',((e->>'qty')::numeric)::int) order by m.group_order,m.sort,m.name),sum(m.price*((e->>'qty')::numeric)::int),count(*)
  into v_items,v_total,v_lines from jsonb_array_elements(p_items) e join club_food_menu m on m.id=(e->>'id')::numeric;
 if v_lines is distinct from jsonb_array_length(p_items) then raise exception 'Меню обновилось. Откройте раздел заново'; end if;
 insert into club_food_orders(request_id,telegram_id,gizmo_user_id,host_id,items,total,payment) values(p_request,p_user,v_uid,v_seat,v_items,v_total,p_payment) returning * into v_order;
 return club_food_order_view(v_order);
end $function$;

CREATE OR REPLACE FUNCTION public.club_food_order_view(o club_food_orders)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 select jsonb_build_object('id',o.id,'status',o.status,'items',o.items,'total',o.total,'payment',o.payment,'host_id',o.host_id,'message',o.message,'created_at',o.created_at,'updated_at',o.updated_at)
$function$;

CREATE OR REPLACE FUNCTION public.club_food_state(p_user bigint, p_menu boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid integer;v_seat text;
begin
 select gizmo_user_id into v_uid from profiles where telegram_id=p_user;
 if v_uid is not null then select host_id into v_seat from club_food_seats where gizmo_user_id=v_uid and seen_at>now()-interval '60 seconds'; end if;
 return jsonb_build_object(
  'menu_version',(select coalesce(extract(epoch from max(updated_at))::bigint::text,'0')||'-'||count(*) from club_food_menu),
  'menu',case when p_menu then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'group',group_name,'name',name,'price',price,'image',image) order by group_order,group_name,sort,name),'[]'::jsonb) from club_food_menu) end,
  'account',v_uid is not null,
  'seat',v_seat,
  'desk',exists(select 1 from club_worker where lease_until>now()),
  'orders',(select coalesce(jsonb_agg(club_food_order_view(o) order by o.created_at desc),'[]'::jsonb) from (select * from club_food_orders where telegram_id=p_user and created_at>now()-interval '12 hours' order by created_at desc limit 5) o)
 );
end $function$;

CREATE OR REPLACE FUNCTION public.club_food_sync(p_worker uuid, p_seats jsonb, p_menu jsonb, p_updates jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare u jsonb;v_rank integer;v_old integer;
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 if p_menu is not null then
  if jsonb_typeof(p_menu)<>'array' then raise exception 'invalid_menu'; end if;
  delete from club_food_menu where id not in (select (x->>'id')::integer from jsonb_array_elements(p_menu) x);
  insert into club_food_menu(id,group_name,group_order,name,price,image,sort,updated_at)
   select distinct on ((x->>'id')::integer) (x->>'id')::integer,left(x->>'group',45),coalesce((x->>'group_order')::integer,0),left(x->>'name',60),(x->>'price')::numeric,x->>'image',coalesce((x->>'sort')::integer,0),now() from jsonb_array_elements(p_menu) x
   on conflict(id) do update set group_name=excluded.group_name,group_order=excluded.group_order,name=excluded.name,price=excluded.price,image=excluded.image,sort=excluded.sort,updated_at=now();
 end if;
 if p_seats is not null then
  delete from club_food_seats where gizmo_user_id is not null;
  insert into club_food_seats(gizmo_user_id,host_id) select distinct on ((x->>'uid')::integer) (x->>'uid')::integer,x->>'host' from jsonb_array_elements(p_seats) x where (x->>'uid')::integer>0;
 end if;
 update club_food_orders set status='closed',updated_at=now() where status<>'closed' and created_at<now()-interval '3 hours';
 for u in select * from jsonb_array_elements(coalesce(p_updates,'[]')) loop
  v_rank:=array_position(array['new','sent','accepted','closed'],u->>'status');
  if v_rank is null then continue; end if;
  select array_position(array['new','sent','accepted','closed'],status) into v_old from club_food_orders where id=(u->>'id')::uuid;
  if v_old is null or v_rank<v_old then continue; end if;
  update club_food_orders set status=u->>'status',assistance_id=coalesce((u->>'assistance_id')::integer,assistance_id),message=left(coalesce(u->>'message',message),200),updated_at=now()
   where id=(u->>'id')::uuid and (status<>u->>'status' or assistance_id is distinct from coalesce((u->>'assistance_id')::integer,assistance_id) or message<>left(coalesce(u->>'message',message),200));
 end loop;
 return jsonb_build_object('orders',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'gizmo_user_id',gizmo_user_id,'host_id',host_id,'items',items,'total',total,'payment',payment,'status',status,'assistance_id',assistance_id,'created_at',created_at) order by created_at),'[]'::jsonb)
  from club_food_orders where status<>'closed' and created_at>now()-interval '3 hours'),
  'menu_count',(select count(*) from club_food_menu));
end $function$;

CREATE OR REPLACE FUNCTION public.club_password_authorize(p_worker uuid, p_source text, p_id uuid, p_uid integer, p_username text, p_group integer, p_minimum integer, p_confirmed boolean, p_privileged boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare context jsonb; existing club_password_grants; gid uuid;
begin
 if p_confirmed is distinct from true or p_minimum not in (1,8) or (p_minimum=8 and p_privileged is distinct from true) then raise exception 'Подтвердите личность и права аккаунта'; end if;
 context:=club_password_context(p_worker,p_source,p_id);
 if (context->>'gizmo_user_id')::integer<>p_uid or p_username is null or length(p_username)=0 or p_group<=0 then raise exception 'Аккаунт изменился'; end if;
 perform pg_advisory_xact_lock(15837816,p_uid);perform club_password_cleanup();
 select * into existing from club_password_grants where gizmo_user_id=p_uid and status in ('authorized','queued','processing','attention');
 if found then
  if existing.source<>p_source or existing.source_id<>p_id then raise exception 'Для аккаунта уже есть другое разрешение'; end if;
  return existing.id;
 end if;
 insert into club_password_grants(telegram_id,gizmo_user_id,username,group_id,minimum_length,source,source_id,authorized_by)
 values((context->>'telegram_id')::bigint,p_uid,p_username,p_group,p_minimum,p_source,p_id,p_worker) returning id into gid;
 return gid;
end $function$;

CREATE OR REPLACE FUNCTION public.club_password_claim(p_worker uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g club_password_grants;
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 perform club_password_cleanup();
 select * into g from club_password_grants where id=p_id for update;
 if not found or g.status<>'queued' or g.cipher is null then raise exception 'Пароль уже обрабатывается или разрешение истекло'; end if;
 perform club_password_context(p_worker,g.source,g.source_id);
 update club_password_grants set status='processing',worker_id=p_worker,cipher=null,updated_at=now() where id=p_id;
 return to_jsonb(g);
end $function$;

CREATE OR REPLACE FUNCTION public.club_password_cleanup()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 update club_password_grants set status='expired',cipher=null,username='',updated_at=now() where status in ('authorized','queued') and expires_at<=now();
 update club_password_grants set status='attention',cipher=null,updated_at=now() where status='processing' and updated_at<now()-interval '15 minutes';
 delete from club_password_grants where status in ('done','expired','resolved') and updated_at<now()-interval '7 days';
end $function$;

CREATE OR REPLACE FUNCTION public.club_password_context(p_worker uuid, p_source text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result jsonb;
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 if p_source='password_request' then
  select jsonb_build_object('telegram_id',c.telegram_id,'gizmo_user_id',c.gizmo_user_id) into result
  from club_commands c join profiles p on p.telegram_id=c.telegram_id and p.gizmo_user_id=c.gizmo_user_id
  where c.id=p_id and c.kind='password_request' and c.status='awaiting_admin' for update of c,p;
 elsif p_source='registration' then
  select jsonb_build_object('telegram_id',telegram_id,'gizmo_user_id',gizmo_user_id,'public_data',public_data) into result
  from club_registration_requests where id=p_id and status='attention' and gizmo_user_id>0 for update;
 end if;
 if result is null then raise exception 'Нужна открытая заявка с подтверждённым ID аккаунта'; end if;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.club_password_finish(p_worker uuid, p_id uuid, p_status text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g club_password_grants;
begin
 if p_status not in ('done','attention') then raise exception 'invalid_outcome'; end if;
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 select * into g from club_password_grants where id=p_id for update;
 if not found or g.worker_id is distinct from p_worker then raise exception 'grant_owner_mismatch'; end if;
 if g.status=p_status then return true; end if;
 if g.status<>'processing' then return false; end if;
 update club_password_grants set status=p_status,cipher=null,username=case when p_status='done' then '' else username end,updated_at=now() where id=p_id;
 if p_status='done' and g.source='password_request' then
  update club_commands set status='done',payload='{}',message='Гость установил пароль самостоятельно; проверен вход',updated_at=now() where id=g.source_id and status='awaiting_admin';
 end if;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.club_password_resolve(p_worker uuid, p_id uuid, p_proof uuid, p_confirmed boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g club_password_grants;
begin
 if p_confirmed is distinct from true then raise exception 'Подтвердите сверку доступа'; end if;
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 select * into g from club_password_grants where id=p_id for update;
 if not found then raise exception 'Разрешение не найдено'; end if;
 if g.status='resolved' and exists(select 1 from club_password_resolutions where grant_id=p_id and proof_id=p_proof) then return true; end if;
 if g.status<>'attention' then raise exception 'Статус изменился'; end if;
 perform 1 from profiles where telegram_id=g.telegram_id and gizmo_user_id=g.gizmo_user_id for update;
 if not found then raise exception 'Связь аккаунта изменилась'; end if;
 perform 1 from club_auth_requests where id=p_proof and telegram_id=g.telegram_id and gizmo_user_id=g.gizmo_user_id and purpose='login' and status='done'
 and created_at>=g.updated_at and created_at>now()-interval '10 minutes' and created_at<=now() for update;
 if not found then raise exception 'Нет свежего подтверждения доступа'; end if;
 insert into club_password_resolutions(grant_id,proof_id,worker_id) values(p_id,p_proof,p_worker);
 update club_password_grants set status='resolved',cipher=null,username='',updated_at=now() where id=p_id;
 if g.source='password_request' then update club_commands set status='done',payload='{}',message='Доступ подтверждён входом владельца. Результат смены пароля неизвестен',updated_at=now() where id=g.source_id and status='awaiting_admin'; end if;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.club_password_review(p_worker uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g club_password_grants; proof uuid;
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 select * into g from club_password_grants where id=p_id and status='attention';
 if not found then raise exception 'Нужна неопределённая попытка'; end if;
 select a.id into proof from club_auth_requests a join profiles p on p.telegram_id=a.telegram_id and p.gizmo_user_id=a.gizmo_user_id
 where a.telegram_id=g.telegram_id and a.gizmo_user_id=g.gizmo_user_id and a.purpose='login' and a.status='done'
 and a.created_at>=g.updated_at and a.created_at>now()-interval '10 minutes' and a.created_at<=now()
 and not exists(select 1 from club_password_resolutions x where x.proof_id=a.id) order by a.created_at desc limit 1;
 if proof is null then raise exception 'Гость должен сам успешно войти после ошибки, не более 10 минут назад'; end if;
 return jsonb_build_object('proof_id',proof,'gizmo_user_id',g.gizmo_user_id);
end $function$;

CREATE OR REPLACE FUNCTION public.club_password_status(p_user bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 perform club_password_cleanup();
 return (select jsonb_build_object('id',id,'username',username,'status',status,'minimum_length',minimum_length,'expires_at',expires_at) from club_password_grants where telegram_id=p_user order by created_at desc limit 1);
end $function$;

CREATE OR REPLACE FUNCTION public.club_password_submit(p_id uuid, p_user bigint, p_request uuid, p_cipher text, p_length integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g club_password_grants;
begin
 perform club_password_cleanup();
 select * into g from club_password_grants where id=p_id and telegram_id=p_user for update;
 if not found then raise exception 'Нет разрешения администратора'; end if;
 if g.request_id=p_request then return g.status; end if;
 if g.status<>'authorized' or g.expires_at<=now() then raise exception 'Разрешение уже использовано или истекло'; end if;
 if p_length<g.minimum_length or p_length>64 or p_cipher is null or length(p_cipher)>12000 then raise exception 'Проверьте длину пароля'; end if;
 update club_password_grants set status='queued',request_id=p_request,cipher=p_cipher,updated_at=now() where id=p_id;
 return 'queued';
end $function$;

CREATE OR REPLACE FUNCTION public.club_promo_codes_active()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('code',code,'channel',channel) order by created_at,code),'[]'::jsonb) from club_promo_codes where active
$function$;

CREATE OR REPLACE FUNCTION public.club_promo_desk_redemption(p_worker uuid, p_id uuid, p_code text, p_uid integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_code text:=upper(trim(coalesce(p_code,'')));
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 if p_id is null or p_uid is null or p_uid<=0 then raise exception 'invalid_redemption'; end if;
 if not exists(select 1 from club_promo_codes c where c.code=v_code and c.active) then raise exception 'Промокод не найден'; end if;
 if exists(select 1 from club_promo_redemptions where gizmo_user_id=p_uid and registration_id<>p_id) then raise exception 'Этот гость уже получал час по промокоду'; end if;
 insert into club_promo_redemptions(registration_id,telegram_id,code,status,gizmo_user_id,source,decided_at)
  values(p_id,null,v_code,'done',p_uid,'desk',now()) on conflict(registration_id) do nothing;
 return exists(select 1 from club_promo_redemptions r where r.registration_id=p_id and r.code=v_code and r.gizmo_user_id=p_uid and r.source='desk');
end $function$;

CREATE OR REPLACE FUNCTION public.club_promo_report()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 select jsonb_build_object(
  'codes',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'channel',channel,'active',active) order by code),'[]'::jsonb) from club_promo_codes),
  'redemptions',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'status',status,'gizmo_user_id',gizmo_user_id,'reward',reward,'source',source,'created_at',created_at,'decided_at',decided_at) order by created_at),'[]'::jsonb)
   from club_promo_redemptions r
   where (r.telegram_id is null or r.telegram_id not in (select telegram_id from club_promo_testers))
     and (r.gizmo_user_id is null or r.gizmo_user_id not in (select gizmo_user_id from club_test_removed)))
 )
$function$;

CREATE OR REPLACE FUNCTION public.club_promo_reward(p_worker uuid, p_id uuid, p_result text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r club_promo_redemptions;
begin
 if p_result not in ('granted','failed') then raise exception 'invalid_reward'; end if;
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 select * into r from club_promo_redemptions where registration_id=p_id for update;
 if not found or r.status<>'done' then return false; end if;
 if r.reward is not null then return r.reward=p_result; end if;
 update club_promo_redemptions set reward=p_result,rewarded_at=now() where registration_id=p_id;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.club_promo_track()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 update club_promo_redemptions set status=new.status,gizmo_user_id=coalesce(new.gizmo_user_id,gizmo_user_id),
  decided_at=case when new.status in ('done','rejected','expired') then coalesce(decided_at,now()) else decided_at end
 where registration_id=new.id;
 return null;
end $function$;

CREATE OR REPLACE FUNCTION public.club_registration_cancel(p_user bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r club_registration_requests;
begin
 select * into r from club_registration_requests where telegram_id=p_user order by created_at desc limit 1 for update;
 if not found then return true; end if;
 if r.status in ('rejected','expired') then return true; end if;
 if r.status<>'awaiting_admin' then raise exception 'Анкету уже обрабатывает администратор. Подойдите к стойке'; end if;
 update club_registration_requests set status='rejected',cipher=null,public_data='{}'::jsonb,updated_at=now() where id=r.id;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.club_registration_claim(p_worker uuid, p_id uuid, p_confirmed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r club_registration_requests;
begin
 if p_confirmed is distinct from true then raise exception 'Подтвердите проверку личности'; end if;
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 perform club_registration_cleanup();
 select * into r from club_registration_requests where id=p_id for update;
 if not found or r.status<>'awaiting_admin' or r.cipher is null then raise exception 'Анкета уже обработана или требует проверки'; end if;
 update club_registration_requests set status='processing',worker_id=p_worker,cipher=null,updated_at=now() where id=p_id;
 return jsonb_build_object('id',r.id,'telegram_id',r.telegram_id,'cipher',r.cipher,'expires_at',r.expires_at);
end $function$;

CREATE OR REPLACE FUNCTION public.club_registration_cleanup()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 update club_registration_requests set status='expired',cipher=null,public_data='{}',updated_at=now() where status='awaiting_admin' and expires_at<=now();
 update club_registration_requests set status='attention',cipher=null,updated_at=now() where status='processing' and updated_at<now()-interval '15 minutes';
 delete from club_registration_requests where status in ('done','rejected','expired') and updated_at<now()-interval '7 days';
end $function$;

CREATE OR REPLACE FUNCTION public.club_registration_finish(p_worker uuid, p_id uuid, p_status text, p_uid integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r club_registration_requests;
begin
 if p_status not in ('done','rejected','attention') or (p_status='done' and (p_uid is null or p_uid<=0)) then raise exception 'invalid_outcome'; end if;
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 select * into r from club_registration_requests where id=p_id for update;
 if not found then raise exception 'application_owner_mismatch'; end if;
 if r.status=p_status and r.gizmo_user_id is not distinct from p_uid then return true; end if;
 if not (r.status='processing' and r.worker_id is not distinct from p_worker)
    and not (r.status='attention' and p_status='done' and (r.gizmo_user_id is null or r.gizmo_user_id=p_uid)) then return false; end if;
 if p_status='done' then
  perform pg_advisory_xact_lock(r.telegram_id);
  insert into profiles(telegram_id,gizmo_user_id,username,first_name,last_name)
   values(r.telegram_id,p_uid,r.public_data->>'username',r.public_data->>'first_name',r.public_data->>'last_name')
   on conflict(telegram_id) do update set gizmo_user_id=excluded.gizmo_user_id,username=excluded.username,first_name=excluded.first_name,last_name=excluded.last_name;
 end if;
 update club_registration_requests set status=p_status,gizmo_user_id=p_uid,cipher=null,public_data=case when p_status='attention' then public_data else '{}'::jsonb end,updated_at=now() where id=p_id;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.club_registration_reconcile(p_worker uuid, p_id uuid, p_proof uuid, p_uid integer, p_confirmed boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r club_registration_requests;
begin
 if p_confirmed is distinct from true then raise exception 'Подтвердите очную сверку аккаунта'; end if;
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 select * into r from club_registration_requests where id=p_id for update;
 if not found then raise exception 'Заявка не найдена'; end if;
 if r.status='done' and exists(select 1 from club_registration_reconciliations where request_id=p_id and proof_id=p_proof and gizmo_user_id=p_uid) then return true; end if;
 if r.status<>'attention' or (r.gizmo_user_id is not null and r.gizmo_user_id<>p_uid) then raise exception 'Аккаунт или статус заявки изменён'; end if;
 -- Lock the existing link, never create or replace it during reconciliation.
 perform 1 from profiles where telegram_id=r.telegram_id and gizmo_user_id=p_uid for update;
 if not found then raise exception 'Гость должен заново войти в нужный аккаунт'; end if;
 perform 1 from club_auth_requests where id=p_proof and telegram_id=r.telegram_id and gizmo_user_id=p_uid and status='done'
 and purpose='login' and created_at>=r.updated_at and created_at>now()-interval '10 minutes' and created_at<=now() for update;
 if not found then raise exception 'Нет свежего подтверждённого входа гостя'; end if;
 insert into club_registration_reconciliations(request_id,proof_id,gizmo_user_id,worker_id) values(p_id,p_proof,p_uid,p_worker);
 update club_registration_requests set status='done',gizmo_user_id=p_uid,cipher=null,public_data='{}',updated_at=now() where id=p_id;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.club_registration_reject(p_worker uuid, p_id uuid, p_confirmed boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if p_confirmed is distinct from true then raise exception 'Подтвердите отклонение'; end if;
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 perform club_registration_cleanup();
 update club_registration_requests set status='rejected',cipher=null,public_data='{}',updated_at=now() where id=p_id and status='awaiting_admin';
 if found then return true; end if;
 return exists(select 1 from club_registration_requests where id=p_id and status='rejected');
end $function$;

CREATE OR REPLACE FUNCTION public.club_registration_review(p_worker uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r club_registration_requests; proof jsonb;
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 select * into r from club_registration_requests where id=p_id;
 if not found or r.status<>'attention' then raise exception 'Для сверки нужна спорная заявка'; end if;
 select jsonb_build_object('id',a.id,'gizmo_user_id',a.gizmo_user_id) into proof
 from club_auth_requests a join profiles p on p.telegram_id=a.telegram_id and p.gizmo_user_id=a.gizmo_user_id
 where a.telegram_id=r.telegram_id and a.status='done' and a.purpose='login' and a.created_at>=r.updated_at
 and a.created_at>now()-interval '10 minutes' and a.created_at<=now()
 and (r.gizmo_user_id is null or r.gizmo_user_id=a.gizmo_user_id)
 and not exists(select 1 from club_registration_reconciliations x where x.proof_id=a.id)
 order by a.created_at desc limit 1;
 return jsonb_build_object('request',to_jsonb(r)-'cipher'-'worker_id','proof',proof);
end $function$;

CREATE OR REPLACE FUNCTION public.club_registration_status(p_user bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r club_registration_requests; profile jsonb;
begin
 perform club_registration_cleanup();
 select * into r from club_registration_requests where telegram_id=p_user order by created_at desc limit 1;
 if not found then return null; end if;
 if r.status='done' then select to_jsonb(p) into profile from (select telegram_id,gizmo_user_id,username,first_name,last_name from profiles where telegram_id=p_user and gizmo_user_id=r.gizmo_user_id) p; end if;
 return jsonb_build_object('id',r.id,'status',r.status,'expires_at',r.expires_at,'profile',profile);
end $function$;

CREATE OR REPLACE FUNCTION public.club_registration_submit(p_id uuid, p_user bigint, p_data jsonb, p_cipher text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare existing uuid; promo text; linked jsonb; tester boolean;
begin
 perform pg_advisory_xact_lock(p_user);
 perform club_registration_cleanup();
 tester:=exists(select 1 from club_promo_testers where telegram_id=p_user);
 select id into existing from club_registration_requests where telegram_id=p_user and status in ('awaiting_admin','processing','attention');
 if found then return existing; end if;
 if not tester and (select count(*) from club_registration_requests where telegram_id=p_user and created_at>now()-interval '1 day')>=3 then raise exception 'Не больше трёх анкет в сутки'; end if;
 if p_user<=0 or p_cipher is null or length(p_cipher)>12000 or jsonb_typeof(p_data)<>'object' then raise exception 'invalid_application'; end if;
 promo:=nullif(upper(trim(coalesce(p_data->>'promo_code',''))),'');
 if promo is not null and not exists(select 1 from club_promo_codes where code=promo and active) then raise exception 'Промокод не найден. Проверьте его или продолжите без промокода'; end if;
 if promo is not null and not tester and exists(select 1 from club_promo_redemptions where telegram_id=p_user and (status='done' or reward='granted')) then raise exception 'С этого Telegram бесплатный час уже получали. Продолжите без промокода'; end if;
 select jsonb_build_object('username',username,'gizmo_user_id',gizmo_user_id) into linked from profiles where telegram_id=p_user and gizmo_user_id>0;
 -- Never accept extra fields such as a plaintext password into public summaries.
 insert into club_registration_requests(id,telegram_id,public_data,cipher) values(p_id,p_user,jsonb_strip_nulls(jsonb_build_object('username',p_data->>'username','first_name',p_data->>'first_name','last_name',p_data->>'last_name','mobile_phone',p_data->>'mobile_phone','birth_date',p_data->>'birth_date','sex',p_data->'sex','promo_code',promo,'linked_account',linked)),p_cipher);
 if promo is not null then insert into club_promo_redemptions(registration_id,telegram_id,code) values(p_id,p_user,promo); end if;
 return p_id;
end $function$;

CREATE OR REPLACE FUNCTION public.club_test_account_removed(p_worker uuid, p_uid integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 -- Only accounts that a tester's Telegram created; a guest's account is never touched.
 if not exists(select 1 from club_registration_requests where gizmo_user_id=p_uid and status='done' and telegram_id in (select telegram_id from club_promo_testers)) then return false; end if;
 delete from club_promo_redemptions where gizmo_user_id=p_uid or registration_id in (select id from club_registration_requests where gizmo_user_id=p_uid);
 delete from club_registration_reconciliations where gizmo_user_id=p_uid;
 delete from club_food_orders where gizmo_user_id=p_uid;
 delete from club_food_seats where gizmo_user_id=p_uid;
 delete from club_events where booking_id in (select id from club_bookings where gizmo_user_id=p_uid);
 delete from club_bookings where gizmo_user_id=p_uid;
 delete from club_commands where gizmo_user_id=p_uid;
 delete from club_password_grants where gizmo_user_id=p_uid;
 delete from club_accounts where gizmo_user_id=p_uid;
 delete from club_auth_requests where gizmo_user_id=p_uid;
 -- The Telegram may hold other accounts: the profile is only unlinked (0 = unlinked, see 026).
 update profiles set gizmo_user_id=0 where gizmo_user_id=p_uid;
 delete from club_registration_requests where gizmo_user_id=p_uid;
 insert into club_test_removed(gizmo_user_id) values(p_uid) on conflict do nothing;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.club_test_accounts(p_worker uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('gizmo_user_id',r.gizmo_user_id,'created_at',r.created_at,'code',p.code) order by r.created_at desc)
  from club_registration_requests r left join club_promo_redemptions p on p.registration_id=r.id
  where r.status='done' and r.gizmo_user_id>0 and r.telegram_id in (select telegram_id from club_promo_testers)
   and not exists(select 1 from club_test_removed x where x.gizmo_user_id=r.gizmo_user_id)),'[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.club_worker_lease(p_worker uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 update club_worker set protocol=case when worker_id is distinct from p_worker then 1 else protocol end,worker_id=p_worker,lease_until=now()+interval '30 seconds'
 where id=true and (worker_id=p_worker or lease_until is null or lease_until<now());
 return found;
end $function$;

CREATE OR REPLACE FUNCTION public.club_worker_poll(p_worker uuid, p_after bigint DEFAULT 0, p_hosts jsonb DEFAULT NULL::jsonb, p_accounts jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result jsonb; grants jsonb;
begin
 result:=club_worker_poll_before_password_grants(p_worker,p_after,p_hosts,p_accounts);perform club_password_cleanup();
 select coalesce(jsonb_agg(to_jsonb(g)-'cipher'-'worker_id'-'request_id'),'[]') into grants from (select * from club_password_grants where status in ('authorized','queued','processing','attention') order by created_at limit 100) g;
 return jsonb_set(result,'{desk,password_grants}',grants);
end $function$;

CREATE OR REPLACE FUNCTION public.club_worker_poll_before_password_grants(p_worker uuid, p_after bigint DEFAULT 0, p_hosts jsonb DEFAULT NULL::jsonb, p_accounts jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result jsonb; applications jsonb;
begin
 result:=club_worker_poll_before_registration(p_worker,p_after,p_hosts,p_accounts);
 perform club_registration_cleanup();
 select coalesce(jsonb_agg(x order by x->>'created_at' desc),'[]') into applications from (select to_jsonb(r)-'cipher'-'worker_id' as x from club_registration_requests r where status in ('awaiting_admin','processing','attention') order by created_at desc limit 300) q;
 return jsonb_set(result,'{desk,registrations}',applications);
end $function$;

CREATE OR REPLACE FUNCTION public.club_worker_poll_before_registration(p_worker uuid, p_after bigint DEFAULT 0, p_hosts jsonb DEFAULT NULL::jsonb, p_accounts jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare item jsonb; result jsonb;
begin
 if not club_worker_lease(p_worker) then raise exception 'worker_lease_conflict'; end if;
 if jsonb_typeof(p_accounts) <> 'array' or jsonb_array_length(p_accounts)>10 then raise exception 'bad_accounts'; end if;
 if p_hosts is not null then
  if jsonb_typeof(p_hosts)<>'array' or jsonb_array_length(p_hosts)>100 then raise exception 'bad_hosts'; end if;
  for item in select value from jsonb_array_elements(p_hosts) loop
   if coalesce(item->>'host_id','')='' or coalesce(item->>'status','') not in ('free','busy','reserved','broken') then raise exception 'bad_host'; end if;
   insert into hosts_cache(host_id,zone,status,gizmo_host_id,updated_at)
   values(item->>'host_id',item->>'zone',item->>'status',(jsonb_populate_record(null::hosts_cache,item)).gizmo_host_id,least(now(),coalesce((item->>'updated_at')::timestamptz,now())))
   on conflict(host_id) do update set zone=excluded.zone,status=excluded.status,gizmo_host_id=excluded.gizmo_host_id,updated_at=excluded.updated_at;
  end loop;
 end if;
 for item in select value from jsonb_array_elements(p_accounts) loop
  update club_accounts set data=item->'data',updated_at=least(now(),(item->>'observed_at')::timestamptz)
  where telegram_id=(item->>'telegram_id')::bigint and gizmo_user_id=(item->>'gizmo_user_id')::integer;
  if found then
   update profiles set username=coalesce(item->'data'->>'username',username),
    first_name=coalesce(item->'data'->>'firstName',first_name),last_name=coalesce(item->'data'->>'lastName',last_name)
   where telegram_id=(item->>'telegram_id')::bigint and gizmo_user_id=(item->>'gizmo_user_id')::integer;
  end if;
 end loop;
 update club_worker set protocol=2 where worker_id=p_worker;
 -- Keep the same auth expiry/rate-limit window; never return credentials in this poll.
 update club_auth_requests set status='failed',cipher=null where status in ('pending','running') and created_at<now()-interval '3 minutes';
 delete from club_auth_requests where created_at<now()-interval '1 day';
 select jsonb_build_object(
  'eco_version',1,'lease_seconds',25,
  'bookings',coalesce((select jsonb_agg(x order by x->>'starts_at') from
   (select (to_jsonb(b)-'code_hash')||jsonb_build_object('username',coalesce(p.username,'Гость')) as x
    from club_bookings b left join profiles p using(telegram_id) where b.status not in ('cancelled','expired','completed')) q),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(x) from
   (select to_jsonb(e)||jsonb_build_object('instant',coalesce(b.instant,false)) as x from club_events e left join club_bookings b on b.id=e.booking_id where e.id>p_after order by e.id limit 200) q),'[]'::jsonb),
  'desk',jsonb_build_object(
   'accounts',coalesce((select jsonb_agg(x) from (select * from club_accounts where requested_at>now()-interval '60 seconds' order by updated_at nulls first limit 50) x),'[]'::jsonb),
   'commands',coalesce((select jsonb_agg(x) from ((select * from club_commands where status in ('queued','running') order by created_at limit 50) union all (select * from club_commands where status='awaiting_admin' order by created_at limit 50)) x),'[]'::jsonb)),
  'auth_pending',exists(select 1 from club_auth_requests where status='pending')
 ) into result;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.club_worker_transition(p_worker uuid, p_id uuid, p_from text, p_to text, p_message text, p_hash text DEFAULT NULL::text, p_code_expiry timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then return false; end if;
 if p_to not in ('waiting','holding','checkin_pending','in_session','attention','cancelled','expired','completed') then return false; end if;
 update club_bookings set status=p_to,message=left(p_message,500),code_hash=p_hash,code_expires_at=p_code_expiry,code_attempts=case when p_hash is not null then 0 else code_attempts end,updated_at=now()
 where id=p_id and status=p_from;
 if not found then return false; end if;
 if p_to in ('attention','waiting') and p_to<>p_from then insert into club_events(booking_id,kind) values(p_id,p_to); end if;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.reserve_club_host(p_telegram_id bigint, p_host_id text)
 RETURNS reservations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.reservations; host public.hosts_cache;
begin
  perform pg_advisory_xact_lock(15837812);
  if exists(select 1 from club_settings where enabled) or exists(select 1 from club_bookings where status not in ('cancelled','expired','completed')) then
    raise exception 'Используйте новую систему бронирования. Обновите приложение';
  end if;
  perform pg_advisory_xact_lock(15837811);
  if (select count(*) from public.reservations
      where telegram_id=p_telegram_id and status in ('pending','confirmed')
      and created_at > now()-interval '60 minutes') >= 2 then
    raise exception 'Максимум две активные брони. Позвоните в клуб: +7 (495) 583-78-11';
  end if;
  select * into host from public.hosts_cache where host_id=p_host_id for update;
  if not found or host.updated_at is null or host.updated_at < now()-interval '30 seconds' then
    raise exception 'Нет свежих статусов от агента. Попробуйте позже';
  end if;
  if host.status <> 'free' or exists(select 1 from public.reservations
      where host_id=p_host_id and status in ('pending','confirmed')
      and created_at > now()-interval '60 minutes') then
    raise exception 'Компьютер уже недоступен для бронирования';
  end if;
  insert into public.reservations(telegram_id,host_id,duration_hours,price,status)
    values(p_telegram_id,p_host_id,1,0,'pending') returning * into result;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
    new.updated_at = now();
    return new;
end;
$function$;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER club_promo_track AFTER UPDATE OF status, gizmo_user_id ON public.club_registration_requests FOR EACH ROW EXECUTE FUNCTION club_promo_track();

-- Grants: nothing for anon/authenticated unless listed; service_role gets everything
revoke all on all tables in schema public from anon,authenticated;
grant all on all tables in schema public to service_role;grant all on all sequences in schema public to service_role;
grant insert on public."hosts_cache" to anon;
grant select on public."hosts_cache" to anon;
grant update on public."hosts_cache" to anon;
grant delete on public."hosts_cache" to anon;
grant truncate on public."hosts_cache" to anon;
grant references on public."hosts_cache" to anon;
grant trigger on public."hosts_cache" to anon;
grant insert on public."hosts_cache" to authenticated;
grant select on public."hosts_cache" to authenticated;
grant update on public."hosts_cache" to authenticated;
grant delete on public."hosts_cache" to authenticated;
grant truncate on public."hosts_cache" to authenticated;
grant references on public."hosts_cache" to authenticated;
grant trigger on public."hosts_cache" to authenticated;
grant insert on public."users_map" to anon;
grant select on public."users_map" to anon;
grant update on public."users_map" to anon;
grant delete on public."users_map" to anon;
grant truncate on public."users_map" to anon;
grant references on public."users_map" to anon;
grant trigger on public."users_map" to anon;
grant insert on public."users_map" to authenticated;
grant select on public."users_map" to authenticated;
grant update on public."users_map" to authenticated;
grant delete on public."users_map" to authenticated;
grant truncate on public."users_map" to authenticated;
grant references on public."users_map" to authenticated;
grant trigger on public."users_map" to authenticated;
grant insert on public."auth_requests" to anon;
grant select on public."auth_requests" to anon;
grant update on public."auth_requests" to anon;
grant delete on public."auth_requests" to anon;
grant truncate on public."auth_requests" to anon;
grant references on public."auth_requests" to anon;
grant trigger on public."auth_requests" to anon;
grant insert on public."auth_requests" to authenticated;
grant select on public."auth_requests" to authenticated;
grant update on public."auth_requests" to authenticated;
grant delete on public."auth_requests" to authenticated;
grant truncate on public."auth_requests" to authenticated;
grant references on public."auth_requests" to authenticated;
grant trigger on public."auth_requests" to authenticated;
grant insert on public."profiles" to anon;
grant select on public."profiles" to anon;
grant update on public."profiles" to anon;
grant delete on public."profiles" to anon;
grant truncate on public."profiles" to anon;
grant references on public."profiles" to anon;
grant trigger on public."profiles" to anon;
grant insert on public."profiles" to authenticated;
grant select on public."profiles" to authenticated;
grant update on public."profiles" to authenticated;
grant delete on public."profiles" to authenticated;
grant truncate on public."profiles" to authenticated;
grant references on public."profiles" to authenticated;
grant trigger on public."profiles" to authenticated;
grant insert on public."reservations" to anon;
grant select on public."reservations" to anon;
grant update on public."reservations" to anon;
grant delete on public."reservations" to anon;
grant truncate on public."reservations" to anon;
grant references on public."reservations" to anon;
grant trigger on public."reservations" to anon;
grant insert on public."reservations" to authenticated;
grant select on public."reservations" to authenticated;
grant update on public."reservations" to authenticated;
grant delete on public."reservations" to authenticated;
grant truncate on public."reservations" to authenticated;
grant references on public."reservations" to authenticated;
grant trigger on public."reservations" to authenticated;
revoke execute on all functions in schema public from public,anon,authenticated;grant execute on all functions in schema public to service_role;
grant execute on function public.set_updated_at() to anon;
grant execute on function public.set_updated_at() to authenticated;
notify pgrst,'reload schema';
