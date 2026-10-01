import postgres from 'npm:postgres@3.4.7';
import {configureDatabase} from './database.ts';
import {createHandler} from './http.ts';
const required=['DATABASE_URL','AGENT_SECRET','TELEGRAM_BOT_TOKEN','ALLOWED_ORIGINS'];
for(const key of required)if(!Deno.env.get(key))throw Error('Missing '+key);
if(Deno.env.get('AGENT_SECRET')!.length<24)throw Error('AGENT_SECRET must contain at least 24 characters');
const sql=postgres(Deno.env.get('DATABASE_URL')!,{max:8,connect_timeout:5,idle_timeout:20,connection:{application_name:'1shot-local',statement_timeout:10000},onnotice:()=>{}});
configureDatabase(async(q,args=[])=>Array.from(await sql.unsafe(q,args as any[])));
const ready=async()=>{try{return (await sql`select version from public.local_schema where version=1`).length===1;}catch{return false;}};
if(!await ready())throw Error('Local database schema not ready; do not connect Desk');
const web=new URL('../web/',import.meta.url);
const mime:Record<string,string>={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',webp:'image/webp',woff2:'font/woff2',ico:'image/x-icon'};
async function staticFile(path:string){
 if(path==='/backend-config.js')return new Response("window.CLUB_API_BASE='/api';",{headers:{'Content-Type':mime.js,'Cache-Control':'no-store'}});
 if(path==='/')path='/index.html';
 if(!/^\/[a-zA-Z0-9_./-]+$/.test(path)||path.includes('..')||path.includes('/.'))return new Response('Not found',{status:404});
 const type=mime[path.split('.').pop()||''];if(!type)return new Response('Not found',{status:404});
 try{return new Response(await Deno.readFile(new URL('.'+path,web)),{headers:{'Content-Type':type,'Cache-Control':'no-cache'}});}catch{return new Response('Not found',{status:404});}
}
const options={secret:Deno.env.get('AGENT_SECRET')!,origins:Deno.env.get('ALLOWED_ORIGINS')!.split(',').map(x=>x.trim()),ready};
const hostname=Deno.env.get('BIND_HOST')||'127.0.0.1';
const publicServer=Deno.serve({hostname,port:8080},createHandler({...options,privateAPI:false,staticFile}));
const privateServer=Deno.serve({hostname,port:8081},createHandler({...options,privateAPI:true}));
Deno.addSignalListener('SIGTERM',async()=>{await Promise.all([publicServer.shutdown(),privateServer.shutdown()]);await sql.end();});
