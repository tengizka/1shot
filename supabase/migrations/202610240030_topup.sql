-- Top-up from the mini-app: a «topup» command asks Desk to create a Gizmo deposit payment intent (T-Bank link).
-- Desk returns the payment link as the command message; Gizmo credits the deposit itself once the guest pays.
do $$
declare c record;
begin
 for c in select conname from pg_constraint where conrelid='public.club_commands'::regclass and contype='c' and pg_get_constraintdef(oid) like '%kind%' loop
  execute format('alter table public.club_commands drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.club_commands add constraint club_commands_kind_check check(kind in ('profile_edit','logout','password_request','lock','topup'));

create or replace function public.club_command(p_user bigint,p_kind text,p_payload jsonb,p_request uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare
 cid uuid; gid integer; cached record; sum numeric;
begin
 perform pg_advisory_xact_lock(p_user);
 select gizmo_user_id into gid from profiles where telegram_id=p_user;
 if gid is null then raise exception 'Профиль не найден'; end if;
 if p_request is not null then
  select id into cid from club_commands where telegram_id=p_user and request_id=p_request;
  if found then return cid; end if;
 end if;
 -- A top-up link Desk never picked up must not block the next try.
 update club_commands set status='rejected',message='Клуб не ответил',updated_at=now() where telegram_id=p_user and kind='topup' and status='queued' and created_at<now()-interval '2 minutes';
 if exists(select 1 from club_commands where telegram_id=p_user and kind=p_kind and status in ('queued','running','awaiting_admin')) then raise exception 'Предыдущий запрос ещё обрабатывается'; end if;
 if p_kind not in ('profile_edit','logout','password_request','lock','topup') then raise exception 'Неизвестная операция'; end if;
 if p_kind in ('logout','lock') then
  select * into cached from club_accounts where telegram_id=p_user and gizmo_user_id=gid and updated_at>now()-interval '30 seconds';
  if not found or cached.data->'session' is null or cached.data->'session'='null'::jsonb or cached.data->'session'->>'key' is distinct from p_payload->>'session_key' then raise exception 'Сессия изменилась. Обновите профиль'; end if;
  p_payload:=cached.data->'session';
 elsif p_kind='profile_edit' then
  if exists(select 1 from club_accounts where telegram_id=p_user and gizmo_user_id=gid and data->'session' is not null and data->'session'<>'null'::jsonb and updated_at>now()-interval '30 seconds') then raise exception 'Сначала завершите игровую сессию'; end if;
 elsif p_kind='topup' then
  if jsonb_typeof(p_payload->'amount') is distinct from 'number' then raise exception 'Укажите сумму'; end if;
  sum:=(p_payload->>'amount')::numeric;
  if sum<>trunc(sum) or sum<100 or sum>50000 then raise exception 'Сумма от 100 до 50 000 ₽'; end if;
  if (select count(*) from club_commands where telegram_id=p_user and kind='topup' and created_at>now()-interval '1 hour')>=10 then raise exception 'Слишком много попыток. Попробуй через час'; end if;
  p_payload:=jsonb_build_object('amount',sum::integer);
 end if;
 insert into club_commands(telegram_id,gizmo_user_id,kind,payload,request_id,status)
 values(p_user,gid,p_kind,p_payload,p_request,case when p_kind='password_request' then 'awaiting_admin' else 'queued' end) returning id into cid;
 return cid;
end;
$$;
revoke all on function public.club_command(bigint,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.club_command(bigint,text,jsonb,uuid) to service_role;
notify pgrst,'reload schema';
