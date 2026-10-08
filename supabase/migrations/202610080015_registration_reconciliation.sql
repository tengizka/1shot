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
