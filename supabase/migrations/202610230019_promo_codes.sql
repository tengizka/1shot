-- Promo codes for ad channels. Each code marks where a new guest came from;
-- after in-person approval Desk grants the free hour once and reports the result here.
-- Redemptions outlive registration requests (those are purged after 7 days) and feed the stats.
begin;
create table public.club_promo_codes(
 code text primary key check(code ~ '^[A-Z0-9_-]{2,32}$'),
 channel text not null check(length(channel) between 1 and 80),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.club_promo_redemptions(
 registration_id uuid primary key,
 telegram_id bigint not null,
 code text not null references public.club_promo_codes(code),
 status text not null default 'awaiting_admin' check(status in ('awaiting_admin','processing','attention','done','rejected','expired')),
 gizmo_user_id integer check(gizmo_user_id>0),
 reward text check(reward in ('granted','failed')),
 created_at timestamptz not null default now(),
 decided_at timestamptz,
 rewarded_at timestamptz
);
create index club_promo_redemptions_code on public.club_promo_redemptions(code,created_at);
alter table public.club_promo_codes enable row level security;
alter table public.club_promo_redemptions enable row level security;
revoke all on public.club_promo_codes,public.club_promo_redemptions from public,anon,authenticated;
grant all on public.club_promo_codes,public.club_promo_redemptions to service_role;

insert into public.club_promo_codes(code,channel) values
 ('LEVELUP','Яндекс Поиск'),('RESPAWN','Яндекс Карты'),('HEADSHOT','ВКонтакте')
on conflict do nothing;

create or replace function public.club_registration_submit(p_id uuid,p_user bigint,p_data jsonb,p_cipher text) returns uuid language plpgsql security definer set search_path=public as $$
declare existing uuid; promo text;
begin
 perform pg_advisory_xact_lock(p_user);
 perform club_registration_cleanup();
 select id into existing from club_registration_requests where telegram_id=p_user and status in ('awaiting_admin','processing','attention');
 if found then return existing; end if;
 if exists(select 1 from profiles where telegram_id=p_user and gizmo_user_id>0) then raise exception 'Аккаунт уже связан. Используйте вход'; end if;
 if (select count(*) from club_registration_requests where telegram_id=p_user and created_at>now()-interval '1 day')>=3 then raise exception 'Не больше трёх анкет в сутки'; end if;
 if p_user<=0 or p_cipher is null or length(p_cipher)>12000 or jsonb_typeof(p_data)<>'object' then raise exception 'invalid_application'; end if;
 promo:=nullif(upper(trim(coalesce(p_data->>'promo_code',''))),'');
 if promo is not null and not exists(select 1 from club_promo_codes where code=promo and active) then raise exception 'Промокод не найден. Проверьте его или продолжите без промокода'; end if;
 -- Never accept extra fields such as a plaintext password into public summaries.
 insert into club_registration_requests(id,telegram_id,public_data,cipher) values(p_id,p_user,jsonb_strip_nulls(jsonb_build_object('username',p_data->>'username','first_name',p_data->>'first_name','last_name',p_data->>'last_name','mobile_phone',p_data->>'mobile_phone','birth_date',p_data->>'birth_date','sex',p_data->'sex','promo_code',promo)),p_cipher);
 if promo is not null then insert into club_promo_redemptions(registration_id,telegram_id,code) values(p_id,p_user,promo); end if;
 return p_id;
end $$;

-- Mirror the request lifecycle without touching the audited registration functions.
create function public.club_promo_track() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update club_promo_redemptions set status=new.status,gizmo_user_id=coalesce(new.gizmo_user_id,gizmo_user_id),
  decided_at=case when new.status in ('done','rejected','expired') then coalesce(decided_at,now()) else decided_at end
 where registration_id=new.id;
 return null;
end $$;
create trigger club_promo_track after update of status,gizmo_user_id on public.club_registration_requests for each row execute function public.club_promo_track();

-- One reward report per redemption. Repeating the same result is harmless; changing it is refused.
create function public.club_promo_reward(p_worker uuid,p_id uuid,p_result text) returns boolean language plpgsql security definer set search_path=public as $$
declare r club_promo_redemptions;
begin
 if p_result not in ('granted','failed') then raise exception 'invalid_reward'; end if;
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 select * into r from club_promo_redemptions where registration_id=p_id for update;
 if not found or r.status<>'done' then return false; end if;
 if r.reward is not null then return r.reward=p_result; end if;
 update club_promo_redemptions set reward=p_result,rewarded_at=now() where registration_id=p_id;
 return true;
end $$;

revoke all on function public.club_promo_track(),public.club_promo_reward(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.club_promo_reward(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
