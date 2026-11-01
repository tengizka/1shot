-- SMM dashboard (tengizka.fun/smm/1shot/stats): ad spend, site visits and club results per promo code.
-- Only aggregates live here: no phones, names or Telegram ids. Viewers sign in with Supabase Auth
-- and see data only after an admin grants access; tables stay closed, the page reads one RPC.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table public.smm_viewers(
 user_id uuid primary key references auth.users(id) on delete cascade,
 email text not null,
 name text,
 role text not null default 'viewer' check(role in ('viewer','admin')),
 created_at timestamptz not null default now()
);
create table public.smm_access_requests(
 user_id uuid primary key references auth.users(id) on delete cascade,
 email text not null,
 name text check(name is null or length(name)<=80),
 created_at timestamptz not null default now()
);
-- Ads per campaign per day (VK Ads, Yandex Direct). code = promo code the campaign links to.
create table public.smm_ad_daily(
 day date not null,
 source text not null check(source in ('vk','direct')),
 campaign_id text not null,
 campaign_name text,
 code text not null,
 impressions bigint not null default 0,
 clicks bigint not null default 0,
 spend numeric(12,2) not null default 0,
 updated_at timestamptz not null default now(),
 primary key(day,source,campaign_id)
);
-- Optional manual override: which promo code a campaign belongs to.
create table public.smm_campaign_codes(
 source text not null check(source in ('vk','direct')),
 campaign_id text not null,
 code text not null,
 primary key(source,campaign_id)
);
-- Landing traffic from Yandex Metrica, split by the ?p= promo code.
create table public.smm_site_daily(
 day date not null,
 code text not null,
 visits bigint not null default 0,
 bot_opens bigint not null default 0,
 updated_at timestamptz not null default now(),
 primary key(day,code)
);
-- Club results that only Gizmo knows, pushed by Desk (aggregates per code).
create table public.smm_club_stats(
 code text primary key,
 guests integer not null default 0,
 returned integer not null default 0,
 revenue numeric(12,2) not null default 0,
 updated_at timestamptz not null default now()
);
-- Last run of each source, for the "data is fresh" line and errors.
create table public.smm_sync_status(
 source text primary key,
 ok boolean not null,
 message text,
 updated_at timestamptz not null default now()
);
-- Short-lived API tokens (VK Ads issues a limited number of them), service role only.
create table public.smm_tokens(
 source text primary key,
 access_token text,
 refresh_token text,
 expires_at timestamptz
);

alter table public.smm_viewers enable row level security;
alter table public.smm_access_requests enable row level security;
alter table public.smm_ad_daily enable row level security;
alter table public.smm_campaign_codes enable row level security;
alter table public.smm_site_daily enable row level security;
alter table public.smm_club_stats enable row level security;
alter table public.smm_sync_status enable row level security;
alter table public.smm_tokens enable row level security;
revoke all on public.smm_viewers,public.smm_access_requests,public.smm_ad_daily,public.smm_campaign_codes,public.smm_site_daily,public.smm_club_stats,public.smm_sync_status,public.smm_tokens from public,anon,authenticated;
grant all on public.smm_viewers,public.smm_access_requests,public.smm_ad_daily,public.smm_campaign_codes,public.smm_site_daily,public.smm_club_stats,public.smm_sync_status,public.smm_tokens to service_role;

create function public.smm_role() returns text language sql stable security definer set search_path=public as $$
 select role from smm_viewers where user_id=auth.uid()
$$;

-- Signed-in user without access asks for it; the admin sees the request on the page.
create function public.smm_request_access(p_name text) returns text language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); mail text:=auth.jwt()->>'email';
begin
 if uid is null then raise exception 'Войдите в аккаунт'; end if;
 if exists(select 1 from smm_viewers where user_id=uid) then return 'granted'; end if;
 insert into smm_access_requests(user_id,email,name) values(uid,coalesce(mail,''),nullif(left(trim(coalesce(p_name,'')),80),''))
 on conflict(user_id) do update set name=coalesce(excluded.name,smm_access_requests.name);
 return 'pending';
end $$;

create function public.smm_admin_list() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if smm_role() is distinct from 'admin' then raise exception 'Нет прав'; end if;
 return jsonb_build_object(
  'viewers',(select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'email',email,'name',name,'role',role) order by created_at),'[]') from smm_viewers),
  'requests',(select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'email',email,'name',name,'created_at',created_at) order by created_at),'[]') from smm_access_requests));
end $$;

create function public.smm_admin_set(p_user uuid,p_role text) returns boolean language plpgsql security definer set search_path=public as $$
declare r smm_access_requests;
begin
 if smm_role() is distinct from 'admin' then raise exception 'Нет прав'; end if;
 if p_user=auth.uid() then raise exception 'Свою роль менять нельзя'; end if;
 if p_role is null then
  delete from smm_viewers where user_id=p_user; delete from smm_access_requests where user_id=p_user; return true;
 end if;
 if p_role not in ('viewer','admin') then raise exception 'Неизвестная роль'; end if;
 select * into r from smm_access_requests where user_id=p_user;
 insert into smm_viewers(user_id,email,name,role)
  select p_user,coalesce(r.email,u.email,''),r.name,p_role from auth.users u where u.id=p_user
 on conflict(user_id) do update set role=excluded.role;
 delete from smm_access_requests where user_id=p_user;
 return true;
end $$;

-- Everything the dashboard shows, for one period. Test accounts are left out, like in the club report.
create function public.smm_dashboard(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if smm_role() is null then raise exception 'Нет доступа'; end if;
 return jsonb_build_object(
  'role',smm_role(),
  'codes',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'channel',channel,'active',active) order by code),'[]') from club_promo_codes),
  'ads',(select coalesce(jsonb_agg(jsonb_build_object('day',day,'source',source,'code',code,'campaign',campaign_name,'impressions',impressions,'clicks',clicks,'spend',spend) order by day),'[]') from smm_ad_daily where day between p_from and p_to),
  'site',(select coalesce(jsonb_agg(jsonb_build_object('day',day,'code',code,'visits',visits,'bot_opens',bot_opens) order by day),'[]') from smm_site_daily where day between p_from and p_to),
  'forms',(select coalesce(jsonb_agg(x order by x->>'day'),'[]') from (
    select jsonb_build_object('day',(created_at at time zone 'Europe/Moscow')::date,'code',code,'forms',count(*),
      'done',count(*) filter(where status='done'),'waiting',count(*) filter(where status in ('awaiting_admin','processing','attention')),
      'granted',count(*) filter(where reward='granted')) x
    from club_promo_redemptions r
    where (created_at at time zone 'Europe/Moscow')::date between p_from and p_to
      and (r.telegram_id is null or r.telegram_id not in (select telegram_id from club_promo_testers))
      and (r.gizmo_user_id is null or r.gizmo_user_id not in (select gizmo_user_id from club_test_removed))
    group by (created_at at time zone 'Europe/Moscow')::date,code) q),
  'club',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'guests',guests,'returned',returned,'revenue',revenue,'updated_at',updated_at)),'[]') from smm_club_stats),
  'sync',(select coalesce(jsonb_agg(jsonb_build_object('source',source,'ok',ok,'message',message,'updated_at',updated_at)),'[]') from smm_sync_status));
end $$;

revoke all on function public.smm_role(),public.smm_request_access(text),public.smm_admin_list(),public.smm_admin_set(uuid,text),public.smm_dashboard(date,date) from public,anon;
grant execute on function public.smm_role(),public.smm_request_access(text),public.smm_admin_list(),public.smm_admin_set(uuid,text),public.smm_dashboard(date,date) to authenticated;

-- Desk pushes per-code totals computed from Gizmo (no personal data).
create function public.smm_club_push(p_rows jsonb) returns integer language plpgsql security definer set search_path=public as $$
declare n integer:=0; r jsonb;
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>50 then raise exception 'invalid_rows'; end if;
 for r in select * from jsonb_array_elements(p_rows) loop
  if not exists(select 1 from club_promo_codes where code=r->>'code') then continue; end if;
  insert into smm_club_stats(code,guests,returned,revenue,updated_at)
  values(r->>'code',greatest(0,(r->>'guests')::int),greatest(0,(r->>'returned')::int),greatest(0,(r->>'revenue')::numeric),now())
  on conflict(code) do update set guests=excluded.guests,returned=excluded.returned,revenue=excluded.revenue,updated_at=now();
  n:=n+1;
 end loop;
 insert into smm_sync_status(source,ok,message,updated_at) values('desk',true,n||' кодов',now())
 on conflict(source) do update set ok=true,message=excluded.message,updated_at=now();
 return n;
end $$;
revoke all on function public.smm_club_push(jsonb) from public,anon,authenticated;
grant execute on function public.smm_club_push(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
