import {cors,json,db,codeHash} from '../_shared/club.ts';
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return json({error:'method_not_allowed'},405);
 const secret=Deno.env.get('AGENT_SECRET');
 if(!secret||req.headers.get('x-agent-secret')!==secret)return json({error:'Unauthorized'},403);
 try{
  const b=await req.json();const client=db();
  const {data:leased,error:leaseError}=await client.rpc('club_worker_lease',{p_worker:b.worker_id});
  if(leaseError)throw leaseError;if(!leased)return json({error:'Другой экземпляр панели уже управляет клубом'},409);
  if(b.action==='snapshot'){
   const {data:bookings,error}=await client.from('club_bookings').select('*').not('status','in','(cancelled,expired,completed)').order('starts_at');if(error)throw error;
   const {data:events,error:eventError}=await client.from('club_events').select('*,club_bookings(instant)').gt('id',Number(b.after_event)||0).order('id').limit(200);if(eventError)throw eventError;
   const ids=[...new Set((bookings||[]).map((x:{telegram_id:number})=>x.telegram_id))];
   const {data:profiles,error:profileError}=ids.length?await client.from('profiles').select('telegram_id,username').in('telegram_id',ids):{data:[],error:null};if(profileError)throw profileError;
   const names=new Map((profiles||[]).map((p:{telegram_id:number;username:string})=>[String(p.telegram_id),p.username]));
   return json({bookings:(bookings||[]).map((r:{telegram_id:number;code_hash?:string})=>({...r,username:names.get(String(r.telegram_id))||'Гость',code_hash:undefined})),events:(events||[]).map((e:{club_bookings?:{instant?:boolean}})=>({...e,instant:!!e.club_bookings?.instant,club_bookings:undefined})),lease_seconds:30});
  }
  if(b.action==='transition'){
   let hash=null,expiry=null;
   if(b.code!==undefined){if(!/^\d{6}$/.test(b.code))return json({error:'bad_code'},400);hash=await codeHash(b.id,b.code);expiry=new Date(Date.now()+180000).toISOString();}
   const {data,error}=await client.rpc('club_worker_transition',{p_worker:b.worker_id,p_id:b.id,p_from:b.from,p_to:b.to,p_message:b.message||'',p_hash:hash,p_code_expiry:expiry});if(error)throw error;
   return data?json({ok:true,code_expires_at:expiry}):json({error:'state_changed'},409);
  }
  return json({error:'unknown_action'},400);
 }catch{return json({error:'club_agent_error'},500);}
});
