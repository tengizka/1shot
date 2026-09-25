-- One Edge request + one database RPC for each idle worker/client poll.
-- Service-role only: client ownership is verified by the Edge function first.
begin;
create or replace function public.club_worker_poll(p_worker uuid,p_after bigint default 0,p_hosts jsonb default null,p_accounts jsonb default '[]')
returns jsonb language plpgsql security definer set search_path=public as $$
declare item jsonb; result jsonb;
begin
 if not club_worker_lease(p_worker) then raise exception 'worker_lease_conflict'; end if;
 if jsonb_typeof(p_accounts) <> 'array' or jsonb_array_length(p_accounts)>10 then raise exception 'bad_accounts'; end if;
 if p_hosts is not null then
  if jsonb_typeof(p_hosts)<>'array' or jsonb_array_length(p_hosts)>100 then raise exception 'bad_hosts'; end if;
  for item in select value from jsonb_array_elements(p_hosts) loop
   if coalesce(item->>'host_id','')='' or coalesce(item->>'status','') not in ('free','busy','reserved','broken') then raise exception 'bad_host'; end if;
   insert into hosts_cache(host_id,zone,status,gizmo_host_id,updated_at)
   values(item->>'host_id',item->>'zone',item->>'status',(jsonb_populate_record(null::hosts_cache,item)).gizmo_host_id,least(now(),coalesce((item->>'updated_at')::timestamptz,now())))
   on conflict(host_id) do update set zone=excluded.zone,status=excluded.status,gizmo_host_id=excluded.gizmo_host_id,updated_at=excluded.updated_at;
  end loop;
 end if;
 for item in select value from jsonb_array_elements(p_accounts) loop
  update club_accounts set data=item->'data',updated_at=least(now(),(item->>'observed_at')::timestamptz)
  where telegram_id=(item->>'telegram_id')::bigint and gizmo_user_id=(item->>'gizmo_user_id')::integer;
  if found then
   update profiles set username=coalesce(item->'data'->>'username',username),
    first_name=coalesce(item->'data'->>'firstName',first_name),last_name=coalesce(item->'data'->>'lastName',last_name)
   where telegram_id=(item->>'telegram_id')::bigint and gizmo_user_id=(item->>'gizmo_user_id')::integer;
  end if;
 end loop;
 update club_worker set protocol=2 where worker_id=p_worker;
 -- Keep the same auth expiry/rate-limit window; never return credentials in this poll.
 update club_auth_requests set status='failed',cipher=null where status in ('pending','running') and created_at<now()-interval '3 minutes';
 delete from club_auth_requests where created_at<now()-interval '1 day';
 select jsonb_build_object(
  'eco_version',1,'lease_seconds',25,
  'bookings',coalesce((select jsonb_agg(x order by x->>'starts_at') from
   (select (to_jsonb(b)-'code_hash')||jsonb_build_object('username',coalesce(p.username,'Гость')) as x
    from club_bookings b left join profiles p using(telegram_id) where b.status not in ('cancelled','expired','completed')) q),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(x) from
   (select to_jsonb(e)||jsonb_build_object('instant',coalesce(b.instant,false)) as x from club_events e left join club_bookings b on b.id=e.booking_id where e.id>p_after order by e.id limit 200) q),'[]'::jsonb),
  'desk',jsonb_build_object(
   'accounts',coalesce((select jsonb_agg(x) from (select * from club_accounts where requested_at>now()-interval '60 seconds' order by updated_at nulls first limit 50) x),'[]'::jsonb),
   'commands',coalesce((select jsonb_agg(x) from ((select * from club_commands where status in ('queued','running') order by created_at limit 50) union all (select * from club_commands where status='awaiting_admin' order by created_at limit 50)) x),'[]'::jsonb)),
  'auth_pending',exists(select 1 from club_auth_requests where status='pending')
 ) into result;
 return result;
end $$;
create or replace function public.club_client_state(p_user bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 perform club_account_request(p_user);
 return jsonb_build_object(
  'bookings',coalesce((select jsonb_agg(x) from (select id,host_id,mode,duration_kind,starts_at,ends_at,hold_until,status,created_at,message,protocol,for_friend,instant from club_bookings where telegram_id=p_user and status not in ('cancelled','expired','completed') order by created_at desc) x),'[]'::jsonb),
  'hosts',coalesce((select jsonb_agg(x) from (select host_id,zone,status,updated_at from hosts_cache order by host_id) x),'[]'::jsonb),
  'account',(select jsonb_build_object('data',data,'updated_at',updated_at) from club_accounts where telegram_id=p_user),
  'commands',coalesce((select jsonb_agg(x) from (select id,kind,status,message,created_at from club_commands where telegram_id=p_user order by created_at desc limit 5) x),'[]'::jsonb),
  'password_request',(select to_jsonb(x) from (select id,status,message,created_at,updated_at from club_commands where telegram_id=p_user and kind='password_request' order by created_at desc limit 1) x)
 );
end $$;
revoke all on function public.club_worker_poll(uuid,bigint,jsonb,jsonb),public.club_client_state(bigint) from public,anon,authenticated;
grant execute on function public.club_worker_poll(uuid,bigint,jsonb,jsonb),public.club_client_state(bigint) to service_role;
notify pgrst,'reload schema';
commit;
