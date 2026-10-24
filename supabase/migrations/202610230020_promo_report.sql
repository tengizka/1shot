-- Read-only promo report for the analytics export: codes and redemption outcomes, no personal data.
begin;
create function public.club_promo_report() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'codes',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'channel',channel,'active',active) order by code),'[]'::jsonb) from club_promo_codes),
  'redemptions',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'status',status,'gizmo_user_id',gizmo_user_id,'reward',reward,'created_at',created_at,'decided_at',decided_at) order by created_at),'[]'::jsonb) from club_promo_redemptions)
 )
$$;
revoke all on function public.club_promo_report() from public,anon,authenticated;
grant execute on function public.club_promo_report() to service_role;
notify pgrst,'reload schema';
commit;
