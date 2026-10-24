-- Registration at the reception desk: the admin picks the promo code with a button, Desk creates the
-- Gizmo account and records the redemption here (no Telegram). GG marks guests from the site without an ad link.
begin;
alter table public.club_promo_redemptions alter column telegram_id drop not null;
alter table public.club_promo_redemptions add column source text not null default 'telegram' check(source in ('telegram','desk'));
create unique index club_promo_redemptions_one_per_guest on public.club_promo_redemptions(gizmo_user_id) where gizmo_user_id is not null;
insert into public.club_promo_codes(code,channel) values('GG','Сайт без рекламы') on conflict do nothing;

create function public.club_promo_codes_active() returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('code',code,'channel',channel) order by created_at,code),'[]'::jsonb) from club_promo_codes where active
$$;

-- One redemption per desk registration id and one free hour per Gizmo account.
create function public.club_promo_desk_redemption(p_worker uuid,p_id uuid,p_code text,p_uid integer) returns boolean language plpgsql security definer set search_path=public as $$
declare v_code text:=upper(trim(coalesce(p_code,'')));
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 if p_id is null or p_uid is null or p_uid<=0 then raise exception 'invalid_redemption'; end if;
 if not exists(select 1 from club_promo_codes c where c.code=v_code and c.active) then raise exception 'Промокод не найден'; end if;
 if exists(select 1 from club_promo_redemptions where gizmo_user_id=p_uid and registration_id<>p_id) then raise exception 'Этот гость уже получал час по промокоду'; end if;
 insert into club_promo_redemptions(registration_id,telegram_id,code,status,gizmo_user_id,source,decided_at)
  values(p_id,null,v_code,'done',p_uid,'desk',now()) on conflict(registration_id) do nothing;
 return exists(select 1 from club_promo_redemptions r where r.registration_id=p_id and r.code=v_code and r.gizmo_user_id=p_uid and r.source='desk');
end $$;

create or replace function public.club_promo_report() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'codes',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'channel',channel,'active',active) order by code),'[]'::jsonb) from club_promo_codes),
  'redemptions',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'status',status,'gizmo_user_id',gizmo_user_id,'reward',reward,'source',source,'created_at',created_at,'decided_at',decided_at) order by created_at),'[]'::jsonb) from club_promo_redemptions)
 )
$$;

revoke all on function public.club_promo_codes_active(),public.club_promo_desk_redemption(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.club_promo_codes_active(),public.club_promo_desk_redemption(uuid,uuid,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
