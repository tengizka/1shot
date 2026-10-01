import {timingSafeEqual} from 'node:crypto';
import agent from './routes/club-agent.ts';
import auth from './routes/club-auth.ts';
import bookings from './routes/club-bookings.ts';
import desk from './routes/club-desk.ts';
import {hosts,profile} from './routes/support.ts';
import {json} from './shared.ts';
export const MAX_BODY=64*1024;
export function createHandler(options:{privateAPI:boolean,secret:string,origins:string[],ready:()=>Promise<boolean>,staticFile?:(path:string)=>Promise<Response>}){
 const buckets=new Map<string,{count:number,until:number}>();
 return async (req:Request):Promise<Response>=>{
  const origin=req.headers.get('origin');
  const finish=(response:Response)=>{const h=new Headers(response.headers);h.delete('Access-Control-Allow-Origin');if(origin&&options.origins.includes(origin))h.set('Access-Control-Allow-Origin',origin);h.set('Vary','Origin');h.set('X-Content-Type-Options','nosniff');h.set('Referrer-Policy','no-referrer');return new Response(response.body,{status:response.status,headers:h});};
  try{
   if(origin&&!options.origins.includes(origin))return finish(json({error:'origin_not_allowed'},403));
   const path=new URL(req.url).pathname;
   if(path==='/healthz'&&req.method==='GET'){const ok=await options.ready();return finish(json({ok,backend:'local'},ok?200:503));}
   if(!path.startsWith('/api/'))return finish(!options.privateAPI&&options.staticFile?await options.staticFile(path):json({error:'not_found'},404));
   if(req.method==='OPTIONS')return finish(json({ok:true}));
   const endpoint=path.slice(5);
   if(!['club-agent','club-auth','club-bookings','club-desk','hosts','upsert-profile'].includes(endpoint))return finish(json({error:'not_found'},404));
   if(!options.privateAPI&&['club-agent','club-desk','upsert-profile'].includes(endpoint))return finish(json({error:'not_found'},404));
   if(options.privateAPI){
    const supplied=new TextEncoder().encode(req.headers.get('x-agent-secret')||''),expected=new TextEncoder().encode(options.secret);
    if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return finish(json({error:'unauthorized'},403));
   }
   // Bounded memory and global fallback protect the local process. CF header is only
   // trusted behind our loopback-published tunnel port; it never grants permissions.
   const now=Date.now();for(const [k,v] of buckets)if(v.until<=now)buckets.delete(k);
   const key=options.privateAPI?'desk':(req.headers.get('cf-connecting-ip')||'direct').slice(0,64);
   if(!buckets.has(key)&&buckets.size>=4096)return finish(json({error:'busy'},429));
   const bucket=buckets.get(key)||{count:0,until:now+60000};buckets.set(key,bucket);
   if(++bucket.count>(options.privateAPI?600:180))return finish(json({error:'rate_limited'},429));
   if(endpoint==='hosts')return finish(req.method==='GET'?await hosts():json({error:'method_not_allowed'},405));
   if(req.method!=='POST')return finish(json({error:'method_not_allowed'},405));
   if(!req.headers.get('content-type')?.startsWith('application/json'))return finish(json({error:'json_required'},415));
   if(Number(req.headers.get('content-length'))>MAX_BODY)return finish(json({error:'body_too_large'},413));
   const reader=req.body?.getReader();if(!reader)return finish(json({error:'invalid_json'},400));
   const chunks:Uint8Array[]=[];let size=0;const timeout=setTimeout(()=>{void reader.cancel();},10000);
   try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BODY){await reader.cancel();return finish(json({error:'body_too_large'},413));}chunks.push(value);}}finally{clearTimeout(timeout);}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return finish(json({error:'invalid_json'},400));}
   if(!body||typeof body!=='object'||Array.isArray(body))return finish(json({error:'invalid_json'},400));
   if(!options.privateAPI&&endpoint==='club-auth'&&['claim','finish'].includes(body.action))return finish(json({error:'forbidden'},403));
   // Legacy snapshots use a removed nested REST projection: explicitly fail closed.
   if(endpoint==='club-agent'&&body.action==='snapshot'&&body.eco!==1)return finish(json({error:'update_desk'},409));
   const forwarded=new Request(req.url,{method:'POST',headers:req.headers,body:JSON.stringify(body)});
   const handlers:Record<string,(r:Request)=>Promise<Response>>={'club-agent':agent,'club-auth':auth,'club-bookings':bookings,'club-desk':desk,'upsert-profile':profile};
   return finish(await handlers[endpoint](forwarded));
  }catch{return finish(json({error:'local_service_unavailable'},503));}
 };
}
