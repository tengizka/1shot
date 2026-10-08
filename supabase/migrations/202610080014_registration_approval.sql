-- Apply once, after stopping old Desk/agent processes and draining old auth.
begin;
do $$ begin
 if exists(select 1 from club_worker where lease_until>now()) then raise exception 'Stop Desk and wait for its lease before upgrading'; end if;
 if exists(select 1 from club_auth_requests where status in ('pending','running') and created_at>now()-interval '3 minutes') then raise exception 'Unfinished authentication requests'; end if;
end $$;
create table public.club_registration_requests(
 id uuid primary key, telegram_id bigint not null, public_data jsonb not null, cipher text,
 status text not null default 'awaiting_admin' check(status in ('awaiting_admin','processing','attention','done','rejected','expired')),
 worker_id uuid, gizmo_user_id integer check(gizmo_user_id>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '72 hours'
);
create unique index club_registration_one_active on public.club_registration_requests(telegram_id) where status in ('awaiting_admin','processing','attention');
alter table public.club_registration_requests enable row level security;
revoke all on public.club_registration_requests from public,anon,authenticated;
grant all on public.club_registration_requests to service_role;
create function public.club_registration_cleanup() returns void language plpgsql security definer set search_path=public as $$
begin
 update club_registration_requests set status='expired',cipher=null,public_data='{}',updated_at=now() where status='awaiting_admin' and expires_at<=now();
 update club_registration_requests set status='attention',cipher=null,updated_at=now() where status='processing' and updated_at<now()-interval '15 minutes';
 delete from club_registration_requests where status in ('done','rejected','expired') and updated_at<now()-interval '7 days';
end $$;
create function public.club_registration_submit(p_id uuid,p_user bigint,p_data jsonb,p_cipher text) returns uuid language plpgsql security definer set search_path=public as $$
declare existing uuid;
begin
 perform pg_advisory_xact_lock(p_user);
 perform club_registration_cleanup();
 select id into existing from club_registration_requests where telegram_id=p_user and status in ('awaiting_admin','processing','attention');
 if found then return existing; end if;
 if exists(select 1 from profiles where telegram_id=p_user and gizmo_user_id>0) then raise exception 'Аккаунт уже связан. Используйте вход'; end if;
 if (select count(*) from club_registration_requests where telegram_id=p_user and created_at>now()-interval '1 day')>=3 then raise exception 'Не больше трёх анкет в сутки'; end if;
 if p_user<=0 or p_cipher is null or length(p_cipher)>12000 or jsonb_typeof(p_data)<>'object' then raise exception 'invalid_application'; end if;
 -- Never accept extra fields such as a plaintext password into public summaries.
 insert into club_registration_requests(id,telegram_id,public_data,cipher) values(p_id,p_user,jsonb_build_object('username',p_data->>'username','first_name',p_data->>'first_name','last_name',p_data->>'last_name','mobile_phone',p_data->>'mobile_phone','birth_date',p_data->>'birth_date','sex',p_data->'sex'),p_cipher);
 return p_id;
end $$;
create function public.club_registration_status(p_user bigint) returns jsonb language plpgsql security definer set search_path=public as $$
declare r club_registration_requests; profile jsonb;
begin
 perform club_registration_cleanup();
 select * into r from club_registration_requests where telegram_id=p_user order by created_at desc limit 1;
 if not found then return null; end if;
 if r.status='done' then select to_jsonb(p) into profile from (select telegram_id,gizmo_user_id,username,first_name,last_name from profiles where telegram_id=p_user and gizmo_user_id=r.gizmo_user_id) p; end if;
 return jsonb_build_object('id',r.id,'status',r.status,'expires_at',r.expires_at,'profile',profile);
end $$;
create function public.club_registration_claim(p_worker uuid,p_id uuid,p_confirmed boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare r club_registration_requests;
begin
 if p_confirmed is distinct from true then raise exception 'Подтвердите проверку личности'; end if;
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 perform club_registration_cleanup();
 select * into r from club_registration_requests where id=p_id for update;
 if not found or r.status<>'awaiting_admin' or r.cipher is null then raise exception 'Анкета уже обработана или требует проверки'; end if;
 update club_registration_requests set status='processing',worker_id=p_worker,cipher=null,updated_at=now() where id=p_id;
 return jsonb_build_object('id',r.id,'telegram_id',r.telegram_id,'cipher',r.cipher,'expires_at',r.expires_at);
end $$;
create function public.club_registration_reject(p_worker uuid,p_id uuid,p_confirmed boolean) returns boolean language plpgsql security definer set search_path=public as $$
begin
 if p_confirmed is distinct from true then raise exception 'Подтвердите отклонение'; end if;
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 perform club_registration_cleanup();
 update club_registration_requests set status='rejected',cipher=null,public_data='{}',updated_at=now() where id=p_id and status='awaiting_admin';
 if found then return true; end if;
 return exists(select 1 from club_registration_requests where id=p_id and status='rejected');
end $$;
create function public.club_registration_finish(p_worker uuid,p_id uuid,p_status text,p_uid integer default null) returns boolean language plpgsql security definer set search_path=public as $$
declare r club_registration_requests;
begin
 if p_status not in ('done','rejected','attention') or (p_status='done' and (p_uid is null or p_uid<=0)) then raise exception 'invalid_outcome'; end if;
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 select * into r from club_registration_requests where id=p_id for update;
 if not found or r.worker_id is distinct from p_worker then raise exception 'application_owner_mismatch'; end if;
 if r.status=p_status and r.gizmo_user_id is not distinct from p_uid then return true; end if;
 if r.status<>'processing' then return false; end if;
 if p_status='done' then
  perform pg_advisory_xact_lock(r.telegram_id);
  insert into profiles(telegram_id,gizmo_user_id,username,first_name,last_name)
   values(r.telegram_id,p_uid,r.public_data->>'username',r.public_data->>'first_name',r.public_data->>'last_name')
   on conflict(telegram_id) do update set gizmo_user_id=excluded.gizmo_user_id,username=excluded.username,first_name=excluded.first_name,last_name=excluded.last_name
   where profiles.gizmo_user_id is null or profiles.gizmo_user_id=excluded.gizmo_user_id;
  if not found then raise exception 'Telegram уже связан с другим аккаунтом. Нужна сверка'; end if;
 end if;
 update club_registration_requests set status=p_status,gizmo_user_id=p_uid,cipher=null,public_data=case when p_status='attention' then public_data else '{}'::jsonb end,updated_at=now() where id=p_id;
 return true;
end $$;
alter function public.club_worker_poll(uuid,bigint,jsonb,jsonb) rename to club_worker_poll_before_registration;
create function public.club_worker_poll(p_worker uuid,p_after bigint default 0,p_hosts jsonb default null,p_accounts jsonb default '[]') returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; applications jsonb;
begin
 result:=club_worker_poll_before_registration(p_worker,p_after,p_hosts,p_accounts);
 perform club_registration_cleanup();
 select coalesce(jsonb_agg(x order by x->>'created_at'),'[]') into applications from (select to_jsonb(r)-'cipher'-'worker_id' as x from club_registration_requests r where status in ('awaiting_admin','processing','attention') order by created_at limit 100) q;
 return jsonb_set(result,'{desk,registrations}',applications);
end $$;
revoke all on function public.club_registration_cleanup(),public.club_registration_submit(uuid,bigint,jsonb,text),public.club_registration_status(bigint),public.club_registration_claim(uuid,uuid,boolean),public.club_registration_reject(uuid,uuid,boolean),public.club_registration_finish(uuid,uuid,text,integer),public.club_worker_poll(uuid,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.club_registration_cleanup(),public.club_registration_submit(uuid,bigint,jsonb,text),public.club_registration_status(bigint),public.club_registration_claim(uuid,uuid,boolean),public.club_registration_reject(uuid,uuid,boolean),public.club_registration_finish(uuid,uuid,text,integer),public.club_worker_poll(uuid,bigint,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
