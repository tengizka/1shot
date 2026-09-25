import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
Deno.test('strict free-only scheduling, old booking cancellation, encrypted auth claim and ownership boundaries',async()=>{
 const db=new PGlite();const check=(v:unknown)=>{if(!v)throw Error('assertion failed')};const fail=async(fn:()=>Promise<unknown>)=>{try{await fn()}catch{return}throw Error('expected rejection')};
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
  create table profiles(telegram_id bigint primary key,gizmo_user_id integer);
  create table hosts_cache(host_id text primary key,status text,updated_at timestamptz,zone text);
  create table reservations(id uuid primary key default gen_random_uuid(),telegram_id bigint,host_id text,duration_hours numeric,price numeric,status text default 'pending',created_at timestamptz default now());
  insert into profiles values(100,7),(101,8);insert into hosts_cache values('101','busy',now(),'100');`);
  for(const path of ['202609250006_club_desk_beta.sql','202609250007_club_sessions.sql','202609250008_strict_booking.sql','202609250009_auth_v2.sql'])await db.exec(await Deno.readTextFile('supabase/migrations/'+path));
  await db.exec('update club_settings set enabled=true,flow_version=2');const worker=crypto.randomUUID();await db.query('select club_worker_lease($1)',[worker]);await db.exec('update club_worker set protocol=2');
  for(const mode of ['arrival','scheduled','instant'])await fail(()=>db.query("select club_create_v2(100,'101',$1,'range',now()+interval '5 minutes',now()+interval '30 minutes',$2,false)",[mode,crypto.randomUUID()]));
  await db.exec("update hosts_cache set status='free'");
  const row=(await db.query<{id:string}>("select * from club_create_v2(100,'101','arrival','range',null,null,$1,false)",[crypto.randomUUID()])).rows[0];
  await db.query("update club_bookings set status='holding' where id=$1",[row.id]);
  await db.exec("update hosts_cache set status='busy'");
  check(!(await db.query<{v:boolean}>("select club_booking_action(100,$1,'enter') v",[row.id])).rows[0].v);
  await db.exec("update hosts_cache set status='reserved',updated_at=now()-interval '2 minutes'");
  check(!(await db.query<{v:boolean}>("select club_booking_action(100,$1,'enter') v",[row.id])).rows[0].v);
  await db.exec("update hosts_cache set updated_at=now()");
  check((await db.query<{v:boolean}>("select club_booking_action(100,$1,'enter') v",[row.id])).rows[0].v);
  await db.query("update club_bookings set status='attention',created_at=now()-interval '3 days' where id=$1",[row.id]);
  check(!(await db.query<{v:boolean}>('select club_cancel(101,$1) v',[row.id])).rows[0].v);
  check((await db.query<{v:boolean}>('select club_cancel(100,$1) v',[row.id])).rows[0].v);
  check((await db.query<{v:boolean}>('select club_cancel(100,$1) v',[row.id])).rows[0].v);
  const id=crypto.randomUUID();await db.query("select club_auth_enqueue($1,100,'encrypted')",[id]);
  await fail(()=>db.query("select club_auth_enqueue($1,100,'other')",[crypto.randomUUID()]));
  const claimed=(await db.query<{cipher:string}>('select * from club_auth_claim($1)',[worker])).rows;
  check(claimed.length===1&&claimed[0].cipher==='encrypted');check((await db.query('select * from club_auth_claim($1)',[crypto.randomUUID()])).rows.length===0);
  check((await db.query<{cipher:null}>('select cipher from club_auth_requests')).rows[0].cipher===null);
  await db.exec('set role anon');await fail(()=>db.query('select * from club_auth_requests'));await fail(()=>db.query('select club_auth_claim($1)',[worker]));
 }finally{await db.close()}
});
