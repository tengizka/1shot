import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
Deno.test('v2 lifecycle: gated rollout, ownership, no-code entry, friend release, account permissions, lease downgrade',async()=>{
 const db=new PGlite();const check=(v:unknown)=>{if(!v)throw Error('assertion failed')};const fail=async(fn:()=>Promise<unknown>)=>{try{await fn()}catch{return}throw Error('expected rejection')};
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
  create table profiles(telegram_id bigint primary key,gizmo_user_id integer);
  create table hosts_cache(host_id text primary key,status text,updated_at timestamptz,zone text);
  create table reservations(id uuid primary key default gen_random_uuid(),telegram_id bigint,host_id text,duration_hours numeric,price numeric,status text default 'pending',created_at timestamptz default now());
  insert into profiles values(100,7),(101,8);insert into hosts_cache values('101','free',now(),'100'),('102','free',now(),'100');`);
  await db.exec(await Deno.readTextFile('supabase/migrations/202609250006_club_desk_beta.sql'));
  await db.exec(await Deno.readTextFile('supabase/migrations/202609250007_club_sessions.sql'));
  await db.exec('update club_settings set enabled=true');const worker=crypto.randomUUID();await db.query('select club_worker_lease($1)',[worker]);
  const create=(host:string,mode:string,friend=false)=>db.query<{id:string;protocol:number;instant:boolean}>("select * from club_create_v2(100,$1,$2,'hour',null,null,$3,$4)",[host,mode,crypto.randomUUID(),friend]);
  await fail(()=>create('101','instant'));await db.exec('update club_settings set flow_version=2');await fail(()=>create('101','instant'));
  await db.exec('update club_worker set protocol=2');
  const a=(await create('101','instant')).rows[0];check(a.protocol===2&&a.instant);
  await db.query("select club_worker_transition($1,$2,'requested','holding','',null,null)",[worker,a.id]);
  const action=async(user:number,id:string,what:string)=>(await db.query<{v:boolean}>('select club_booking_action($1,$2,$3) v',[user,id,what])).rows[0].v;
  check(!await action(101,a.id,'enter'));check(!await action(100,a.id,'release'));check(await action(100,a.id,'enter'));
  const b=(await create('102','arrival',true)).rows[0];await db.query("select club_worker_transition($1,$2,'requested','holding','',null,null)",[worker,b.id]);
  check(!await action(100,b.id,'enter'));check(await action(100,b.id,'release'));
  await db.query('select club_account_request(100)');
  const cmd=(kind:string,payload:unknown,req=crypto.randomUUID())=>db.query<{id:string}>('select club_command(100,$1,$2,$3) id',[kind,JSON.stringify(payload),req]);
  await fail(()=>cmd('profile_edit',{birthDate:'1999-01-01'}));await fail(()=>cmd('logout',{session_key:'made-up'}));
  const req=crypto.randomUUID();const c=(await cmd('profile_edit',{username:'new_name'},req)).rows[0].id;check((await cmd('profile_edit',{username:'different'},req)).rows[0].id===c);
  await fail(()=>cmd('profile_edit',{username:'another_name'}));
  await cmd('password_request',{});await db.exec("update club_commands set status='done'");
  await db.exec(`update club_accounts set updated_at=now(),data='{"session":{"key":"actual-session","user_id":7,"gizmo_host_id":50}}'`);
  await cmd('logout',{session_key:'actual-session',gizmo_user_id:999});
  const payload=(await db.query<{payload:{user_id:number}}>("select payload from club_commands where kind='logout'")).rows[0].payload;check(payload.user_id===7);
  await db.exec("update club_worker set lease_until=now()-interval '1 second'");await db.query('select club_worker_lease($1)',[crypto.randomUUID()]);
  check((await db.query<{protocol:number}>('select protocol from club_worker')).rows[0].protocol===1);
  await db.exec('set role anon');await fail(()=>db.query('select * from club_accounts'));await fail(()=>db.query('select club_account_request(100)'));
 }finally{await db.close()}
});
