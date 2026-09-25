import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
Deno.test('club beta: opt-in, lease, idempotency, overlaps, two bookings, private/one-use codes, legacy cutoff',async()=>{
 const db=new PGlite();const check=(v:unknown)=>{if(!v)throw Error('assertion failed')};
 const fail=async(fn:()=>Promise<unknown>)=>{try{await fn()}catch{return}throw Error('expected rejection')};
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table profiles(telegram_id bigint primary key,gizmo_user_id integer);
 create table hosts_cache(host_id text primary key,status text,updated_at timestamptz,zone text);
 create table reservations(id uuid primary key default gen_random_uuid(),telegram_id bigint,host_id text,duration_hours numeric,price numeric,status text default 'pending',created_at timestamptz default now());
 insert into profiles values(100,7),(101,8),(102,9);insert into hosts_cache values('101','free',now(),'100'),('102','free',now(),'100'),('103','free',now(),'100'),('1','free',now(),'ps5');`);
 await db.exec(await Deno.readTextFile('supabase/migrations/202609250006_club_desk_beta.sql'));
 const worker=crypto.randomUUID(),worker2=crypto.randomUUID();
 const create=(user:number,host:string,id=crypto.randomUUID())=>db.query<{id:string;gizmo_user_id:number}>("select * from club_create_booking($1,$2,'arrival','hour',null,null,$3)",[user,host,id]);
 await fail(()=>create(100,'101'));await db.exec('update club_settings set enabled=true');await fail(()=>create(100,'101'));
 check((await db.query<{v:boolean}>('select club_worker_lease($1) v',[worker])).rows[0].v);
 check(!(await db.query<{v:boolean}>('select club_worker_lease($1) v',[worker2])).rows[0].v);
 const request=crypto.randomUUID();const row=(await create(100,'101',request)).rows[0];check(row.gizmo_user_id===7);check((await create(100,'101',request)).rows[0].id===row.id);
 await fail(()=>create(101,'101'));await fail(()=>create(101,'1'));await create(100,'102');await fail(()=>create(100,'103'));
 await fail(()=>db.query("select reserve_club_host(102,'103')"));
 check(!(await db.query<{v:boolean}>("select club_worker_transition($1,$2,'requested','holding','',null,null) v",[worker2,row.id])).rows[0].v);
 check((await db.query<{v:boolean}>("select club_worker_transition($1,$2,'requested','holding','','hash',now()+interval '3 minutes') v",[worker,row.id])).rows[0].v);
 const code=async(user:number,hash:string)=>(await db.query<{v:string}>('select club_checkin($1,$2,$3) v',[user,row.id,hash])).rows[0].v;
 check(await code(101,'hash')==='not_found');check(await code(100,'wrong')==='invalid_code');check(await code(100,'hash')==='checkin_pending');check(await code(100,'hash')==='checkin_pending');
 check((await db.query<{code_hash:string}>('select code_hash from club_bookings where id=$1',[row.id])).rows[0].code_hash===null);
 const second=(await db.query<{id:string}>("select id from club_bookings where host_id='102'")).rows[0];
 await db.query("select club_worker_transition($1,$2,'requested','holding','','hash',now()+interval '3 minutes')",[worker,second.id]);
 for(let i=0;i<5;i++)await db.query("select club_checkin(100,$1,'wrong')",[second.id]);
 check((await db.query<{v:string}>("select club_checkin(100,$1,'hash') v",[second.id])).rows[0].v==='too_many_attempts');
 await db.exec('set role anon');await fail(()=>db.query('select * from club_bookings'));await fail(()=>db.query('select club_worker_lease($1)',[worker]));
 }finally{await db.close()}
});
Deno.test('scheduled: today only, >=15 minutes, fixed hour, open end blocks later slots, active session not promised',async()=>{
 const db=new PGlite();const check=(v:unknown)=>{if(!v)throw Error('assertion failed')};
 const fail=async(fn:()=>Promise<unknown>)=>{try{await fn()}catch{return}throw Error('expected rejection')};
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create function test_now() returns timestamptz language sql as $$select '2026-09-25T12:00:00Z'::timestamptz$$;
 create table profiles(telegram_id bigint primary key,gizmo_user_id integer);
 create table hosts_cache(host_id text primary key,status text,updated_at timestamptz,zone text);
 create table reservations(id uuid primary key default gen_random_uuid(),telegram_id bigint,host_id text,duration_hours numeric,price numeric,status text default 'pending',created_at timestamptz default now());
 insert into profiles values(100,7),(101,8),(102,9);insert into hosts_cache values('101','busy',test_now(),'100'),('102','free',test_now(),'100');`);
 await db.exec((await Deno.readTextFile('supabase/migrations/202609250006_club_desk_beta.sql')).replaceAll('now()','test_now()'));
 await db.exec('update club_settings set enabled=true');await db.query('select club_worker_lease($1)',[crypto.randomUUID()]);
 const create=(user:number,host:string,kind:string,start:string,end:string|null=null)=>db.query<{id:string;starts_at:string;ends_at:string;hold_until:string}>("select * from club_create_booking($1,$2,'scheduled',$3,$4,$5,$6)",[user,host,kind,start,end,crypto.randomUUID()]);
 await fail(()=>create(100,'101','hour','2026-09-26T17:00:00+03:00'));
 await fail(()=>create(100,'101','hour','2026-09-25T14:00:00+03:00'));
 await fail(()=>create(100,'101','hour','2026-09-25T23:30:00+03:00'));
 await fail(()=>create(100,'101','range','2026-09-25T17:00:00+03:00','2026-09-25T17:10:00+03:00'));
 const a=(await create(100,'101','hour','2026-09-25T17:00:00+03:00')).rows[0];check(Date.parse(a.ends_at)-Date.parse(a.starts_at)===3600000);
 await fail(()=>create(101,'101','hour','2026-09-25T17:30:00+03:00'));
 const b=(await create(101,'101','open','2026-09-25T18:00:00+03:00')).rows[0];check(Date.parse(b.ends_at)===Date.parse('2026-09-26T00:00:00+03:00'));
 await fail(()=>create(102,'101','hour','2026-09-25T22:00:00+03:00'));
 await db.query("update club_bookings set status='in_session' where id=$1",[a.id]);
 await fail(()=>create(102,'101','hour','2026-09-25T15:00:01+03:00'));
 const c=(await create(100,'102','range','2026-09-25T16:00:00+03:00','2026-09-25T16:20:00+03:00')).rows[0];check(Date.parse(c.ends_at)===Date.parse(c.hold_until));
 }finally{await db.close()}
});
