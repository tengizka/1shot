-- 1) A profile with gizmo_user_id 0 means "unlinked" (an account deleted in Gizmo); it no longer blocks a new one.
-- 2) Desk may finish an application that the timeout moved to «attention» when it reports the account it created.
-- 3) The guest can cancel a waiting application from the mini-app; it is removed for the club too.
create or replace function public.club_registration_finish(p_worker uuid, p_id uuid, p_status text, p_uid integer default null) returns boolean language plpgsql security definer set search_path=public as $$
declare r club_registration_requests;
begin
 if p_status not in ('done','rejected','attention') or (p_status='done' and (p_uid is null or p_uid<=0)) then raise exception 'invalid_outcome'; end if;
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 select * into r from club_registration_requests where id=p_id for update;
 if not found then raise exception 'application_owner_mismatch'; end if;
 if r.status=p_status and r.gizmo_user_id is not distinct from p_uid then return true; end if;
 if not (r.status='processing' and r.worker_id is not distinct from p_worker)
    and not (r.status='attention' and p_status='done' and (r.gizmo_user_id is null or r.gizmo_user_id=p_uid)) then return false; end if;
 if p_status='done' then
  perform pg_advisory_xact_lock(r.telegram_id);
  insert into profiles(telegram_id,gizmo_user_id,username,first_name,last_name)
   values(r.telegram_id,p_uid,r.public_data->>'username',r.public_data->>'first_name',r.public_data->>'last_name')
   on conflict(telegram_id) do update set gizmo_user_id=excluded.gizmo_user_id,username=excluded.username,first_name=excluded.first_name,last_name=excluded.last_name
   where profiles.gizmo_user_id is null or profiles.gizmo_user_id<=0 or profiles.gizmo_user_id=excluded.gizmo_user_id;
  if not found then raise exception 'Telegram уже связан с другим аккаунтом. Нужна сверка'; end if;
 end if;
 update club_registration_requests set status=p_status,gizmo_user_id=p_uid,cipher=null,public_data=case when p_status='attention' then public_data else '{}'::jsonb end,updated_at=now() where id=p_id;
 return true;
end $$;

create or replace function public.club_registration_cancel(p_user bigint) returns boolean language plpgsql security definer set search_path=public as $$
declare r club_registration_requests;
begin
 select * into r from club_registration_requests where telegram_id=p_user order by created_at desc limit 1 for update;
 if not found then return true; end if;
 if r.status in ('rejected','expired') then return true; end if;
 if r.status<>'awaiting_admin' then raise exception 'Анкету уже обрабатывает администратор. Подойдите к стойке'; end if;
 update club_registration_requests set status='rejected',cipher=null,public_data='{}'::jsonb,updated_at=now() where id=r.id;
 return true;
end $$;
revoke all on function public.club_registration_cancel(bigint) from public,anon,authenticated;
grant execute on function public.club_registration_cancel(bigint) to service_role;
notify pgrst,'reload schema';
