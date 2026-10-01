import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
import {exportBundle,importBundle} from '../tools/transfer-core.ts';
const assert=(v:unknown)=>{if(!v)throw Error('assertion failed');};
async function database(){const pg=new PGlite();await pg.exec(await Deno.readTextFile('server/sql/base.sql'));for(const file of (await Array.fromAsync(Deno.readDir('supabase/migrations'))).map(x=>x.name).sort().filter(x=>/2026092500(06|07|08|09|10|11|12)_/.test(x)))await pg.exec(await Deno.readTextFile('supabase/migrations/'+file));await pg.exec(await Deno.readTextFile('server/sql/final.sql'));return pg;}
Deno.test('offline transfer preserves account links, bookings/events and safety; refuses overwrites and in-flight writes',async()=>{
 const source=await database(),target=await database();
 const run=(pg:PGlite)=>async(q:string,args:unknown[]=[])=> (await pg.query(q,args)).rows as any[];
 try{
  await source.exec("insert into profiles(telegram_id,gizmo_user_id,username) values(123,7,'O''Brien');insert into hosts_cache values('101','100','free',50,now());update club_settings set enabled=true;");
  const id=crypto.randomUUID();await source.query("insert into club_bookings(id,telegram_id,gizmo_user_id,host_id,mode,duration_kind,starts_at,ends_at,hold_until,client_request_id) values($1,123,7,'101','scheduled','range',now(),now()+interval '30 minutes',now()+interval '30 minutes',$2)",[id,crypto.randomUUID()]);
  await source.query("insert into club_events(booking_id,kind) values($1,'created')",[id]);
  const bundle=await exportBundle(run(source));await target.exec('begin');await importBundle(run(target),bundle);await target.exec('commit');
  assert((await target.query<any>('select username from profiles')).rows[0].username==="O'Brien");
  assert((await target.query<any>('select id from club_bookings')).rows[0].id===id);
  assert((await target.query<any>('select enabled from club_settings')).rows[0].enabled===false);
  assert((await target.query<any>('select updated_at from hosts_cache')).rows[0].updated_at===null);
  const event=await target.query<any>("insert into club_events(booking_id,kind) values($1,'next') returning id",[id]);assert(Number(event.rows[0].id)===2);
  let refused=false;try{await importBundle(run(target),bundle);}catch{refused=true;}assert(refused);
  await source.exec("update club_worker set lease_until=now()+interval '1 minute'");refused=false;try{await exportBundle(run(source));}catch{refused=true;}assert(refused);
  await source.exec("update club_worker set lease_until=null;insert into club_auth_requests(id,telegram_id,cipher) values(gen_random_uuid(),123,'encrypted')");refused=false;try{await exportBundle(run(source));}catch{refused=true;}assert(refused);
 }finally{await source.close();await target.close();}
});
