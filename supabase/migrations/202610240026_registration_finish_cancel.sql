-- 1) A profile with gizmo_user_id 0 means "unlinked" (an account deleted in Gizmo); it no longer blocks a new one.
-- 2) Desk may finish an application that the timeout moved to «attention» when it reports the account it created.
-- 3) The guest can cancel a waiting application from the mini-app; it is removed for the club too.
-- 4) One Telegram may hold more than one club account: the admin checks the document anyway. The card shows the
--    account already linked to this Telegram, and the free promo hour stays one per Telegram.
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
   on conflict(telegram_id) do update set gizmo_user_id=excluded.gizmo_user_id,username=excluded.username,first_name=excluded.first_name,last_name=excluded.last_name;
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
create or replace function public.club_registration_submit(p_id uuid,p_user bigint,p_data jsonb,p_cipher text) returns uuid language plpgsql security definer set search_path=public as $$
declare existing uuid; promo text; linked jsonb;
begin
 perform pg_advisory_xact_lock(p_user);
 perform club_registration_cleanup();
 select id into existing from club_registration_requests where telegram_id=p_user and status in ('awaiting_admin','processing','attention');
 if found then return existing; end if;
 if (select count(*) from club_registration_requests where telegram_id=p_user and created_at>now()-interval '1 day')>=3 then raise exception 'Не больше трёх анкет в сутки'; end if;
 if p_user<=0 or p_cipher is null or length(p_cipher)>12000 or jsonb_typeof(p_data)<>'object' then raise exception 'invalid_application'; end if;
 promo:=nullif(upper(trim(coalesce(p_data->>'promo_code',''))),'');
 if promo is not null and not exists(select 1 from club_promo_codes where code=promo and active) then raise exception 'Промокод не найден. Проверьте его или продолжите без промокода'; end if;
 if promo is not null and exists(select 1 from club_promo_redemptions where telegram_id=p_user and (status='done' or reward='granted')) then raise exception 'С этого Telegram бесплатный час уже получали. Продолжите без промокода'; end if;
 select jsonb_build_object('username',username,'gizmo_user_id',gizmo_user_id) into linked from profiles where telegram_id=p_user and gizmo_user_id>0;
 -- Never accept extra fields such as a plaintext password into public summaries.
 insert into club_registration_requests(id,telegram_id,public_data,cipher) values(p_id,p_user,jsonb_strip_nulls(jsonb_build_object('username',p_data->>'username','first_name',p_data->>'first_name','last_name',p_data->>'last_name','mobile_phone',p_data->>'mobile_phone','birth_date',p_data->>'birth_date','sex',p_data->'sex','promo_code',promo,'linked_account',linked)),p_cipher);
 if promo is not null then insert into club_promo_redemptions(registration_id,telegram_id,code) values(p_id,p_user,promo); end if;
 return p_id;
end $$;
notify pgrst,'reload schema';
