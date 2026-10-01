// CI-only test on an isolated Docker database, never use with a club database.
import postgres from 'npm:postgres@3.4.7';
import {exportBundle,importBundle} from '../tools/transfer-core.ts';
if(Deno.env.get('CI_NATIVE_TRANSFER')!=='YES')throw Error('CI only');
const uri=Deno.env.get('LOCAL_ADMIN_DATABASE_URL')!;
const source=postgres(uri,{max:1,onnotice:()=>{}});
const targetURI=new URL(uri);targetURI.pathname='/oneshot_transfer_ci';
let target:ReturnType<typeof postgres>|undefined;
const assert=(value:unknown)=>{if(!value)throw Error('native transfer assertion failed');};
try{
 await source`update club_worker set lease_until=null`;
 const data=await source.begin(tx=>exportBundle(async(q,args=[])=>Array.from(await tx.unsafe(q,args as any[]))));
 await source.unsafe('create database oneshot_transfer_ci');
 target=postgres(targetURI.toString(),{max:1,onnotice:()=>{}});
 await target.unsafe((await Deno.readTextFile('sql/base.sql')).replace(/^create role .*;\n/gm,''));
 for(const n of ['006','007','008','009','010','011','012']){
  const file=(await Array.fromAsync(Deno.readDir('migrations'))).find(f=>f.name.startsWith('202609250'+n+'_'))!;
  await target.unsafe(await Deno.readTextFile('migrations/'+file.name));
 }
 await target.unsafe(await Deno.readTextFile('sql/final.sql'));
 await target.begin(tx=>importBundle(async(q,args=[])=>Array.from(await tx.unsafe(q,args as any[])),data));
 assert((await target`select username from profiles where telegram_id=123`)[0].username==='CI user');
 assert((await target`select status,updated_at from hosts_cache where host_id='101'`)[0].updated_at===null);
 assert((await target`select enabled from club_settings`)[0].enabled===false);
 console.log('Native PostgreSQL transfer: PASS');
}finally{if(target)await target.end();await source.end();}
