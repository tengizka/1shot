-- Gizmo is authoritative. Only the leased Desk worker can publish its schedule or take jobs.
alter table public.club_settings add column booking_backend text not null default 'desk'
 check (booking_backend in ('desk','drain','gizmo'));

create table public.club_native_schedule (
 id boolean primary key default true check (id),
 observed_at timestamptz not null,
 worker_id uuid not null,
 hosts jsonb not null,
 reservations jsonb not null
);
create table public.club_native_bookings (
 id uuid primary key,
 telegram_id bigint not null,
 gizmo_user_id integer not null,
 host_id text not null,
 starts_at timestamptz not null,
 ends_at timestamptz not null check (ends_at>starts_at),
 status text not null default 'queued' check (status in
  ('queued','creating','confirmed','cancel_queued','cancelling','cancelled','failed','review','completed')),
 gizmo_id integer unique,
 claimed_by uuid,
 changed_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 message text
);
alter table public.club_native_schedule enable row level security;
alter table public.club_native_bookings enable row level security;
revoke all on public.club_native_schedule,public.club_native_bookings from public,anon,authenticated;
grant select on public.club_native_bookings to service_role;
create index club_native_bookings_guest on public.club_native_bookings(telegram_id,gizmo_user_id,created_at desc);
create index club_native_bookings_open on public.club_native_bookings(status,changed_at)
 where status not in ('cancelled','failed','completed');

create function public.club_native_hall_pc(p_host text) returns boolean
 language sql immutable set search_path=public as $$
 select p_host ~ '^(1[1-5]|2[1-5]|10[1-6]|20[1-8]|30[1-4]|40[1-2])$'
$$;
revoke all on function public.club_native_hall_pc(text) from public,anon,authenticated;

-- Freeze all previous booking entry points during cutover, including old clients and Desk tools.
-- Existing rows can still finish or be cancelled. Manual bookings move to Gizmo Manager.
create function public.club_native_guard_legacy() returns trigger language plpgsql set search_path=public as $$
begin
 if (select booking_backend from club_settings where id for share)<>'desk' then
  raise exception 'Брони оформляются в Gizmo. Обновите приложение или обратитесь к администратору';
 end if;
 return new;
end $$;
create trigger club_native_guard_desk before insert on public.club_bookings
 for each row execute function public.club_native_guard_legacy();
create trigger club_native_guard_legacy before insert on public.reservations
 for each row execute function public.club_native_guard_legacy();

create function public.club_native_switch() returns trigger language plpgsql set search_path=public as $$
begin
 if new.booking_backend=old.booking_backend then return new; end if;
 if old.booking_backend<>'drain' and new.booking_backend<>'drain' then
  raise exception 'Сначала переключите бронирование в drain';
 end if;
 if new.booking_backend='gizmo' and (
  exists(select from club_bookings where status not in ('cancelled','expired','completed')) or
  exists(select from reservations where status in ('pending','confirmed') and created_at>now()-interval '1 hour')
 ) then raise exception 'Сначала завершите действующие брони Desk'; end if;
 if new.booking_backend='gizmo' and not exists(select from club_native_schedule s
   join club_worker w on s.worker_id=w.worker_id
   where s.observed_at>now()-interval '25 seconds' and w.lease_until>now()
     and jsonb_array_length(s.hosts)>0) then
  raise exception 'Нет свежего расписания Gizmo от Desk';
 end if;
 if new.booking_backend='desk' and exists(select from club_native_bookings
   where status in ('queued','creating','confirmed','cancel_queued','cancelling','review')) then
  raise exception 'Сначала завершите брони Gizmo и разберите спорные заявки';
 end if;
 return new;
end $$;
create trigger club_native_switch before update of booking_backend on public.club_settings
 for each row execute function public.club_native_switch();

create function public.club_native_public_schedule() returns jsonb
 language sql stable security definer set search_path=public as $$
 select coalesce((
  select jsonb_build_object('ready',true,'server_time',now(),'valid_for_ms',
    greatest(0, floor(extract(epoch from least(s.observed_at+interval '30 seconds',w.lease_until)-now())*1000)),
    'hosts',coalesce((select jsonb_agg(jsonb_build_object(
     'host_id',h->'host_id','status',h->'status','free_at',h->'free_at'))
     from jsonb_array_elements(s.hosts) h where club_native_hall_pc(h->>'host_id')),'[]'::jsonb),'reservations',coalesce((
     select jsonb_agg(jsonb_build_object('host_id',r->'host_id','starts_at',r->'starts_at','ends_at',r->'ends_at'))
     from jsonb_array_elements(s.reservations) r
     where club_native_hall_pc(r->>'host_id') and (r->>'ends_at')::timestamptz>now()
       and (r->>'starts_at')::timestamptz<now()+interval '30 hours'
    ),'[]'::jsonb) || coalesce((
     select jsonb_agg(jsonb_build_object('host_id',b.host_id,'starts_at',b.starts_at,'ends_at',b.ends_at))
     from club_native_bookings b
     where b.status in ('queued','creating','confirmed','cancel_queued','cancelling','review') and b.ends_at>now()
       and (b.status<>'queued' or b.created_at>now()-interval '2 minutes')
    ),'[]'::jsonb))
  from club_native_schedule s join club_worker w on w.worker_id=s.worker_id
  where s.id and w.lease_until>now() and s.observed_at>now()-interval '30 seconds'
 ),jsonb_build_object('ready',false,'server_time',now(),'valid_for_ms',0,'hosts','[]'::jsonb,'reservations','[]'::jsonb));
$$;

create function public.club_native_create(p_user bigint,p_id uuid,p_host text,p_start timestamptz,p_end timestamptz)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare
 gid integer;
 booking club_native_bookings;
 schedule jsonb;
 host jsonb;
 backend text;
begin
 -- Serialize our submissions and worker snapshot replacement. Gizmo itself still owns manual writes.
 select booking_backend into backend from club_settings where id for update;
 select gizmo_user_id into gid from profiles where telegram_id=p_user for share;
 if gid is null or gid<=0 then raise exception 'Войдите в аккаунт клуба'; end if;
 select * into booking from club_native_bookings where id=p_id;
 if found then
  if booking.telegram_id<>p_user or booking.gizmo_user_id<>gid or booking.host_id is distinct from p_host
     or booking.starts_at is distinct from p_start or booking.ends_at is distinct from p_end then
   raise exception 'Этот запрос уже использован';
  end if;
  return jsonb_build_object('id',booking.id,'status',booking.status);
 end if;
 if backend<>'gizmo' then raise exception 'Новые брони временно недоступны'; end if;
 if p_id is null or p_host is null or not club_native_hall_pc(p_host) or p_start is null or p_end is null
    or p_start<=now()+interval '1 minute' or p_start>now()+interval '24 hours'
    or p_end<p_start+interval '30 minutes' or p_end>p_start+interval '6 hours'
    or extract(second from p_start)<>0 or extract(minute from p_start)::integer%5<>0
    or extract(second from p_end)<>0 then
  raise exception 'Выберите начало в ближайшие 24 часа и длительность от 30 минут до 6 часов';
 end if;
 schedule:=club_native_public_schedule();
 if not (schedule->>'ready')::boolean then raise exception 'Не удалось проверить расписание клуба'; end if;
 select h into host from jsonb_array_elements(schedule->'hosts') h where h->>'host_id'=p_host;
 if host is null or host->>'status' not in ('free','busy') or
    (host->>'status'='busy' and ((host->>'free_at') is null or
       (host->>'free_at')::timestamptz not between now() and p_start)) then
  raise exception 'ПК недоступен на выбранное время';
 end if;
 if exists(select from club_native_bookings where gizmo_user_id=gid
   and status in ('queued','creating','confirmed','cancel_queued','cancelling','review')
   and (status<>'queued' or created_at>now()-interval '2 minutes')
   and (ends_at>now() or status='review')) then
  raise exception 'У вас уже есть бронь. Откройте «Мои брони»';
 end if;
 if exists(select from jsonb_array_elements(schedule->'reservations') r where r->>'host_id'=p_host
   and (r->>'starts_at')::timestamptz<p_end and (r->>'ends_at')::timestamptz>p_start) then
  raise exception 'Время уже занято. Выберите другой ПК или интервал';
 end if;
 insert into club_native_bookings(id,telegram_id,gizmo_user_id,host_id,starts_at,ends_at)
 values(p_id,p_user,gid,p_host,p_start,p_end) returning * into booking;
 return jsonb_build_object('id',booking.id,'status',booking.status);
end $$;

create function public.club_native_cancel(p_user bigint,p_id uuid) returns boolean
 language plpgsql security definer set search_path=public as $$
declare booking club_native_bookings;
begin
 select b.* into booking from club_native_bookings b join profiles p
  on p.telegram_id=b.telegram_id and p.gizmo_user_id=b.gizmo_user_id
  where b.id=p_id and b.telegram_id=p_user for update of b;
 if not found then return false; end if;
 if booking.status in ('cancel_queued','cancelling','cancelled') then return true; end if;
 if booking.status='queued' then
  update club_native_bookings set status='cancelled',changed_at=now() where id=p_id;
  return true;
 end if;
 if booking.status='confirmed' and booking.starts_at>now() then
  update club_native_bookings set status='cancel_queued',changed_at=now() where id=p_id;
  return true;
 end if;
 return false;
end $$;

create function public.club_native_worker(p_worker uuid,p_action text,p_data jsonb) returns jsonb
 language plpgsql security definer set search_path=public as $$
declare
 backend text;
 booking club_native_bookings;
 next_status text;
 observed timestamptz;
 changed jsonb;
begin
 select booking_backend into backend from club_settings where id for update;
 if not exists(select from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'lease_expired'; end if;
 if backend='desk' then return jsonb_build_object('enabled',false); end if;
 if p_action='mode' then return jsonb_build_object('enabled',true); end if;
 if p_action='sync' then
  observed:=(p_data->>'observed_at')::timestamptz;
  if observed is null or observed>now() or observed<now()-interval '25 seconds'
    or jsonb_typeof(p_data->'hosts') is distinct from 'array'
    or jsonb_typeof(p_data->'reservations') is distinct from 'array' or octet_length(p_data::text)>500000 then
   raise exception 'invalid_schedule';
  end if;
  insert into club_native_schedule(id,observed_at,worker_id,hosts,reservations)
   values(true,observed,p_worker,p_data->'hosts',p_data->'reservations')
   on conflict(id) do update set observed_at=excluded.observed_at,worker_id=excluded.worker_id,
     hosts=excluded.hosts,reservations=excluded.reservations
   where club_native_schedule.observed_at<=excluded.observed_at;
  -- A crash or lost response after a claim is never permission to send it again.
  update club_native_bookings set status='review',changed_at=now(),message='Проверьте бронь у администратора клуба'
   where status in ('creating','cancelling') and changed_at<now()-interval '90 seconds';
  update club_native_bookings set status='completed',changed_at=now()
   where status in ('confirmed','cancel_queued') and ends_at<=now();
  update club_native_bookings set status='failed',changed_at=now(),
   message=case when starts_at<=now() then 'Время начала уже прошло' else 'Время обработки заявки истекло' end
   where status='queued' and (starts_at<=now() or created_at<=now()-interval '2 minutes');
  -- At this point the batch describes all active Gizmo reservations, including manual changes.
  with missing as (
   update club_native_bookings b set status='review',changed_at=now(),message='Расписание изменилось. Уточните бронь у администратора'
    where b.status='confirmed' and b.changed_at<observed and b.ends_at>now()
     and not exists(select from jsonb_array_elements(p_data->'reservations') r where (r->>'gizmo_id')::integer=b.gizmo_id
        and r->>'host_id'=b.host_id and (r->>'starts_at')::timestamptz=b.starts_at
        and (r->>'ends_at')::timestamptz=b.ends_at)
    returning id,gizmo_id
  )
  select coalesce(jsonb_agg(to_jsonb(missing)),'[]'::jsonb) into changed from missing;
  return jsonb_build_object('ok',true,'changed',changed,
    'review_count',(select count(*) from club_native_bookings where status='review'));
 end if;
 if p_action='manual_cancelled' then
  update club_native_bookings set status='cancelled',changed_at=now(),message=null
   where id=(p_data->>'id')::uuid and gizmo_id=(p_data->>'gizmo_id')::integer and status='review';
  return jsonb_build_object('ok',found);
 end if;
 if p_action='claim' then
  select * into booking from club_native_bookings
   where (status='queued' and backend='gizmo' and starts_at>now() and created_at>now()-interval '2 minutes')
      or status='cancel_queued'
   order by (status='cancel_queued') desc,created_at limit 1 for update;
  if not found then return jsonb_build_object('job',null); end if;
  update club_native_bookings set status=case when booking.status='queued' then 'creating' else 'cancelling' end,
   claimed_by=p_worker,changed_at=now() where id=booking.id returning * into booking;
  return jsonb_build_object('job',to_jsonb(booking));
 end if;
 if p_action='permit' then
  select * into booking from club_native_bookings where id=(p_data->>'id')::uuid;
  if not found or booking.claimed_by is distinct from p_worker
    or booking.status not in ('creating','cancelling')
    or not exists(select from club_worker where worker_id=p_worker and lease_until>now()+interval '10 seconds')
    or (booking.status='creating' and p_data->>'linking' is distinct from 'true'
        and (backend<>'gizmo' or booking.starts_at<=now())) then
   raise exception 'job_lease_expired';
  end if;
  return jsonb_build_object('ok',true);
 end if;
 if p_action='finish' then
  next_status:=p_data->>'status';
  select * into booking from club_native_bookings where id=(p_data->>'id')::uuid for update;
  if not found or booking.claimed_by is distinct from p_worker then return jsonb_build_object('ok',false); end if;
  if booking.status=next_status then return jsonb_build_object('ok',true); end if;
  if (booking.status='creating' and next_status in ('confirmed','failed','review'))
    or (booking.status='cancelling' and next_status in ('cancelled','confirmed','review')) then
   update club_native_bookings set status=next_status,
    gizmo_id=coalesce((p_data->>'gizmo_id')::integer,gizmo_id),
    message=left(p_data->>'message',160),changed_at=now() where id=booking.id;
   return jsonb_build_object('ok',true,'notify',case when booking.status='creating' and next_status='confirmed'
      then jsonb_build_object('user_id',booking.telegram_id,'host_id',booking.host_id,'starts_at',booking.starts_at) end);
  end if;
  return jsonb_build_object('ok',false);
 end if;
 raise exception 'unknown_action';
end $$;

revoke all on function public.club_native_public_schedule(),public.club_native_create(bigint,uuid,text,timestamptz,timestamptz),
 public.club_native_cancel(bigint,uuid),public.club_native_worker(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.club_native_public_schedule(),public.club_native_create(bigint,uuid,text,timestamptz,timestamptz),
 public.club_native_cancel(bigint,uuid),public.club_native_worker(uuid,text,jsonb) to service_role;
