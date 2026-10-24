-- Food orders from the mini-app. Nothing is sold here: Desk copies the bar menu from Gizmo (read-only)
-- and turns each order into the club's existing «Сделать заказ» assistance request; the admin rings it up in
-- Gizmo as usual. The guest only ever sees: sent → accepted → closed (a rejected or replaced order is "closed").
begin;
create table public.club_food_menu(
 id integer primary key,
 group_name text not null,
 group_order integer not null default 0,
 name text not null,
 price numeric(10,2) not null check(price>=0),
 image text check(image is null or (image like 'data:image/%' and length(image)<=60000)),
 sort integer not null default 0,
 updated_at timestamptz not null default now()
);
-- Who sits at which PC right now, pushed by Desk from Gizmo sessions every few seconds.
create table public.club_food_seats(
 gizmo_user_id integer primary key,
 host_id text not null,
 seen_at timestamptz not null default now()
);
create table public.club_food_orders(
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 telegram_id bigint not null,
 gizmo_user_id integer not null,
 host_id text not null,
 items jsonb not null,
 total numeric(10,2) not null,
 payment text not null check(payment in ('deposit','card','cash')),
 status text not null default 'new' check(status in ('new','sent','accepted','closed')),
 assistance_id integer,
 message text not null default '',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index club_food_orders_user on public.club_food_orders(telegram_id,created_at desc);
create index club_food_orders_open on public.club_food_orders(status) where status<>'closed';
alter table public.club_food_menu enable row level security;
alter table public.club_food_seats enable row level security;
alter table public.club_food_orders enable row level security;
revoke all on public.club_food_menu,public.club_food_seats,public.club_food_orders from public,anon,authenticated;

create function public.club_food_order_view(o public.club_food_orders) returns jsonb language sql stable set search_path=public as $$
 select jsonb_build_object('id',o.id,'status',o.status,'items',o.items,'total',o.total,'payment',o.payment,'host_id',o.host_id,'message',o.message,'created_at',o.created_at,'updated_at',o.updated_at)
$$;

-- Mini-app: the guest's seat and recent orders; the menu (with pictures) only when asked, the version always.
create function public.club_food_state(p_user bigint,p_menu boolean default false) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_uid integer;v_seat text;
begin
 select gizmo_user_id into v_uid from profiles where telegram_id=p_user;
 if v_uid is not null then select host_id into v_seat from club_food_seats where gizmo_user_id=v_uid and seen_at>now()-interval '60 seconds'; end if;
 return jsonb_build_object(
  'menu_version',(select coalesce(extract(epoch from max(updated_at))::bigint::text,'0')||'-'||count(*) from club_food_menu),
  'menu',case when p_menu then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'group',group_name,'name',name,'price',price,'image',image) order by group_order,group_name,sort,name),'[]'::jsonb) from club_food_menu) end,
  'account',v_uid is not null,
  'seat',v_seat,
  'desk',exists(select 1 from club_worker where lease_until>now()),
  'orders',(select coalesce(jsonb_agg(club_food_order_view(o) order by o.created_at desc),'[]'::jsonb) from (select * from club_food_orders where telegram_id=p_user and created_at>now()-interval '12 hours' order by created_at desc limit 5) o)
 );
end $$;

-- Mini-app: place an order. Prices come from the menu, never from the client.
create function public.club_food_order(p_user bigint,p_request uuid,p_items jsonb,p_payment text) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid integer;v_seat text;v_items jsonb;v_total numeric;v_lines integer;v_order club_food_orders;
begin
 select * into v_order from club_food_orders where request_id=p_request and telegram_id=p_user;
 if found then return club_food_order_view(v_order); end if;
 select gizmo_user_id into v_uid from profiles where telegram_id=p_user;
 if v_uid is null then raise exception 'Сначала войдите в аккаунт клуба'; end if;
 if not exists(select 1 from club_worker where lease_until>now()) then raise exception 'Заказы сейчас не принимаются. Позовите администратора с ПК'; end if;
 select host_id into v_seat from club_food_seats where gizmo_user_id=v_uid and seen_at>now()-interval '60 seconds';
 if v_seat is null then raise exception 'Заказать можно, только когда вы сидите за ПК в клубе'; end if;
 if p_payment is null or p_payment not in ('deposit','card','cash') then raise exception 'Выберите способ оплаты'; end if;
 if exists(select 1 from club_food_orders where telegram_id=p_user and status in ('new','sent') and created_at>now()-interval '20 minutes') then raise exception 'Прошлый заказ ещё у администратора. Дождитесь ответа'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 10 then raise exception 'В заказе от 1 до 10 позиций'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) e where coalesce(jsonb_typeof(e->'id'),'')<>'number' or coalesce(jsonb_typeof(e->'qty'),'')<>'number' or (e->>'qty')::numeric not in (1,2,3,4,5)) then raise exception 'До 5 штук каждой позиции'; end if;
 if (select count(distinct e->>'id') from jsonb_array_elements(p_items) e)<>jsonb_array_length(p_items) then raise exception 'Позиции в заказе повторяются'; end if;
 select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'price',m.price,'qty',((e->>'qty')::numeric)::int) order by m.group_order,m.sort,m.name),sum(m.price*((e->>'qty')::numeric)::int),count(*)
  into v_items,v_total,v_lines from jsonb_array_elements(p_items) e join club_food_menu m on m.id=(e->>'id')::numeric;
 if v_lines is distinct from jsonb_array_length(p_items) then raise exception 'Меню обновилось. Откройте раздел заново'; end if;
 insert into club_food_orders(request_id,telegram_id,gizmo_user_id,host_id,items,total,payment) values(p_request,p_user,v_uid,v_seat,v_items,v_total,p_payment) returning * into v_order;
 return club_food_order_view(v_order);
end $$;

-- Desk: replace the menu (only when it changed), refresh seats, report order updates, get open orders.
create function public.club_food_sync(p_worker uuid,p_seats jsonb,p_menu jsonb,p_updates jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare u jsonb;v_rank integer;v_old integer;
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 if p_menu is not null then
  if jsonb_typeof(p_menu)<>'array' then raise exception 'invalid_menu'; end if;
  delete from club_food_menu where id not in (select (x->>'id')::integer from jsonb_array_elements(p_menu) x);
  insert into club_food_menu(id,group_name,group_order,name,price,image,sort,updated_at)
   select (x->>'id')::integer,left(x->>'group',45),coalesce((x->>'group_order')::integer,0),left(x->>'name',60),(x->>'price')::numeric,x->>'image',coalesce((x->>'sort')::integer,0),now() from jsonb_array_elements(p_menu) x
   on conflict(id) do update set group_name=excluded.group_name,group_order=excluded.group_order,name=excluded.name,price=excluded.price,image=excluded.image,sort=excluded.sort,updated_at=now();
 end if;
 if p_seats is not null then
  delete from club_food_seats;
  insert into club_food_seats(gizmo_user_id,host_id) select distinct on ((x->>'uid')::integer) (x->>'uid')::integer,x->>'host' from jsonb_array_elements(p_seats) x where (x->>'uid')::integer>0;
 end if;
 update club_food_orders set status='closed',updated_at=now() where status<>'closed' and created_at<now()-interval '3 hours';
 -- Status only moves forward: new → sent → accepted → closed.
 for u in select * from jsonb_array_elements(coalesce(p_updates,'[]')) loop
  v_rank:=array_position(array['new','sent','accepted','closed'],u->>'status');
  if v_rank is null then continue; end if;
  select array_position(array['new','sent','accepted','closed'],status) into v_old from club_food_orders where id=(u->>'id')::uuid;
  if v_old is null or v_rank<v_old then continue; end if;
  update club_food_orders set status=u->>'status',assistance_id=coalesce((u->>'assistance_id')::integer,assistance_id),message=left(coalesce(u->>'message',message),200),updated_at=now()
   where id=(u->>'id')::uuid and (status<>u->>'status' or assistance_id is distinct from coalesce((u->>'assistance_id')::integer,assistance_id) or message<>left(coalesce(u->>'message',message),200));
 end loop;
 return jsonb_build_object('orders',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'gizmo_user_id',gizmo_user_id,'host_id',host_id,'items',items,'total',total,'payment',payment,'status',status,'assistance_id',assistance_id,'created_at',created_at) order by created_at),'[]'::jsonb)
  from club_food_orders where status<>'closed' and created_at>now()-interval '3 hours'),
  'menu_count',(select count(*) from club_food_menu));
end $$;

revoke all on function public.club_food_order_view(public.club_food_orders),public.club_food_state(bigint,boolean),public.club_food_order(bigint,uuid,jsonb,text),public.club_food_sync(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.club_food_state(bigint,boolean),public.club_food_order(bigint,uuid,jsonb,text),public.club_food_sync(uuid,jsonb,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
