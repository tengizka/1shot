-- API tokens for smm-sync may live in Vault (name prefix smm_) instead of function secrets.
create or replace function public.smm_secret(p_name text) returns text language sql stable security definer set search_path=public as $$
 select decrypted_secret from vault.decrypted_secrets where name=p_name and p_name like 'smm\_%'
$$;
revoke all on function public.smm_secret(text) from public,anon,authenticated;
grant execute on function public.smm_secret(text) to service_role;
-- The token itself is added outside the repo: select vault.create_secret('<token>','smm_metrika_token');
