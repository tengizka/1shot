import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
import {createHmac} from 'node:crypto';
import {configureDatabase,db} from '../database.ts';
import {createHandler,MAX_BODY} from '../http.ts';
const assert=(v:unknown,message='assertion failed')=>{if(!v)throw Error(message);};
Deno.test('standalone DB and HTTP: leases, anonymous bookings, login, privacy, auth and restart-safe requests',async()=>{
 const pg=new PGlite();
 Deno.env.set('AGENT_SECRET','test-only-long-local-secret');Deno.env.set('TELEGRAM_BOT_TOKEN','123:test-only-token');
 try{
  await pg.exec(await Deno.readTextFile('server/sql/base.sql'));
  for(const file of (await Array.fromAsync(Deno.readDir('supabase/migrations'))).map(x=>x.name).sort().filter(x=>/2026092500(06|07|08|09|10|11|12)_/.test(x)))await pg.exec(await Deno.readTextFile('supabase/migrations/'+file));
  await pg.exec(await Deno.readTextFile('server/sql/final.sql'));
  await pg.exec("update club_settings set enabled=true,flow_version=2; set role service_role");
  configureDatabase(async(q,args)=>(await pg.query(q,args)).rows as any[]);
  const options={secret:Deno.env.get('AGENT_SECRET')!,origins:['https://api.example.test'],ready:async()=>true};
  const pub=createHandler({...options,privateAPI:false}),priv=createHandler({...options,privateAPI:true});
  async function call(endpoint:string,body:unknown,staff=false,extra:Record<string,string>={}){
   const r=await (staff?priv:pub)(new Request('http://test/api/'+endpoint,{method:'POST',headers:{'content-type':'application/json',...(staff?{'x-agent-secret':options.secret}:{}),...extra},body:JSON.stringify(body)}));
   return {status:r.status,data:await r.json()};
  }
  let availability=await call('club-bookings',{action:'capabilities'});
  assert(availability.status===200&&!availability.data.desk.online&&availability.data.desk.valid_for_ms===0,'no worker means offline');
  const worker=crypto.randomUUID(),other=crypto.randomUUID();
  const host={host_id:'101',zone:'100',status:'free',gizmo_host_id:50,updated_at:new Date().toISOString()};
  let response=await call('club-agent',{action:'snapshot',eco:1,worker_id:worker,hosts:[host]},true);
  assert(response.status===200&&response.data.eco_version===1,JSON.stringify(response));
  availability=await call('club-bookings',{action:'capabilities'});
  assert(availability.data.desk.online&&availability.data.desk.valid_for_ms>0&&availability.data.desk.valid_for_ms<=30000,'bounded online lease');
  assert(Object.keys(availability.data.desk).sort().join(',')==='online,valid_for_ms','no worker IDs');
  await pg.exec("reset role; update club_worker set lease_until=now()-interval '1 second'; set role service_role");
  assert(!(await call('club-bookings',{action:'capabilities'})).data.desk.online,'expired lease');
  await call('club-agent',{action:'snapshot',eco:1,worker_id:worker},true);
  assert((await call('club-agent',{action:'snapshot',eco:1,worker_id:other},true)).status!==200,'lease conflict');
  assert((await call('club-agent',{action:'snapshot',eco:1,worker_id:worker},false,{'x-agent-secret':options.secret})).status===404,'public cannot reach agent even with secret');
  assert((await call('club-auth',{action:'claim',worker_id:worker},false,{'x-agent-secret':options.secret})).status===403);
  assert((await call('club-desk',{},true,{'x-agent-secret':'wrong'})).status===403);
  assert((await call('club-bookings',{action:'state',initData:''})).status===403);
  assert((await call('club-bookings',{action:'capabilities'},false,{origin:'https://evil.test'})).status===403);
  assert((await call('club-bookings',{padding:'x'.repeat(MAX_BODY)})).status===413);
  assert((await pub(new Request('http://test/.env'))).status===404);
  assert((await call('upsert-profile',{telegram_id:100,gizmo_user_id:7,username:'guest'},true)).data.ok);
  assert((await call('upsert-profile',{telegram_id:101,gizmo_user_id:8,username:'another'},true)).data.ok);
  const start=new Date(Math.ceil((Date.now()+900000)/300000)*300000).toISOString(),id=crypto.randomUUID();
  const args={action:'admin_booking',mode:'reserve',worker_id:worker,host_id:'101',starts_at:start,request_id:id};
  response=await call('club-desk',args,true);assert(response.status===200,JSON.stringify(response));const booking=response.data.booking_id;
  assert((await call('club-desk',args,true)).data.booking_id===booking,'idempotency');
  assert((await call('club-desk',{...args,request_id:crypto.randomUUID()},true)).status===409,'overlap');
  const token=Deno.env.get('TELEGRAM_BOT_TOKEN')!;
  function signed(user:number){const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:user,first_name:'Test'})});const check=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');const key=createHmac('sha256','WebAppData').update(token).digest();p.set('hash',createHmac('sha256',key).update(check).digest('hex'));return p.toString();}
  const state=await call('club-bookings',{action:'state',initData:signed(100)});assert(state.status===200,JSON.stringify(state));assert(state.data.bookings.length===0,'manual reservation stays private');assert(state.data.desk.online,'bundled heartbeat');
  response=await call('club-auth',{action:'login',username:'guest',password:'test-pass',initData:signed(100)});assert(response.status===200,JSON.stringify(response));
  const claim=await call('club-auth',{action:'claim',worker_id:worker},true);assert(claim.data.requests.length===1&&claim.data.requests[0].cipher,'setof RPC');
  assert((await call('club-auth',{action:'finish',worker_id:worker,id:response.data.request_id,status:'done',gizmo_user_id:7},true)).data.ok);
  assert((await call('club-auth',{action:'status',request_id:response.data.request_id,initData:signed(100)})).data.profile.username==='guest');
  assert((await call('club-auth',{action:'status',request_id:response.data.request_id,initData:signed(101)})).status!==200,'auth ownership');
  assert((await db().from('profiles').update({first_name:"O'Brien"}).eq('telegram_id',100).select('first_name')).data[0].first_name==="O'Brien");
  assert((await db().rpc('pg_sleep',{})).error,'RPC whitelist');
  let rejected=false;try{db().from('profiles;drop table profiles');}catch{rejected=true;}assert(rejected);
  assert((await call('club-desk',{action:'cancel',worker_id:worker,id:booking},true)).data.ok);
  assert((await call('club-agent',{action:'snapshot',eco:1,worker_id:worker},true)).data.bookings[0].status==='cancel_requested');
  // Parameterized JSON update, multiple filters, in(), select() and status privacy.
  await db().from('club_accounts').update({data:{balance:12},updated_at:new Date().toISOString()}).eq('telegram_id',100);
 }finally{await pg.close();}
});
Deno.test('local safety handlers stay synchronized with existing tested cloud protocol',async()=>{
 for(const name of ['club-agent','club-auth','club-bookings','club-desk']){
  let expected=await Deno.readTextFile(`supabase/functions/${name}/index.ts`);
  expected=expected.replace("'../_shared/club.ts'","'../shared.ts'").replace('Deno.serve(async req=>{','export default async function handler(req: Request){');expected=expected.slice(0,-4)+'}\n';
  const actual=(await Deno.readTextFile(`server/routes/${name}.ts`)).split('\n').slice(1).join('\n');assert(actual===expected,name+' drifted');
 }
});
