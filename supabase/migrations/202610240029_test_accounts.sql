-- Test accounts: club accounts created through the mini-app from a Telegram on the testers list (club_promo_testers).
-- Desk lists them in Settings → «Тесты»; after Desk deletes one in Gizmo, its traces are removed here too.
create table if not exists public.club_test_removed(gizmo_user_id integer primary key,removed_at timestamptz not null default now());
alter table public.club_test_removed enable row level security;
revoke all on public.club_test_removed from public,anon,authenticated;
grant all on public.club_test_removed to service_role;

create or replace function public.club_test_accounts(p_worker uuid) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('gizmo_user_id',r.gizmo_user_id,'created_at',r.created_at,'code',p.code) order by r.created_at desc)
  from club_registration_requests r left join club_promo_redemptions p on p.registration_id=r.id
  where r.status='done' and r.gizmo_user_id>0 and r.telegram_id in (select telegram_id from club_promo_testers)
   and not exists(select 1 from club_test_removed x where x.gizmo_user_id=r.gizmo_user_id)),'[]'::jsonb);
end $$;

create or replace function public.club_test_account_removed(p_worker uuid,p_uid integer) returns boolean language plpgsql security definer set search_path=public as $$
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
end $$;
revoke all on function public.club_test_accounts(uuid),public.club_test_account_removed(uuid,integer) from public,anon,authenticated;
grant execute on function public.club_test_accounts(uuid),public.club_test_account_removed(uuid,integer) to service_role;
-- Statistics never count testers: neither redemptions from a tester's Telegram nor accounts already removed.
create or replace function public.club_promo_report() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'codes',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'channel',channel,'active',active) order by code),'[]'::jsonb) from club_promo_codes),
  'redemptions',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'status',status,'gizmo_user_id',gizmo_user_id,'reward',reward,'source',source,'created_at',created_at,'decided_at',decided_at) order by created_at),'[]'::jsonb)
   from club_promo_redemptions r
   where (r.telegram_id is null or r.telegram_id not in (select telegram_id from club_promo_testers))
     and (r.gizmo_user_id is null or r.gizmo_user_id not in (select gizmo_user_id from club_test_removed)))
 )
$$;
notify pgrst,'reload schema';
