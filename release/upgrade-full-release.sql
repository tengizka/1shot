-- 1SHOT CLUB FULL RELEASE UPGRADE SCRIPT (Migrations 014 - 017)
-- Safe, idempotent execution. Preserves existing profiles and bookings.


-- >>> Start of supabase/migrations/202610080014_registration_approval.sql <<<
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
-- >>> End of supabase/migrations/202610080014_registration_approval.sql <<<


-- >>> Start of supabase/migrations/202610080015_registration_reconciliation.sql <<<
-- Requires 014. Stop Desk and drain old authentication before deployment.
begin;
do $$ begin
 if exists(select 1 from club_worker where lease_until>now()) then raise exception 'Stop Desk before upgrading'; end if;
 if exists(select 1 from club_auth_requests where status in ('pending','running') and created_at>now()-interval '3 minutes') then raise exception 'Unfinished authentication requests'; end if;
end $$;
alter table public.club_auth_requests add column purpose text not null default 'legacy' check(purpose in ('legacy','login'));
-- New handler only uses this queue for login; older workers must be stopped.
create or replace function public.club_auth_enqueue(p_id uuid,p_user bigint,p_cipher text) returns uuid language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(p_user);
 if (select count(*) from club_auth_requests where telegram_id=p_user and created_at>now()-interval '15 minutes')>=5 then raise exception 'Слишком много попыток. Подождите 15 минут'; end if;
 if exists(select 1 from club_auth_requests where telegram_id=p_user and status in ('pending','running') and created_at>now()-interval '3 minutes') then raise exception 'Предыдущий запрос ещё выполняется'; end if;
 insert into club_auth_requests(id,telegram_id,cipher,purpose) values(p_id,p_user,p_cipher,'login');
 return p_id;
end $$;
create table public.club_registration_reconciliations(
 request_id uuid primary key, proof_id uuid not null unique, gizmo_user_id integer not null check(gizmo_user_id>0),
 worker_id uuid not null, completed_at timestamptz not null default now()
);
alter table public.club_registration_reconciliations enable row level security;
revoke all on public.club_registration_reconciliations from public,anon,authenticated;
grant all on public.club_registration_reconciliations to service_role;
create function public.club_registration_review(p_worker uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r club_registration_requests; proof jsonb;
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 select * into r from club_registration_requests where id=p_id;
 if not found or r.status<>'attention' then raise exception 'Для сверки нужна спорная заявка'; end if;
 select jsonb_build_object('id',a.id,'gizmo_user_id',a.gizmo_user_id) into proof
 from club_auth_requests a join profiles p on p.telegram_id=a.telegram_id and p.gizmo_user_id=a.gizmo_user_id
 where a.telegram_id=r.telegram_id and a.status='done' and a.purpose='login' and a.created_at>=r.updated_at
 and a.created_at>now()-interval '10 minutes' and a.created_at<=now()
 and (r.gizmo_user_id is null or r.gizmo_user_id=a.gizmo_user_id)
 and not exists(select 1 from club_registration_reconciliations x where x.proof_id=a.id)
 order by a.created_at desc limit 1;
 return jsonb_build_object('request',to_jsonb(r)-'cipher'-'worker_id','proof',proof);
end $$;
create function public.club_registration_reconcile(p_worker uuid,p_id uuid,p_proof uuid,p_uid integer,p_confirmed boolean) returns boolean language plpgsql security definer set search_path=public as $$
declare r club_registration_requests;
begin
 if p_confirmed is distinct from true then raise exception 'Подтвердите очную сверку аккаунта'; end if;
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 select * into r from club_registration_requests where id=p_id for update;
 if not found then raise exception 'Заявка не найдена'; end if;
 if r.status='done' and exists(select 1 from club_registration_reconciliations where request_id=p_id and proof_id=p_proof and gizmo_user_id=p_uid) then return true; end if;
 if r.status<>'attention' or (r.gizmo_user_id is not null and r.gizmo_user_id<>p_uid) then raise exception 'Аккаунт или статус заявки изменён'; end if;
 -- Lock the existing link, never create or replace it during reconciliation.
 perform 1 from profiles where telegram_id=r.telegram_id and gizmo_user_id=p_uid for update;
 if not found then raise exception 'Гость должен заново войти в нужный аккаунт'; end if;
 perform 1 from club_auth_requests where id=p_proof and telegram_id=r.telegram_id and gizmo_user_id=p_uid and status='done'
 and purpose='login' and created_at>=r.updated_at and created_at>now()-interval '10 minutes' and created_at<=now() for update;
 if not found then raise exception 'Нет свежего подтверждённого входа гостя'; end if;
 insert into club_registration_reconciliations(request_id,proof_id,gizmo_user_id,worker_id) values(p_id,p_proof,p_uid,p_worker);
 update club_registration_requests set status='done',gizmo_user_id=p_uid,cipher=null,public_data='{}',updated_at=now() where id=p_id;
 return true;
end $$;
revoke all on function public.club_registration_review(uuid,uuid),public.club_registration_reconcile(uuid,uuid,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.club_registration_review(uuid,uuid),public.club_registration_reconcile(uuid,uuid,uuid,integer,boolean) to service_role;
notify pgrst,'reload schema';
commit;
-- >>> End of supabase/migrations/202610080015_registration_reconciliation.sql <<<


-- >>> Start of supabase/migrations/202610080016_guest_password_grants.sql <<<
-- Requires 014/015; coordinated stopped-worker rollout only.
begin;
do $$ begin
 if exists(select 1 from club_worker where lease_until>now()) then raise exception 'Stop Desk before upgrading'; end if;
 if exists(select 1 from club_auth_requests where status in ('pending','running') and created_at>now()-interval '3 minutes') then raise exception 'Unfinished authentication requests'; end if;
end $$;
create table public.club_password_grants(
 id uuid primary key default gen_random_uuid(), telegram_id bigint not null, gizmo_user_id integer not null check(gizmo_user_id>0),
 username text not null, group_id integer not null, minimum_length integer not null check(minimum_length in (1,8)),
 source text not null check(source in ('password_request','registration')), source_id uuid not null,
 status text not null default 'authorized' check(status in ('authorized','queued','processing','done','attention','expired','resolved')),
 authorized_by uuid not null, worker_id uuid, request_id uuid unique, cipher text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '10 minutes'
);
create unique index club_password_one_account on public.club_password_grants(gizmo_user_id) where status in ('authorized','queued','processing','attention');
create unique index club_password_one_owner on public.club_password_grants(telegram_id) where status in ('authorized','queued','processing','attention');
alter table public.club_password_grants enable row level security;
revoke all on public.club_password_grants from public,anon,authenticated;
grant all on public.club_password_grants to service_role;
create function public.club_password_cleanup() returns void language plpgsql security definer set search_path=public as $$
begin
 update club_password_grants set status='expired',cipher=null,username='',updated_at=now() where status in ('authorized','queued') and expires_at<=now();
 update club_password_grants set status='attention',cipher=null,updated_at=now() where status='processing' and updated_at<now()-interval '15 minutes';
 delete from club_password_grants where status in ('done','expired','resolved') and updated_at<now()-interval '7 days';
end $$;
create function public.club_password_context(p_worker uuid,p_source text,p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 if p_source='password_request' then
  select jsonb_build_object('telegram_id',c.telegram_id,'gizmo_user_id',c.gizmo_user_id) into result
  from club_commands c join profiles p on p.telegram_id=c.telegram_id and p.gizmo_user_id=c.gizmo_user_id
  where c.id=p_id and c.kind='password_request' and c.status='awaiting_admin' for update of c,p;
 elsif p_source='registration' then
  select jsonb_build_object('telegram_id',telegram_id,'gizmo_user_id',gizmo_user_id,'public_data',public_data) into result
  from club_registration_requests where id=p_id and status='attention' and gizmo_user_id>0 for update;
 end if;
 if result is null then raise exception 'Нужна открытая заявка с подтверждённым ID аккаунта'; end if;
 return result;
end $$;
create function public.club_password_authorize(p_worker uuid,p_source text,p_id uuid,p_uid integer,p_username text,p_group integer,p_minimum integer,p_confirmed boolean,p_privileged boolean) returns uuid language plpgsql security definer set search_path=public as $$
declare context jsonb; existing club_password_grants; gid uuid;
begin
 if p_confirmed is distinct from true or p_minimum not in (1,8) or (p_minimum=8 and p_privileged is distinct from true) then raise exception 'Подтвердите личность и права аккаунта'; end if;
 context:=club_password_context(p_worker,p_source,p_id);
 if (context->>'gizmo_user_id')::integer<>p_uid or p_username is null or length(p_username)=0 or p_group<=0 then raise exception 'Аккаунт изменился'; end if;
 perform pg_advisory_xact_lock(15837816,p_uid);perform club_password_cleanup();
 select * into existing from club_password_grants where gizmo_user_id=p_uid and status in ('authorized','queued','processing','attention');
 if found then
  if existing.source<>p_source or existing.source_id<>p_id then raise exception 'Для аккаунта уже есть другое разрешение'; end if;
  return existing.id;
 end if;
 insert into club_password_grants(telegram_id,gizmo_user_id,username,group_id,minimum_length,source,source_id,authorized_by)
 values((context->>'telegram_id')::bigint,p_uid,p_username,p_group,p_minimum,p_source,p_id,p_worker) returning id into gid;
 return gid;
end $$;
create function public.club_password_status(p_user bigint) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform club_password_cleanup();
 return (select jsonb_build_object('id',id,'username',username,'status',status,'minimum_length',minimum_length,'expires_at',expires_at) from club_password_grants where telegram_id=p_user order by created_at desc limit 1);
end $$;
create function public.club_password_submit(p_id uuid,p_user bigint,p_request uuid,p_cipher text,p_length integer) returns text language plpgsql security definer set search_path=public as $$
declare g club_password_grants;
begin
 perform club_password_cleanup();
 select * into g from club_password_grants where id=p_id and telegram_id=p_user for update;
 if not found then raise exception 'Нет разрешения администратора'; end if;
 if g.request_id=p_request then return g.status; end if;
 if g.status<>'authorized' or g.expires_at<=now() then raise exception 'Разрешение уже использовано или истекло'; end if;
 if p_length<g.minimum_length or p_length>64 or p_cipher is null or length(p_cipher)>12000 then raise exception 'Проверьте длину пароля'; end if;
 update club_password_grants set status='queued',request_id=p_request,cipher=p_cipher,updated_at=now() where id=p_id;
 return 'queued';
end $$;
create function public.club_password_claim(p_worker uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare g club_password_grants;
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 perform club_password_cleanup();
 select * into g from club_password_grants where id=p_id for update;
 if not found or g.status<>'queued' or g.cipher is null then raise exception 'Пароль уже обрабатывается или разрешение истекло'; end if;
 perform club_password_context(p_worker,g.source,g.source_id);
 update club_password_grants set status='processing',worker_id=p_worker,cipher=null,updated_at=now() where id=p_id;
 return to_jsonb(g);
end $$;
create function public.club_password_finish(p_worker uuid,p_id uuid,p_status text) returns boolean language plpgsql security definer set search_path=public as $$
declare g club_password_grants;
begin
 if p_status not in ('done','attention') then raise exception 'invalid_outcome'; end if;
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 select * into g from club_password_grants where id=p_id for update;
 if not found or g.worker_id is distinct from p_worker then raise exception 'grant_owner_mismatch'; end if;
 if g.status=p_status then return true; end if;
 if g.status<>'processing' then return false; end if;
 update club_password_grants set status=p_status,cipher=null,username=case when p_status='done' then '' else username end,updated_at=now() where id=p_id;
 if p_status='done' and g.source='password_request' then
  update club_commands set status='done',payload='{}',message='Гость установил пароль самостоятельно; проверен вход',updated_at=now() where id=g.source_id and status='awaiting_admin';
 end if;
 return true;
end $$;
-- Access reconciliation proves access, NOT that the attempted password write succeeded.
create table public.club_password_resolutions(grant_id uuid primary key,proof_id uuid not null unique,worker_id uuid not null,created_at timestamptz not null default now());
alter table public.club_password_resolutions enable row level security;
revoke all on public.club_password_resolutions from public,anon,authenticated;
grant all on public.club_password_resolutions to service_role;
create function public.club_password_review(p_worker uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare g club_password_grants; proof uuid;
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 select * into g from club_password_grants where id=p_id and status='attention';
 if not found then raise exception 'Нужна неопределённая попытка'; end if;
 select a.id into proof from club_auth_requests a join profiles p on p.telegram_id=a.telegram_id and p.gizmo_user_id=a.gizmo_user_id
 where a.telegram_id=g.telegram_id and a.gizmo_user_id=g.gizmo_user_id and a.purpose='login' and a.status='done'
 and a.created_at>=g.updated_at and a.created_at>now()-interval '10 minutes' and a.created_at<=now()
 and not exists(select 1 from club_password_resolutions x where x.proof_id=a.id) order by a.created_at desc limit 1;
 if proof is null then raise exception 'Гость должен сам успешно войти после ошибки, не более 10 минут назад'; end if;
 return jsonb_build_object('proof_id',proof,'gizmo_user_id',g.gizmo_user_id);
end $$;
create function public.club_password_resolve(p_worker uuid,p_id uuid,p_proof uuid,p_confirmed boolean) returns boolean language plpgsql security definer set search_path=public as $$
declare g club_password_grants;
begin
 if p_confirmed is distinct from true then raise exception 'Подтвердите сверку доступа'; end if;
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 select * into g from club_password_grants where id=p_id for update;
 if not found then raise exception 'Разрешение не найдено'; end if;
 if g.status='resolved' and exists(select 1 from club_password_resolutions where grant_id=p_id and proof_id=p_proof) then return true; end if;
 if g.status<>'attention' then raise exception 'Статус изменился'; end if;
 perform 1 from profiles where telegram_id=g.telegram_id and gizmo_user_id=g.gizmo_user_id for update;
 if not found then raise exception 'Связь аккаунта изменилась'; end if;
 perform 1 from club_auth_requests where id=p_proof and telegram_id=g.telegram_id and gizmo_user_id=g.gizmo_user_id and purpose='login' and status='done'
 and created_at>=g.updated_at and created_at>now()-interval '10 minutes' and created_at<=now() for update;
 if not found then raise exception 'Нет свежего подтверждения доступа'; end if;
 insert into club_password_resolutions(grant_id,proof_id,worker_id) values(p_id,p_proof,p_worker);
 update club_password_grants set status='resolved',cipher=null,username='',updated_at=now() where id=p_id;
 if g.source='password_request' then update club_commands set status='done',payload='{}',message='Доступ подтверждён входом владельца. Результат смены пароля неизвестен',updated_at=now() where id=g.source_id and status='awaiting_admin'; end if;
 return true;
end $$;
revoke all on function public.club_password_review(uuid,uuid),public.club_password_resolve(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.club_password_review(uuid,uuid),public.club_password_resolve(uuid,uuid,uuid,boolean) to service_role;
alter function public.club_worker_poll(uuid,bigint,jsonb,jsonb) rename to club_worker_poll_before_password_grants;
create function public.club_worker_poll(p_worker uuid,p_after bigint default 0,p_hosts jsonb default null,p_accounts jsonb default '[]') returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; grants jsonb;
begin
 result:=club_worker_poll_before_password_grants(p_worker,p_after,p_hosts,p_accounts);perform club_password_cleanup();
 select coalesce(jsonb_agg(to_jsonb(g)-'cipher'-'worker_id'-'request_id'),'[]') into grants from (select * from club_password_grants where status in ('authorized','queued','processing','attention') order by created_at limit 100) g;
 return jsonb_set(result,'{desk,password_grants}',grants);
end $$;
alter function public.club_client_state(bigint) rename to club_client_state_before_password_grants;
create function public.club_client_state(p_user bigint) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 return club_client_state_before_password_grants(p_user)||jsonb_build_object('password_grant',club_password_status(p_user));
end $$;
revoke all on function public.club_password_cleanup(),public.club_password_context(uuid,text,uuid),public.club_password_authorize(uuid,text,uuid,integer,text,integer,integer,boolean,boolean),public.club_password_status(bigint),public.club_password_submit(uuid,bigint,uuid,text,integer),public.club_password_claim(uuid,uuid),public.club_password_finish(uuid,uuid,text),public.club_worker_poll(uuid,bigint,jsonb,jsonb),public.club_client_state(bigint) from public,anon,authenticated;
grant execute on function public.club_password_cleanup(),public.club_password_context(uuid,text,uuid),public.club_password_authorize(uuid,text,uuid,integer,text,integer,integer,boolean,boolean),public.club_password_status(bigint),public.club_password_submit(uuid,bigint,uuid,text,integer),public.club_password_claim(uuid,uuid),public.club_password_finish(uuid,uuid,text),public.club_worker_poll(uuid,bigint,jsonb,jsonb),public.club_client_state(bigint) to service_role;
notify pgrst,'reload schema';
commit;
-- >>> End of supabase/migrations/202610080016_guest_password_grants.sql <<<


-- >>> Start of supabase/migrations/202610080017_own_session_lock_and_rota.sql <<<
-- Migration 017: Own session lock support and club admin rota
begin;

alter table public.club_settings add column if not exists rota jsonb not null default '{}'::jsonb;

create or replace function public.club_command(p_user bigint,p_kind text,p_payload jsonb,p_request uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare
 cid uuid; gid integer; cached record;
begin
 perform pg_advisory_xact_lock(p_user);
 select gizmo_user_id into gid from profiles where telegram_id=p_user;
 if gid is null then raise exception 'Профиль не найден'; end if;
 if p_request is not null then
  select id into cid from club_commands where telegram_id=p_user and request_id=p_request;
  if found then return cid; end if;
 end if;
 if exists(select 1 from club_commands where telegram_id=p_user and kind=p_kind and status in ('queued','running','awaiting_admin')) then raise exception 'Предыдущий запрос ещё обрабатывается'; end if;
 if p_kind not in ('profile_edit','logout','password_request','lock') then raise exception 'Неизвестная операция'; end if;
 if p_kind in ('logout','lock') then
  select * into cached from club_accounts where telegram_id=p_user and gizmo_user_id=gid and updated_at>now()-interval '30 seconds';
  if not found or cached.data->'session' is null or cached.data->'session'='null'::jsonb or cached.data->'session'->>'key' is distinct from p_payload->>'session_key' then raise exception 'Сессия изменилась. Обновите профиль'; end if;
  p_payload:=cached.data->'session';
 elsif p_kind='profile_edit' then
  if exists(select 1 from club_accounts where telegram_id=p_user and gizmo_user_id=gid and data->'session' is not null and data->'session'<>'null'::jsonb and updated_at>now()-interval '30 seconds') then raise exception 'Сначала завершите игровую сессию'; end if;
 end if;
 insert into club_commands(telegram_id,gizmo_user_id,kind,payload,request_id,status)
 values(p_user,gid,p_kind,p_payload,p_request,case when p_kind='password_request' then 'awaiting_admin' else 'queued' end) returning id into cid;
 return cid;
end;
$$;

revoke all on function public.club_command(bigint,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.club_command(bigint,text,jsonb,uuid) to service_role;

commit;
-- >>> End of supabase/migrations/202610080017_own_session_lock_and_rota.sql <<<
