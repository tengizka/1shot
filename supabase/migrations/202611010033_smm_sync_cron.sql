-- Hourly sync of the SMM dashboard. The shared secret is generated here, kept in Vault,
-- and read by the smm-sync function through a service-role-only function.
do $$ begin
 if not exists(select 1 from vault.secrets where name='smm_sync_secret') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'smm_sync_secret','x-sync-secret for smm-sync');
 end if;
end $$;
create or replace function public.smm_cron_secret() returns text language sql stable security definer set search_path=public as $$
 select decrypted_secret from vault.decrypted_secrets where name='smm_sync_secret'
$$;
revoke all on function public.smm_cron_secret() from public,anon,authenticated;
grant execute on function public.smm_cron_secret() to service_role;
select cron.schedule('smm-sync-hourly','7 * * * *',$$
 select net.http_post(
  url:='https://zqhfvtgktbfnxcclqqny.supabase.co/functions/v1/smm-sync',
  headers:=jsonb_build_object('Content-Type','application/json','x-sync-secret',(select decrypted_secret from vault.decrypted_secrets where name='smm_sync_secret')),
  body:='{}'::jsonb,
  timeout_milliseconds:=60000)
$$);
