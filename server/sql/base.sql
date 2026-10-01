-- Fresh, dedicated database only. Compatibility roles, not a Supabase installation.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
revoke create on schema public from public;
create table public.profiles(
 telegram_id bigint primary key, gizmo_user_id integer, username text,
 first_name text,last_name text,created_at timestamptz default now(),updated_at timestamptz default now()
);
create table public.hosts_cache(host_id text primary key,zone text,status text,gizmo_host_id integer,updated_at timestamptz);
create table public.reservations(id uuid primary key default gen_random_uuid(),telegram_id bigint references public.profiles(telegram_id),host_id text,duration_hours numeric,price numeric,status text default 'pending',created_at timestamptz default now());
grant usage on schema public to service_role;
grant select,insert,update on public.profiles,public.hosts_cache to service_role;
grant select on public.reservations to service_role;
