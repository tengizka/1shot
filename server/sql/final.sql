-- Local runtime is non-superuser. Migrations run separately as the database owner.
revoke all on all tables in schema public from public,anon,authenticated;
revoke all on all functions in schema public from public,anon,authenticated;
create table public.local_schema(version integer primary key,installed_at timestamptz not null default now());
insert into public.local_schema(version) values(1);
grant select on public.local_schema to service_role;
-- New system remains disabled until explicit acceptance / cutover.
update public.club_settings set enabled=false,flow_version=2;
