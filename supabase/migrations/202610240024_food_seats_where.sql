-- Supabase blocks DELETE without WHERE for API calls (pg_safeupdate): clear the seat list explicitly.
create or replace function public.club_food_sync(p_worker uuid,p_seats jsonb,p_menu jsonb,p_updates jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare u jsonb;v_rank integer;v_old integer;
begin
 if not exists(select 1 from club_worker where worker_id=p_worker and lease_until>now()) then raise exception 'worker_lease_expired'; end if;
 if p_menu is not null then
  if jsonb_typeof(p_menu)<>'array' then raise exception 'invalid_menu'; end if;
  delete from club_food_menu where id not in (select (x->>'id')::integer from jsonb_array_elements(p_menu) x);
  insert into club_food_menu(id,group_name,group_order,name,price,image,sort,updated_at)
   select distinct on ((x->>'id')::integer) (x->>'id')::integer,left(x->>'group',45),coalesce((x->>'group_order')::integer,0),left(x->>'name',60),(x->>'price')::numeric,x->>'image',coalesce((x->>'sort')::integer,0),now() from jsonb_array_elements(p_menu) x
   on conflict(id) do update set group_name=excluded.group_name,group_order=excluded.group_order,name=excluded.name,price=excluded.price,image=excluded.image,sort=excluded.sort,updated_at=now();
 end if;
 if p_seats is not null then
  delete from club_food_seats where gizmo_user_id is not null;
  insert into club_food_seats(gizmo_user_id,host_id) select distinct on ((x->>'uid')::integer) (x->>'uid')::integer,x->>'host' from jsonb_array_elements(p_seats) x where (x->>'uid')::integer>0;
 end if;
 update club_food_orders set status='closed',updated_at=now() where status<>'closed' and created_at<now()-interval '3 hours';
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
