/** Run locally as an operator, never expose these operations as HTTP endpoints. */
import postgres from 'npm:postgres@3.4.7';
import {exportBundle,importBundle,type Bundle} from './transfer-core.ts';
const [action,file]=Deno.args;
if(!['export','import'].includes(action)||!file)throw Error('Usage: transfer.ts export|import /backup/file.json');
const url=Deno.env.get(action==='export'?'SOURCE_DATABASE_URL':'LOCAL_ADMIN_DATABASE_URL');
if(!url)throw Error('Set the appropriate database URL locally, never in chat');
if(action==='import'&&Deno.env.get('CONFIRM_LOCAL_IMPORT')!=='YES')throw Error('Import is only for a fresh local database; set CONFIRM_LOCAL_IMPORT=YES');
const sql=postgres(url,{max:1,connect_timeout:10,onnotice:()=>{}});
const hash=async(data:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(data)))).map(x=>x.toString(16).padStart(2,'0')).join('');
try{
 if(action==='export'){
  const bundle=await sql.begin(async tx=>{await tx.unsafe('set transaction isolation level repeatable read, read only');return await exportBundle(async(q,args=[])=>Array.from(await tx.unsafe(q,args as any[])));});
  const data=new TextEncoder().encode(JSON.stringify(bundle));
  await Deno.writeFile(file,data,{createNew:true,mode:0o600});
  await Deno.writeTextFile(file+'.sha256',await hash(data),{createNew:true,mode:0o600});
  console.log('Export complete. Store this personal-data backup securely; do not upload it to Git or chat.');
 }else{
  const data=await Deno.readFile(file);if(await hash(data)!==(await Deno.readTextFile(file+'.sha256')).trim())throw Error('Backup checksum mismatch');
  const bundle=JSON.parse(new TextDecoder().decode(data)) as Bundle;
  const warnings=await sql.begin(async tx=>await importBundle(async(q,args=[])=>Array.from(await tx.unsafe(q,args as any[])),bundle));
  for(const warning of warnings)console.log(warning);
  console.log('Import complete and row counts verified. Bookings disabled until explicit cutover.');
 }
}catch{console.error('Transfer failed. No import transaction was committed. Check connection, empty target, source readiness and backup checksum locally.');Deno.exitCode=1;}finally{await sql.end();}
