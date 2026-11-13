-- Test accounts by Gizmo ID: a reception account made by mistake (or for a test) can be put on the list by hand,
-- then Desk deletes it from Settings → «Тесты» like a tester's account. Add one with:
--   insert into club_test_extra(gizmo_user_id,note) values(<id>,'why');
create table if not exists public.club_test_extra(gizmo_user_id integer primary key,note text,created_at timestamptz not null default now());
alter table public.club_test_extra enable row level security;
revoke all on public.club_test_extra from public,anon,authenticated;
grant all on public.club_test_extra to service_role;
insert into public.club_test_extra(gizmo_user_id,note) values(4869,'Аккаунт мамы Тенгиза, 13.11 — удалить') on conflict do nothing;

create or replace function public.club_test_accounts(p_worker uuid) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 return coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
  select jsonb_build_object('gizmo_user_id',r.gizmo_user_id,'created_at',r.created_at,'code',p.code) x
   from club_registration_requests r left join club_promo_redemptions p on p.registration_id=r.id
   where r.status='done' and r.gizmo_user_id>0 and r.telegram_id in (select telegram_id from club_promo_testers)
     and not exists(select 1 from club_test_removed x where x.gizmo_user_id=r.gizmo_user_id)
  union all
  select jsonb_build_object('gizmo_user_id',e.gizmo_user_id,'created_at',e.created_at,'code',(select code from club_promo_redemptions where gizmo_user_id=e.gizmo_user_id limit 1))
   from club_test_extra e where not exists(select 1 from club_test_removed x where x.gizmo_user_id=e.gizmo_user_id)
 ) t),'[]'::jsonb);
end $$;

create or replace function public.club_test_account_removed(p_worker uuid,p_uid integer) returns boolean language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 -- Only accounts a tester's Telegram created or ones put on the list by ID; a guest's account is never touched.
 if not exists(select 1 from club_registration_requests where gizmo_user_id=p_uid and status='done' and telegram_id in (select telegram_id from club_promo_testers))
    and not exists(select 1 from club_test_extra where gizmo_user_id=p_uid) then return false; end if;
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
 update profiles set gizmo_user_id=0 where gizmo_user_id=p_uid;
 delete from club_registration_requests where gizmo_user_id=p_uid;
 insert into club_test_removed(gizmo_user_id) values(p_uid) on conflict do nothing;
 return true;
end $$;
revoke all on function public.club_test_accounts(uuid),public.club_test_account_removed(uuid,integer) from public,anon,authenticated;
grant execute on function public.club_test_accounts(uuid),public.club_test_account_removed(uuid,integer) to service_role;
notify pgrst,'reload schema';
