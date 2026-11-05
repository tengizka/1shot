-- Guests outside Telegram (the Android app, later the web version) sign in with their club nick and password.
-- The password goes the usual way (encrypted, Desk checks it in Gizmo). On success the app gets a session key;
-- the account lives under a synthetic negative id in place of a Telegram id, so bookings and the rest work unchanged.
create table if not exists public.club_app_sessions(
 token_hash text primary key,
 telegram_id bigint not null,
 created_at timestamptz not null default now(),
 last_seen timestamptz not null default now()
);
alter table public.club_app_sessions enable row level security;
revoke all on public.club_app_sessions from public,anon,authenticated;
grant all on public.club_app_sessions to service_role;

alter table public.club_auth_requests add column if not exists app_secret_hash text;
alter table public.club_auth_requests add column if not exists app_key text;

create or replace function public.club_app_login(p_id uuid,p_cipher text,p_secret_hash text,p_key text) returns uuid
language plpgsql security definer set search_path=public as $$
declare synthetic bigint;
begin
 if p_secret_hash !~ '^[0-9a-f]{64}$' or p_key !~ '^[0-9a-f]{64}$' then raise exception 'Некорректный запрос'; end if;
 perform pg_advisory_xact_lock(hashtext('club_app_login'));
 if (select count(*) from club_auth_requests where app_key=p_key and created_at>now()-interval '15 minutes')>=5 then raise exception 'Слишком много попыток. Подождите 15 минут'; end if;
 if (select count(*) from club_auth_requests where app_key is not null and created_at>now()-interval '15 minutes')>=60 then raise exception 'Сейчас много входов. Попробуйте через пару минут'; end if;
 synthetic:=-(1+floor(random()*9e15))::bigint;
 insert into club_auth_requests(id,telegram_id,cipher,purpose,app_secret_hash,app_key) values(p_id,synthetic,p_cipher,'login',p_secret_hash,p_key);
 return p_id;
end $$;

create or replace function public.club_app_login_status(p_id uuid,p_secret_hash text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r club_auth_requests; p profiles;
begin
 select * into r from club_auth_requests where id=p_id and app_secret_hash=p_secret_hash;
 if not found then raise exception 'Запрос не найден'; end if;
 if r.status in ('pending','running') then
  return jsonb_build_object('status',case when r.created_at<now()-interval '3 minutes' then 'failed' else 'pending' end);
 end if;
 if r.status<>'done' then return jsonb_build_object('status',r.status); end if;
 select * into p from profiles where telegram_id=r.telegram_id and gizmo_user_id=r.gizmo_user_id;
 if not found then return jsonb_build_object('status','pending'); end if;
 insert into club_app_sessions(token_hash,telegram_id) values(p_secret_hash,r.telegram_id) on conflict do nothing;
 return jsonb_build_object('status','done','profile',jsonb_build_object('telegram_id',p.telegram_id,'gizmo_user_id',p.gizmo_user_id,'username',p.username));
end $$;

-- Session key → account; unused for 90 days, it expires.
create or replace function public.club_app_user(p_token_hash text) returns bigint
language plpgsql security definer set search_path=public as $$
declare uid bigint;
begin
 delete from club_app_sessions where last_seen<now()-interval '90 days';
 update club_app_sessions set last_seen=now() where token_hash=p_token_hash and last_seen<now()-interval '1 hour';
 select telegram_id into uid from club_app_sessions where token_hash=p_token_hash;
 return uid;
end $$;

create or replace function public.club_app_logout(p_token_hash text) returns void
language sql security definer set search_path=public as $$ delete from club_app_sessions where token_hash=p_token_hash $$;

revoke all on function public.club_app_login(uuid,text,text,text),public.club_app_login_status(uuid,text),public.club_app_user(text),public.club_app_logout(text) from public,anon,authenticated;
grant execute on function public.club_app_login(uuid,text,text,text),public.club_app_login_status(uuid,text),public.club_app_user(text),public.club_app_logout(text) to service_role;
notify pgrst,'reload schema';
