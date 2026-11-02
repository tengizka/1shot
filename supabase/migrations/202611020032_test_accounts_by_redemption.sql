-- Finished registration requests are cleaned up after a while, so test accounts are also found by the tester's promo redemptions.
create or replace function public.club_test_accounts(p_worker uuid) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('gizmo_user_id',t.gid,'created_at',t.created_at,'code',t.code) order by t.created_at desc) from (
  select distinct on (gid) gid,created_at,code from (
   select r.gizmo_user_id gid,r.created_at,p.code from club_registration_requests r left join club_promo_redemptions p on p.registration_id=r.id
    where r.status='done' and r.gizmo_user_id>0 and r.telegram_id in (select telegram_id from club_promo_testers)
   union all
   select p.gizmo_user_id,p.created_at,p.code from club_promo_redemptions p
    where p.gizmo_user_id>0 and p.telegram_id in (select telegram_id from club_promo_testers)
  ) a order by gid,created_at desc) t
  where not exists(select 1 from club_test_removed x where x.gizmo_user_id=t.gid)),'[]'::jsonb);
end $$;
do $$
declare def text;
begin
 def:=pg_get_functiondef('public.club_test_account_removed(uuid,integer)'::regprocedure);
 def:=replace(def,$x$ if not exists(select 1 from club_registration_requests where gizmo_user_id=p_uid and status='done' and telegram_id in (select telegram_id from club_promo_testers)) then return false; end if;$x$,
  $x$ if not exists(select 1 from club_registration_requests where gizmo_user_id=p_uid and status='done' and telegram_id in (select telegram_id from club_promo_testers))
    and not exists(select 1 from club_promo_redemptions where gizmo_user_id=p_uid and telegram_id in (select telegram_id from club_promo_testers)) then return false; end if;$x$);
 if position('club_promo_redemptions where gizmo_user_id=p_uid and telegram_id' in def)=0 then raise exception 'tester check not found'; end if;
 execute def;
end $$;
revoke all on function public.club_test_accounts(uuid) from public,anon,authenticated;
grant execute on function public.club_test_accounts(uuid) to service_role;
notify pgrst,'reload schema';
