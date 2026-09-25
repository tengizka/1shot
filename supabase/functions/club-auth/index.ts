import {cors,json,db,verify} from '../_shared/club.ts';
import {createHash,createCipheriv,randomBytes} from 'node:crypto';
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return json({error:'method_not_allowed'},405);
 try{
  const b=await req.json(),client=db();
  if(['claim','finish'].includes(b.action)){
   const secret=Deno.env.get('AGENT_SECRET');
   if(!secret||req.headers.get('x-agent-secret')!==secret)return json({error:'Unauthorized'},403);
   if(typeof b.worker_id!=='string')return json({error:'worker_required'},400);
   if(b.action==='claim'){
    const {data,error}=await client.rpc('club_auth_claim',{p_worker:b.worker_id});if(error)throw error;return json({requests:data});
   }
   if(!['done','failed','invalid_credentials','username_taken'].includes(b.status))return json({error:'invalid_status'},400);
   // Successful authentication is written to profiles by the trusted Desk only.
   const {error}=await client.from('club_auth_requests').update({status:b.status,gizmo_user_id:b.gizmo_user_id||null,cipher:null}).eq('id',b.id).eq('worker_id',b.worker_id).eq('status','running');if(error)throw error;return json({ok:true});
  }
  let user:number;try{user=verify(b.initData,Deno.env.get('TELEGRAM_BOT_TOKEN')||'')}catch{return json({error:'Откройте приложение заново через Telegram'},403)}
  if(b.action==='status'){
   const {data,error}=await client.from('club_auth_requests').select('status,created_at,gizmo_user_id').eq('id',b.request_id).eq('telegram_id',user).single();if(error)throw error;
   if(['pending','running'].includes(data.status)&&Date.now()-Date.parse(data.created_at)>180000)return json({status:'failed'});
   if(data.status!=='done')return json({status:data.status==='running'?'pending':data.status});
   const {data:profile,error:pe}=await client.from('profiles').select('telegram_id,gizmo_user_id,username,first_name,last_name').eq('telegram_id',user).eq('gizmo_user_id',data.gizmo_user_id).single();if(pe)throw pe;
   return json({status:'done',profile});
  }
  if(!['login','register'].includes(b.action))return json({error:'invalid_action'},400);
  if(typeof b.username!=='string'||!b.username.trim()||b.username.length>254||typeof b.password!=='string'||b.password.length<(b.action==='register'?6:1)||b.password.length>64)return json({error:'Заполните никнейм / телефон и пароль (6–64 символа)'},400);
  const payload:Record<string,unknown>={action:b.action,username:b.username.trim(),password:b.password};
  if(b.action==='register'){
   if(!/^[\p{L}\p{N}_.-]{3,30}$/u.test(b.username)||!['first_name','last_name'].every(k=>typeof b[k]==='string'&&b[k].trim()&&b[k].length<=45)||typeof b.mobile_phone!=='string'||!/^\+?[0-9 ()-]{7,20}$/.test(b.mobile_phone)||![1,2].includes(b.sex)||typeof b.birth_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.birth_date))return json({error:'Заполните все поля регистрации корректно'},400);
   const birth=new Date(b.birth_date+'T00:00:00Z');if(!Number.isFinite(birth.getTime())||birth.toISOString().slice(0,10)!==b.birth_date||birth.getTime()>Date.now()||Date.now()-birth.getTime()>111*366*86400000)return json({error:'Проверьте дату рождения'},400);
   for(const key of ['first_name','last_name','mobile_phone','sex','birth_date'])payload[key]=b[key];
  }
  const secret=Deno.env.get('AGENT_SECRET');if(!secret)throw Error('not_configured');
  const id=crypto.randomUUID(),iv=randomBytes(12),key=createHash('sha256').update('1shot-auth-v2:'+secret).digest();
  const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(new TextEncoder().encode(id));
  const encrypted=cipher.update(JSON.stringify(payload),'utf8');const tail=cipher.final();
  const bytes=new Uint8Array([...iv,...encrypted,...tail,...cipher.getAuthTag()]);
  const encoded=btoa(String.fromCharCode(...bytes));
  const {error}=await client.rpc('club_auth_enqueue',{p_id:id,p_user:user,p_cipher:encoded});if(error)throw error;
  return json({request_id:id});
 }catch(e){const error=e as {code?:string,message?:string};return json({error:error.code==='P0001'?error.message:'Обновлённый сервис входа недоступен. Обратитесь в клуб'},error.code==='P0001'?429:503)}
});
