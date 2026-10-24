-- Applications wait for in-person approval up to a month (was 72 hours); Desk gets the newest first, up to 300.
begin;
alter table public.club_registration_requests alter column expires_at set default now()+interval '30 days';
update public.club_registration_requests set expires_at=created_at+interval '30 days' where status='awaiting_admin';
create or replace function public.club_worker_poll_before_password_grants(p_worker uuid,p_after bigint default 0,p_hosts jsonb default null,p_accounts jsonb default '[]') returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; applications jsonb;
begin
 result:=club_worker_poll_before_registration(p_worker,p_after,p_hosts,p_accounts);
 perform club_registration_cleanup();
 select coalesce(jsonb_agg(x order by x->>'created_at' desc),'[]') into applications from (select to_jsonb(r)-'cipher'-'worker_id' as x from club_registration_requests r where status in ('awaiting_admin','processing','attention') order by created_at desc limit 300) q;
 return jsonb_set(result,'{desk,registrations}',applications);
end $$;
notify pgrst,'reload schema';
commit;
