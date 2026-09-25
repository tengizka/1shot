begin;
-- Short-lived encrypted authentication inbox, private to service_role.
create table public.club_auth_requests (
 id uuid primary key, telegram_id bigint not null, cipher text,
 status text not null default 'pending' check(status in ('pending','running','done','failed','invalid_credentials','username_taken')),
 worker_id uuid, gizmo_user_id integer, created_at timestamptz not null default now()
);
alter table public.club_auth_requests enable row level security;
revoke all on public.club_auth_requests from public,anon,authenticated;
grant all on public.club_auth_requests to service_role;
create index on public.club_auth_requests(telegram_id,created_at);
create function public.club_auth_enqueue(p_id uuid,p_user bigint,p_cipher text) returns uuid language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(p_user);
 if (select count(*) from club_auth_requests where telegram_id=p_user and created_at>now()-interval '15 minutes')>=5 then raise exception 'Слишком много попыток. Подождите 15 минут'; end if;
 if exists(select 1 from club_auth_requests where telegram_id=p_user and status in ('pending','running') and created_at>now()-interval '3 minutes') then raise exception 'Предыдущий запрос ещё выполняется'; end if;
 insert into club_auth_requests(id,telegram_id,cipher) values(p_id,p_user,p_cipher);
 return p_id;
end $$;
create function public.club_auth_claim(p_worker uuid) returns setof public.club_auth_requests language plpgsql security definer set search_path=public as $$
declare r club_auth_requests;
begin
 update club_auth_requests set status='failed',cipher=null where status in ('pending','running') and created_at<now()-interval '3 minutes';
 delete from club_auth_requests where created_at<now()-interval '1 day';
 for r in select * from club_auth_requests where status='pending' order by created_at limit 5 for update skip locked loop
  update club_auth_requests set status='running',cipher=null,worker_id=p_worker where id=r.id;
  return next r;
 end loop;
end $$;
revoke all on function public.club_auth_enqueue(uuid,bigint,text),public.club_auth_claim(uuid) from public,anon,authenticated;
grant execute on function public.club_auth_enqueue(uuid,bigint,text),public.club_auth_claim(uuid) to service_role;
notify pgrst,'reload schema';
commit;
