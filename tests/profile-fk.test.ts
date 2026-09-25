import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';
const migration = await Deno.readTextFile('supabase/migrations/202609250004_reservations_profile_fk.sql');
const setup = async () => {
 const db = new PGlite();
 await db.exec(`create table profiles(telegram_id bigint primary key,gizmo_user_id bigint);
 create table users_map(telegram_id bigint primary key);
 create table reservations(id int primary key,telegram_id bigint not null,
 constraint reservations_telegram_id_fkey foreign key(telegram_id) references users_map(telegram_id));
 insert into users_map values(1);insert into reservations values(1,1);`);
 return db;
};
Deno.test('FK migrates without losing old rows; profile-only user can book',async()=>{
 const db=await setup();
 try{
  await db.exec('insert into profiles values(1,101),(2,102);');
  await db.exec(migration);
  await db.exec('insert into reservations values(2,2);');
  const {rows}=await db.query<{count:number}>('select count(*)::int as count from reservations');
  if(rows[0].count!==2)throw Error('lost rows');
  let rejected=false;
  try{await db.exec('insert into reservations values(3,3);');}catch{rejected=true;}
  if(!rejected)throw Error('unregistered user allowed');
 }finally{await db.close();}
});
Deno.test('orphan profile aborts migration and preserves original FK and data',async()=>{
 const db=await setup();
 try{
  let rejected=false;
  try{await db.exec(migration);}catch{rejected=true;await db.exec('rollback;');}
  if(!rejected)throw Error('migration should stop');
  const {rows}=await db.query<{definition:string}>("select pg_get_constraintdef(oid) as definition from pg_constraint where conname='reservations_telegram_id_fkey'");
  if(!rows[0].definition.includes('users_map'))throw Error('original FK lost');
  const count=await db.query<{count:number}>('select count(*)::int as count from reservations');
  if(count.rows[0].count!==1)throw Error('data lost');
 }finally{await db.close();}
});
