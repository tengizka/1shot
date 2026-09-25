import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
Deno.test('economy RPC: ownership, leases, cache timestamp, auth privacy, role isolation',async()=>{
 const db=new PGlite(),worker=crypto.randomUUID();
 const check=(v:unknown)=>{if(!v)throw Error('assertion failed')};
 const fail=async(f:()=>Promise<unknown>)=>{try{await f()}catch{return}throw Error('expected rejection')};
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table profiles(telegram_id bigint primary key,gizmo_user_id integer,username text,first_name text,last_name text);
   create table hosts_cache(host_id text primary key,status text,updated_at timestamptz,zone text,gizmo_host_id integer);
   create table reservations(id uuid primary key default gen_random_uuid(),telegram_id bigint,host_id text,duration_hours numeric,price numeric,status text default 'pending',created_at timestamptz default now());
   insert into profiles values(100,7,'one','',''),(101,8,'two','','');`);
  for(const file of ['202609250006_club_desk_beta.sql','202609250007_club_sessions.sql','202609250008_strict_booking.sql','202609250009_auth_v2.sql','202609250010_arrival_time.sql','202609250011_economy_poll.sql'])await db.exec(await Deno.readTextFile('supabase/migrations/'+file));
  await db.exec('update club_settings set enabled=true,flow_version=2');
  const hosts=JSON.stringify([{host_id:'101',zone:'100',status:'free',gizmo_host_id:'50'}]);
  const poll=async(w=worker,h:string|null=hosts,accounts='[]')=>(await db.query<{v:any}>('select club_worker_poll($1,0,$2::jsonb,$3::jsonb) v',[w,h,accounts])).rows[0].v;
  const state=async(id=100)=>(await db.query<{v:any}>('select club_client_state($1) v',[id])).rows[0].v;
  check((await poll()).eco_version===1);await fail(()=>poll(crypto.randomUUID()));
  await state();await state(101);
  const observed=new Date(Date.now()-60000).toISOString();
  await poll(worker,hosts,JSON.stringify([{telegram_id:100,gizmo_user_id:7,observed_at:observed,data:{username:'changed',balance:42}}]));
  const own=await state();check(own.account.data.balance===42);check(Date.parse(own.account.updated_at)<Date.now()-55000);check((await state(101)).account.data===null);
  await poll(worker,hosts,JSON.stringify([{telegram_id:100,gizmo_user_id:8,observed_at:new Date().toISOString(),data:{balance:999}}]));check((await state()).account.data.balance===42);
  await db.query("select club_auth_enqueue($1,100,'test-only-encrypted')",[crypto.randomUUID()]);
  const snapshot=await poll();check(snapshot.auth_pending);check(!JSON.stringify(snapshot).includes('test-only-encrypted'));check(!JSON.stringify(await state()).includes('cipher'));
  await db.query("select club_command(100,'password_request','{}',$1)",[crypto.randomUUID()]);check((await state()).password_request.status==='awaiting_admin');check((await state(101)).password_request===null);
  const b=(await db.query<{id:string}>("select * from club_create_v2(100,'101','instant','range',null,null,$1,false)",[crypto.randomUUID()])).rows[0];
  check((await state()).bookings[0].id===b.id);check((await state(101)).bookings.length===0);check(!('code_hash' in (await poll()).bookings[0]));
  await db.exec("update hosts_cache set updated_at=now()-interval '1 minute'");await poll(worker,null);check(Date.parse((await state()).hosts[0].updated_at)<Date.now()-55000);
  await poll(worker,JSON.stringify([{host_id:'101',status:'free',zone:'100',gizmo_host_id:'50',updated_at:observed}]));check(Date.parse((await state()).hosts[0].updated_at)<Date.now()-55000);check(!('gizmo_host_id' in (await state()).hosts[0]));
  await fail(()=>poll(worker,JSON.stringify([{host_id:'101',status:'bad'}])));
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await fail(()=>state());await fail(()=>poll());await db.exec('reset role')}
 }finally{await db.close()}
});
