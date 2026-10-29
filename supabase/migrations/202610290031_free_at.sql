-- Busy PCs show when they free up (Desk estimates it from the player's remaining time),
-- and a guest may book a busy PC for a time after that moment.
alter table public.hosts_cache add column if not exists free_at timestamptz;

-- Desk sends free_at with every host snapshot.
create or replace function public.club_worker_poll(p_worker uuid, p_after bigint DEFAULT 0, p_hosts jsonb DEFAULT NULL::jsonb, p_accounts jsonb DEFAULT '[]'::jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare result jsonb; grants jsonb; item jsonb;
begin
 result:=club_worker_poll_before_password_grants(p_worker,p_after,p_hosts,p_accounts);perform club_password_cleanup();
 if jsonb_typeof(p_hosts)='array' then
  for item in select value from jsonb_array_elements(p_hosts) loop
   update hosts_cache set free_at=case when item->>'status'='busy' and item->>'free_at' is not null then (item->>'free_at')::timestamptz end
   where host_id=item->>'host_id';
  end loop;
 end if;
 select coalesce(jsonb_agg(to_jsonb(g)-'cipher'-'worker_id'-'request_id'),'[]') into grants from (select * from club_password_grants where status in ('authorized','queued','processing','attention') order by created_at limit 100) g;
 return jsonb_set(result,'{desk,password_grants}',grants);
end $$;

-- A busy PC can be booked for a time at or after its expected free moment.
do $$
declare def text;
begin
 def:=pg_get_functiondef('public.club_create_booking(bigint,text,text,text,timestamptz,timestamptz,uuid)'::regprocedure);
 if position('h.free_at' in def)=0 then
  def:=replace(def,$x$ if h.status<>'free' then raise exception 'Прости, но он занят.. Выберите свободный ПК'; end if;$x$,
   $x$ if h.status<>'free' and not (p_mode='scheduled' and h.status='busy' and h.free_at is not null and p_start>=h.free_at) then raise exception 'Прости, но он занят.. Выберите свободный ПК'; end if;$x$);
  if position('h.free_at' in def)=0 then raise exception 'club_create_booking: busy check not found'; end if;
  execute def;
 end if;
end $$;
notify pgrst,'reload schema';
