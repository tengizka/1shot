import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
Deno.test('1.3: five-minute arrival grid, half-hour wait across midnight, no friends and silent instant',async()=>{
 const db=new PGlite();const check=(v:unknown)=>{if(!v)throw Error('assertion failed')};const fail=async(fn:()=>Promise<unknown>)=>{try{await fn()}catch{return}throw Error('expected rejection')};
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
  create table profiles(telegram_id bigint primary key,gizmo_user_id integer);
  create table hosts_cache(host_id text primary key,status text,updated_at timestamptz,zone text);
  create table reservations(id uuid primary key default gen_random_uuid(),telegram_id bigint,host_id text,duration_hours numeric,price numeric,status text default 'pending',created_at timestamptz default now());
  insert into profiles values(100,7),(101,8);insert into hosts_cache values('101','free',now(),'100'),('102','free',now(),'100');`);
  for(const name of ['202609250006_club_desk_beta.sql','202609250007_club_sessions.sql','202609250008_strict_booking.sql','202609250010_arrival_time.sql'])await db.exec(await Deno.readTextFile('supabase/migrations/'+name));
  await db.exec('update club_settings set enabled=true,flow_version=2');await db.query('select club_worker_lease($1)',[crypto.randomUUID()]);await db.exec('update club_worker set protocol=2');
  const request=crypto.randomUUID();
  const instant=(await db.query<{id:string;instant:boolean}>("select * from club_create_v2(100,'101','instant','range',null,null,$1,false)",[request])).rows[0];check(instant.instant);
  check((await db.query('select * from club_events where booking_id=$1',[instant.id])).rows.length===0);
  await fail(()=>db.query("select club_create_v2(100,'102','arrival','range',null,null,$1,true)",[crypto.randomUUID()]));
  // Transaction freezes now: use tomorrow's midnight minus five minutes whenever it is still future.
  const start=(await db.query<{t:string}>("select (((now() at time zone 'Europe/Moscow')::date+1)::timestamp at time zone 'Europe/Moscow')-interval '5 minutes' as t")).rows[0].t;
  if(Date.parse(String(start))>Date.now()){
   const scheduled=(await db.query<{id:string;mins:number;ends_at:string;hold_until:string}>("select *,extract(epoch from hold_until-starts_at)/60 as mins from club_create_v2(100,'102','scheduled','open',$1,null,$2,false)",[start,crypto.randomUUID()])).rows[0];check(Number(scheduled.mins)===30);check(String(scheduled.ends_at)===String(scheduled.hold_until));
   check((await db.query('select * from club_events where booking_id=$1',[scheduled.id])).rows.length===1);
  }
  await fail(()=>db.query("select club_create_v2(101,'102','scheduled','range',date_trunc('minute',now())+interval '61 seconds',null,$1,false)",[crypto.randomUUID()]));
  await db.exec('set role anon');await fail(()=>db.query("select club_create_v2(100,'102','arrival','range',null,null,$1,false)",[crypto.randomUUID()]));
 }finally{await db.close()}
});
