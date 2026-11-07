-- Queue for a busy PC (one guest per PC, one PC per guest). When the PC frees up and stays free for 3 minutes
-- (a reboot is not a free PC), the guest gets an ordinary booking on it and a note from the bot.
-- The tick runs every minute in the database (pg_cron); bot notes go through club_bot_outbox and are delivered
-- by the club-bot function, called through pg_net only when there is something to send.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.club_queue(
 host_id text primary key,
 telegram_id bigint not null unique,
 created_at timestamptz not null default now(),
 free_since timestamptz
);
alter table public.club_queue enable row level security;
revoke all on public.club_queue from public,anon,authenticated;
grant all on public.club_queue to service_role;

create table if not exists public.club_bot_outbox(
 id bigserial primary key,
 chat_id bigint not null,
 text text not null,
 created_at timestamptz not null default now(),
 sent_at timestamptz
);
alter table public.club_bot_outbox enable row level security;
revoke all on public.club_bot_outbox from public,anon,authenticated;
grant all on public.club_bot_outbox to service_role;
grant usage,select on sequence public.club_bot_outbox_id_seq to service_role;

create or replace function public.club_queue_join(p_user bigint,p_host text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare h hosts_cache; other bigint;
begin
 perform pg_advisory_xact_lock(15837813);
 select * into h from hosts_cache where host_id=p_host;
 if not found then raise exception 'Нет такого ПК'; end if;
 if not exists(select 1 from profiles where telegram_id=p_user and gizmo_user_id>0) then raise exception 'Войдите в аккаунт клуба заново'; end if;
 if h.status='free' and not exists(select 1 from club_bookings where host_id=p_host and status not in ('cancelled','expired','completed')) then raise exception 'ПК уже свободен — бронируй сразу'; end if;
 if h.status='broken' then raise exception 'ПК сейчас не работает. Выбери другое место'; end if;
 select telegram_id into other from club_queue where host_id=p_host;
 if found and other<>p_user then raise exception 'На этот ПК уже стоит очередь. Выбери другое место'; end if;
 delete from club_queue where telegram_id=p_user and host_id<>p_host;
 insert into club_queue(host_id,telegram_id) values(p_host,p_user) on conflict(host_id) do nothing;
 return jsonb_build_object('host_id',p_host,'free_at',h.free_at);
end $$;

create or replace function public.club_queue_leave(p_user bigint) returns void
language sql security definer set search_path=public as $$ delete from club_queue where telegram_id=p_user $$;

create or replace function public.club_queue_tick() returns integer
language plpgsql security definer set search_path=public as $$
declare q club_queue; h hosts_cache; b club_bookings; pc text; notes integer:=0;
begin
 perform pg_advisory_xact_lock(15837813);
 delete from club_queue where created_at<now()-interval '12 hours';
 for q in select * from club_queue order by created_at loop
  select * into h from hosts_cache where host_id=q.host_id;
  continue when not found or h.updated_at<now()-interval '2 minutes';  -- Desk offline: no fresh truth, wait
  pc:=case when q.host_id='1' then 'PS5' else 'ПК '||q.host_id end;
  if h.status<>'free' or exists(select 1 from club_bookings where host_id=q.host_id and status not in ('cancelled','expired','completed')) then
   update club_queue set free_since=null where host_id=q.host_id and free_since is not null;
  elsif q.free_since is null then
   update club_queue set free_since=now() where host_id=q.host_id;
  elsif q.free_since<=now()-interval '3 minutes' then
   delete from club_queue where host_id=q.host_id;
   begin
    b:=club_create_v2(q.telegram_id,q.host_id,'arrival','hour',null,null,gen_random_uuid(),false);
    if q.telegram_id>0 then
     insert into club_bot_outbox(chat_id,text) values(q.telegram_id,'🟢 <b>'||pc||' освободился и теперь твой</b>'||chr(10)||'Держим до '||to_char(b.hold_until at time zone 'Europe/Moscow','HH24:MI')||'. Подходи 🎮');
     notes:=notes+1;
    end if;
   exception when others then
    if q.telegram_id>0 then
     insert into club_bot_outbox(chat_id,text) values(q.telegram_id,'🟢 <b>'||pc||' освободился</b>'||chr(10)||'Забронировать за тобой не вышло, успей занять в приложении.');
     notes:=notes+1;
    end if;
   end;
  end if;
 end loop;
 if notes>0 or exists(select 1 from club_bot_outbox where sent_at is null and created_at>now()-interval '1 hour') then
  perform net.http_post(url:='https://zqhfvtgktbfnxcclqqny.supabase.co/functions/v1/club-bot?outbox=1',body:='{}'::jsonb,headers:='{"content-type":"application/json"}'::jsonb);
 end if;
 return notes;
end $$;

revoke all on function public.club_queue_join(bigint,text),public.club_queue_leave(bigint),public.club_queue_tick() from public,anon,authenticated;
grant execute on function public.club_queue_join(bigint,text),public.club_queue_leave(bigint),public.club_queue_tick() to service_role;

select cron.unschedule(jobid) from cron.job where jobname='club-queue-tick';
select cron.schedule('club-queue-tick','* * * * *','select public.club_queue_tick()');

-- The mini-app gets the end time of busy PCs, which PCs have a queue, and the guest's own place in the queue.
create or replace function public.club_client_state(p_user bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 return club_client_state_before_password_grants(p_user)||jsonb_build_object(
  'password_grant',club_password_status(p_user),
  'hosts',coalesce((select jsonb_agg(x) from (select h.host_id,h.zone,h.status,h.updated_at,h.free_at,(q.host_id is not null) queued from hosts_cache h left join club_queue q using(host_id) order by h.host_id) x),'[]'::jsonb),
  'queue',(select to_jsonb(x) from (select q.host_id,h.free_at from club_queue q left join hosts_cache h using(host_id) where q.telegram_id=p_user) x));
end $$;
notify pgrst,'reload schema';
