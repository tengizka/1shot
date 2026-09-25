import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
Deno.test('actual screenshot schema: free one-hour holds, limit, occupied host, expiry',async()=>{
 const db=new PGlite();
 const check=(ok:unknown)=>{if(!ok)throw Error('assertion failed');};
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table hosts_cache(host_id text primary key,status text,updated_at timestamptz,zone text);
   create table reservations(id uuid primary key default gen_random_uuid(),telegram_id bigint not null,
    host_id text not null,duration_hours numeric not null,price numeric not null,status text not null default 'pending',
    gizmo_reservation_id text,error_message text,created_at timestamptz not null default now());
   insert into hosts_cache values('101','free',now(),'100'),('102','free',now(),'100'),('103','free',now(),'100'),('1','free',now(),'ps5'),('console','free',now(),'ps5');`);
  await db.exec(await Deno.readTextFile('supabase/migrations/202609250003_reserve_existing_schema.sql'));
  const reserve=(user:number,host:string)=>db.query<{price:number;duration_hours:number}>('select * from reserve_club_host($1,$2)',[user,host]);
  const fails=async(fn:()=>Promise<unknown>)=>{try{await fn();}catch{return;}throw Error('expected rejection');};
  const result=await reserve(123,'101');
  check(Number(result.rows[0].price)===0);check(Number(result.rows[0].duration_hours)===1);
  await fails(()=>reserve(456,'101'));
  await reserve(123,'102');
  await fails(()=>reserve(123,'103'));
  await db.exec("update reservations set created_at=now()-interval '2 hours'");
  await reserve(123,'103');
  await db.exec(await Deno.readTextFile('supabase/migrations/202609250005_ps5_phone_only.sql'));
  await fails(()=>reserve(999,'1'));
  await fails(()=>reserve(999,'console'));
  await fails(()=>db.exec("insert into reservations(telegram_id,host_id,duration_hours,price) values(999,'1',1,0)"));
  await fails(()=>db.exec("update reservations set host_id='1' where host_id='103'"));
  await db.exec("update reservations set status='confirmed' where host_id='103'");
 }finally{await db.close();}
});
