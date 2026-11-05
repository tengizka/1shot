import {cors,json,db,codeHash} from '../_shared/club.ts';
// A short calm note in @oneshotagent when a booking frees up, is taken off or runs out (the guest started the bot once).
async function notifyGuest(client:ReturnType<typeof db>,id:string,from:string,to:string,message:string){
 const token=Deno.env.get('TELEGRAM_BOT_TOKEN');if(!token)return;
 const {data:b}=await client.from('club_bookings').select('telegram_id,host_id,starts_at,hold_until').eq('id',id).maybeSingle();
 if(!b?.telegram_id)return;
 const pc=b.host_id==='1'?'PS5':'ПК '+b.host_id;
 const at=(iso?:string|null)=>iso?new Date(iso).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}):'';
 let text='';
 if(to==='holding'&&from==='waiting')text=`🟢 <b>${pc} освободился</b>\nДержим его для тебя до ${at(b.hold_until)}. Подходи 🎮`;
 else if(to==='expired')text=`⏱ Бронь ${pc} на ${at(b.starts_at)} закончилась: время вышло.\nЗабронировать снова можно в приложении.`;
 else if(to==='cancelled'){
  const why=/ПК занят/.test(message)?'ПК ещё занят. Выбери другой в приложении.':/в клубе/.test(message)?'Бронь снята в клубе.':'';
  text=`Бронь ${pc} на ${at(b.starts_at)} отменена.`+(why?'\n'+why:'');
 }
 if(!text)return;
 await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:b.telegram_id,text,parse_mode:'HTML'})});
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return json({error:'method_not_allowed'},405);
 const secret=Deno.env.get('AGENT_SECRET');
 if(!secret||req.headers.get('x-agent-secret')!==secret)return json({error:'Unauthorized'},403);
 try{
  const b=await req.json();const client=db();
  if(b.action==='snapshot'&&b.eco===1){
   const {data,error}=await client.rpc('club_worker_poll',{p_worker:b.worker_id,p_after:Number(b.after_event)||0,p_hosts:b.hosts??null,p_accounts:b.accounts||[]});
   if(error)throw error;return json(data);
  }
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
   if(data)await notifyGuest(client,b.id,b.from,b.to,b.message||'').catch(()=>{});
   return data?json({ok:true,code_expires_at:expiry}):json({error:'state_changed'},409);
  }
  return json({error:'unknown_action'},400);
 }catch{return json({error:'club_agent_error'},500);}
});
