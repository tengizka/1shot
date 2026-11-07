-- Desk talks to the database directly (PostgREST RPC with the public key) for its two frequent calls: the booking
-- snapshot (every 2–5 s) and the food sync. Edge-function calls count against the free plan; database calls do not.
-- Each RPC checks Desk's agent secret against its hash, which club-agent stores (it already knows the secret).
create table if not exists public.club_agent_key(
 id boolean primary key default true check(id),
 secret_hash text not null,
 updated_at timestamptz not null default now()
);
alter table public.club_agent_key enable row level security;
revoke all on public.club_agent_key from public,anon,authenticated;
grant all on public.club_agent_key to service_role;

create or replace function public.club_agent_check(p_secret text) returns void
language plpgsql stable security definer set search_path=public,extensions as $$
begin
 if p_secret is null or length(p_secret)<16 or not exists(select 1 from club_agent_key where secret_hash=encode(extensions.digest(p_secret,'sha256'),'hex'))
 then raise exception 'Unauthorized' using errcode='42501'; end if;
end $$;

-- The snapshot also carries the PC queue, so Desk can mark queued PCs with the guest's nick.
create or replace function public.club_desk_snapshot(p_secret text,p_worker uuid,p_after bigint,p_hosts jsonb,p_accounts jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 perform club_agent_check(p_secret);
 return club_worker_poll(p_worker,p_after,p_hosts,coalesce(p_accounts,'[]'::jsonb))||jsonb_build_object('queues',
  coalesce((select jsonb_agg(jsonb_build_object('host_id',q.host_id,'username',coalesce(p.username,'Гость'),'since',q.created_at) order by q.created_at)
   from club_queue q left join profiles p on p.telegram_id=q.telegram_id),'[]'::jsonb));
end $$;

create or replace function public.club_desk_food(p_secret text,p_worker uuid,p_seats jsonb,p_menu jsonb,p_updates jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 perform club_agent_check(p_secret);
 return to_jsonb(club_food_sync(p_worker,p_seats,p_menu,coalesce(p_updates,'[]'::jsonb)));
end $$;

revoke all on function public.club_agent_check(text),public.club_desk_snapshot(text,uuid,bigint,jsonb,jsonb),public.club_desk_food(text,uuid,jsonb,jsonb,jsonb) from public,authenticated;
grant execute on function public.club_desk_snapshot(text,uuid,bigint,jsonb,jsonb),public.club_desk_food(text,uuid,jsonb,jsonb,jsonb) to anon,service_role;
notify pgrst,'reload schema';
