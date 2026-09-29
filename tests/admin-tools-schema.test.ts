import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
Deno.test('staff manual bookings/login and next-day scheduling preserve ownership and availability',async()=>{
 const db=new PGlite(),worker=crypto.randomUUID();const check=(v:unknown)=>{if(!v)throw Error('assertion failed')};const fail=async(f:()=>Promise<unknown>)=>{try{await f()}catch{return}throw Error('expected rejection')};
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
  create table profiles(telegram_id bigint primary key,gizmo_user_id integer,username text,first_name text,last_name text);
  create table hosts_cache(host_id text primary key,status text,updated_at timestamptz,zone text,gizmo_host_id integer);
  create table reservations(id uuid primary key default gen_random_uuid(),telegram_id bigint,host_id text,duration_hours numeric,price numeric,status text default 'pending',created_at timestamptz default now());
  insert into profiles values(100,7,'guest','','');insert into hosts_cache values('101','free',now(),'100',50),('102','free',now(),'100',51),('103','busy',now(),'100',52),('1','free',now(),'ps5',1);`);
  for(const name of ['202609250006_club_desk_beta.sql','202609250007_club_sessions.sql','202609250008_strict_booking.sql','202609250009_auth_v2.sql','202609250010_arrival_time.sql','202609250011_economy_poll.sql','202609250012_admin_tools.sql'])await db.exec(await Deno.readTextFile('supabase/migrations/'+name));
  await db.exec('update club_settings set enabled=true,flow_version=2');await db.query('select club_worker_lease($1)',[worker]);await db.exec('update club_worker set protocol=2');
  const tomorrow=(await db.query<{t:string}>("select ((now() at time zone 'Europe/Moscow')::date+1)::timestamp at time zone 'Europe/Moscow' t")).rows[0].t;
  const request=crypto.randomUUID();const reserve=async(host='101',id=request,w=worker)=>(await db.query<{id:string}>("select club_admin_booking($1,'reserve',$2,$3,'',$4) id",[w,host,tomorrow,id])).rows[0].id;
  const id=await reserve();check(await reserve()===id);
  const row=(await db.query<any>('select *,extract(epoch from hold_until-starts_at)/60 minutes from club_bookings where id=$1',[id])).rows[0];check(row.telegram_id===null&&row.gizmo_user_id===null&&row.admin_created);check(Number(row.minutes)===30);
  await fail(()=>reserve('101',crypto.randomUUID()));await fail(()=>reserve('103',crypto.randomUUID()));await fail(()=>reserve('1',crypto.randomUUID()));await fail(()=>reserve('102',crypto.randomUUID(),crypto.randomUUID()));
  await fail(()=>db.query("select club_create_v2(100,'101','scheduled','range',$1,null,$2,false)",[tomorrow,crypto.randomUUID()]));
  const mini=(await db.query<any>("select * from club_create_v2(100,'102','scheduled','range',$1,null,$2,false)",[tomorrow,crypto.randomUUID()])).rows[0];check(mini.telegram_id===100);
  check(!(await db.query<{v:boolean}>('select club_cancel(100,$1) v',[id])).rows[0].v);
  check((await db.query<any>('select club_client_state(100) v')).rows[0].v.bookings.length===1);
  // Staff may bind an anonymous, currently held reservation to a chosen account.
  await db.query("update club_bookings set starts_at=now()-interval '1 minute',hold_until=now()+interval '29 minutes',status='holding' where id=$1",[id]);await db.exec("update hosts_cache set status='reserved' where host_id='101'");
  const login=crypto.randomUUID();const enter=async()=>db.query<any>("select club_admin_booking($1,'login','101',null,'guest',$2,7,$3) id",[worker,login,id]);check((await enter()).rows[0].id===id);check((await enter()).rows[0].id===id);
  check((await db.query<any>('select status,gizmo_user_id from club_bookings where id=$1',[id])).rows[0].status==='checkin_pending');
  await fail(()=>db.query("select club_admin_booking($1,'login','103',null,'guest',$2,7)",[worker,crypto.randomUUID()]));
  check((await db.query<{v:boolean}>('select club_admin_cancel($1,$2) v',[worker,id])).rows[0].v);
  await fail(()=>db.query("select club_admin_booking($1,'reserve','102',date_trunc('day',now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow'+interval '3 days','',$2)",[worker,crypto.randomUUID()]));
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await fail(()=>reserve());await fail(()=>enter());await fail(()=>db.query('select club_admin_cancel($1,$2)',[worker,id]));await db.exec('reset role')}
 }finally{await db.close()}
});
