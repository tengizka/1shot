-- One Telegram may hold several club accounts (026): the mini-app shows bookings, the session and the cached
-- account data of the account it is signed in with now, not of every account behind this Telegram.
create or replace function public.club_client_state_before_password_grants(p_user bigint) returns jsonb language plpgsql security definer set search_path=public as $$
declare gid integer;
begin
 perform club_account_request(p_user);
 select gizmo_user_id into gid from profiles where telegram_id=p_user;
 return jsonb_build_object(
  'bookings',coalesce((select jsonb_agg(x) from (select id,host_id,mode,duration_kind,starts_at,ends_at,hold_until,status,created_at,message,protocol,for_friend,instant from club_bookings where telegram_id=p_user and gizmo_user_id is not distinct from gid and status not in ('cancelled','expired','completed') order by created_at desc) x),'[]'::jsonb),
  'hosts',coalesce((select jsonb_agg(x) from (select host_id,zone,status,updated_at from hosts_cache order by host_id) x),'[]'::jsonb),
  'account',(select jsonb_build_object('data',data,'updated_at',updated_at) from club_accounts where telegram_id=p_user and gizmo_user_id is not distinct from gid),
  'commands',coalesce((select jsonb_agg(x) from (select id,kind,status,message,created_at from club_commands where telegram_id=p_user order by created_at desc limit 5) x),'[]'::jsonb),
  'password_request',(select to_jsonb(x) from (select id,status,message,created_at,updated_at from club_commands where telegram_id=p_user and kind='password_request' order by created_at desc limit 1) x)
 );
end $$;
notify pgrst,'reload schema';
