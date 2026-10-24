-- Read-only diagnostics Desk sends from the club network (Gizmo is not reachable from outside):
-- e.g. the Gizmo tax table and which products carry a tax. Nothing here is written back to Gizmo.
create table if not exists public.club_desk_reports(
 kind text primary key check(kind ~ '^[a-z_]{2,40}$'),
 data jsonb not null,
 updated_at timestamptz not null default now()
);
alter table public.club_desk_reports enable row level security;
revoke all on public.club_desk_reports from public,anon,authenticated;
create or replace function public.club_desk_report(p_worker uuid,p_kind text,p_data jsonb) returns boolean language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 if length(p_data::text)>500000 then raise exception 'report_too_large'; end if;
 insert into club_desk_reports(kind,data,updated_at) values(p_kind,p_data,now()) on conflict(kind) do update set data=excluded.data,updated_at=now();
 return true;
end $$;
revoke all on function public.club_desk_report(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.club_desk_report(uuid,text,jsonb) to service_role;
