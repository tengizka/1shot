import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
const assert=(v:unknown,message='assertion failed')=>{if(!v)throw Error(message)};
Deno.test('reconciliation requires fresh own login, matching UID and confirmation; no profile overwrite; atomic proof consumption',async()=>{
 const pg=new PGlite();const worker=crypto.randomUUID(),id=crypto.randomUUID(),proof=crypto.randomUUID();
 try{
  await pg.exec(await Deno.readTextFile('server/sql/base.sql'));
  for(const f of (await Array.fromAsync(Deno.readDir('supabase/migrations'))).map(x=>x.name).sort().filter(x=>/2026092500(06|07|08|09|10|11|12)_|2026100800(14|15)_/.test(x)))await pg.exec(await Deno.readTextFile('supabase/migrations/'+f));
  await pg.query('select club_worker_poll($1)',[worker]);
  await pg.query("insert into club_registration_requests(id,telegram_id,status,public_data,gizmo_user_id,updated_at) values($1,100,'attention','{\"username\":\"guest\"}',7,now()-interval '1 minute')",[id]);
  const review=async()=> (await pg.query<any>('select club_registration_review($1,$2) as r',[worker,id])).rows[0].r;
  const finish=async(p=proof,uid=7,confirmed=true,w=worker)=> (await pg.query<any>('select club_registration_reconcile($1,$2,$3,$4,$5) as ok',[w,id,p,uid,confirmed])).rows[0].ok;
  const rejects=async(fn:()=>Promise<unknown>)=>{let rejected=false;try{await fn()}catch{rejected=true}assert(rejected)};
  assert((await review()).proof===null,'no password knowledge from phone number');
  await pg.query("insert into profiles(telegram_id,gizmo_user_id,username) values(100,7,'guest')");
  await pg.query("insert into club_auth_requests(id,telegram_id,gizmo_user_id,status,purpose) values($1,101,7,'done','login')",[proof]);
  assert((await review()).proof===null,'other Telegram is not proof');await rejects(()=>finish());
  await pg.query("update club_auth_requests set telegram_id=100,purpose='legacy' where id=$1",[proof]);assert((await review()).proof===null,'old auth is not proof');
  await pg.query("update club_auth_requests set purpose='login',status='running' where id=$1",[proof]);assert((await review()).proof===null,'pending login is not proof');
  await pg.query("update club_auth_requests set status='done',created_at=now()-interval '11 minutes' where id=$1",[proof]);await rejects(()=>finish());assert((await review()).proof===null,'expired login');
  await pg.query("update club_auth_requests set created_at=now()-interval '2 minutes' where id=$1",[proof]);await rejects(()=>finish());assert((await review()).proof===null,'login must follow attention');
  await pg.query('update club_auth_requests set created_at=now() where id=$1',[proof]);assert((await review()).proof.id===proof);
  await rejects(()=>finish(proof,8));await rejects(()=>finish(proof,7,false));await rejects(()=>finish(proof,7,true,crypto.randomUUID()));
  await pg.query('update profiles set gizmo_user_id=8 where telegram_id=100');await rejects(()=>finish());assert((await review()).proof===null,'concurrent login link mismatch');
  await pg.query('update profiles set gizmo_user_id=7 where telegram_id=100');assert(await finish());assert(await finish(),'same completion idempotent');
  assert((await pg.query<any>('select count(*) as n from club_registration_reconciliations')).rows[0].n===1);
  assert((await pg.query<any>('select status,cipher,public_data from club_registration_requests where id=$1',[id])).rows[0].status==='done');
  assert((await pg.query<any>('select username,gizmo_user_id from profiles where telegram_id=100')).rows[0].username==='guest','existing profile not overwritten');
  const next=crypto.randomUUID();await pg.query("insert into club_registration_requests(id,telegram_id,status,public_data,updated_at) values($1,100,'attention','{}',now()-interval '2 minutes')",[next]);
  await rejects(()=>pg.query('select club_registration_reconcile($1,$2,$3,7,true)',[worker,next,proof]));
  assert((await pg.query<any>('select status from club_registration_requests where id=$1',[next])).rows[0].status==='attention','used proof cannot partially complete');
  await pg.exec('set role anon');await rejects(()=>pg.query('select club_registration_review($1,$2)',[worker,next]));await rejects(()=>pg.query('select * from club_registration_reconciliations'));
 }finally{await pg.close()}
});
