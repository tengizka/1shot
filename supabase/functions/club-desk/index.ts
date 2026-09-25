import {cors,json,db} from '../_shared/club.ts';
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return json({error:'method_not_allowed'},405);
 if(!Deno.env.get('AGENT_SECRET')||req.headers.get('x-agent-secret')!==Deno.env.get('AGENT_SECRET'))return json({error:'Unauthorized'},403);
 try{
  const b=await req.json(),client=db();
  const {data:worker,error}=await client.from('club_worker').select('*').eq('worker_id',b.worker_id).gt('lease_until',new Date().toISOString()).single();
  if(error||!worker)return json({error:'lease_expired'},409);
  if(b.action==='poll'){
   await client.from('club_worker').update({protocol:2}).eq('worker_id',b.worker_id);
   const {data:accounts,error:e1}=await client.from('club_accounts').select('*').gt('requested_at',new Date(Date.now()-120000).toISOString()).order('updated_at',{ascending:true,nullsFirst:true}).limit(50);
   const {data:jobs,error:e2}=await client.from('club_commands').select('*').in('status',['queued','running']).order('created_at').limit(50);
   const {data:resets,error:e3}=await client.from('club_commands').select('*').eq('status','awaiting_admin').order('created_at').limit(50);
   if(e3)throw e3;const commands=[...(jobs||[]),...(resets||[])];
   if(e1||e2)throw e1||e2;return json({accounts,commands});
  }
  if(b.action==='account'){
   const {error}=await client.from('club_accounts').update({data:b.data,updated_at:new Date().toISOString()}).eq('telegram_id',b.telegram_id).eq('gizmo_user_id',b.gizmo_user_id);if(error)throw error;
   const row:Record<string,unknown>={};for(const [api,column] of [['username','username'],['firstName','first_name'],['lastName','last_name']])if(typeof b.data?.[api]==='string')row[column]=b.data[api];
   if(Object.keys(row).length){const {error}=await client.from('profiles').update(row).eq('telegram_id',b.telegram_id).eq('gizmo_user_id',b.gizmo_user_id);if(error)throw error;}
   return json({ok:true});
  }
  if(b.action==='claim'){
   const {data,error}=await client.from('club_commands').update({status:'running',updated_at:new Date().toISOString()}).eq('id',b.id).eq('status','queued').select('id');if(error)throw error;
   return json({ok:!!data?.length});
  }
  if(b.action==='finish'){
   if(!['done','attention','rejected'].includes(b.status))return json({error:'bad_status'},400);
   const {error}=await client.from('club_commands').update({status:b.status,message:String(b.message||'').slice(0,300),payload:{},updated_at:new Date().toISOString()}).eq('id',b.id).in('status',['running','awaiting_admin']);if(error)throw error;return json({ok:true});
  }
  if(b.action==='password_request'){
   const {data,error}=await client.from('club_commands').select('id,gizmo_user_id,telegram_id,status,created_at').eq('id',b.id).eq('kind','password_request').eq('status','awaiting_admin').single();
   if(error||!data)return json({error:'Заявка уже закрыта или не найдена'},409);
   return json({request:data});
  }
  if(b.action==='resolve_password'){
   if(!['done','rejected'].includes(b.outcome)||b.confirmed!==true)return json({error:'Подтвердите действие'},400);
   const message=b.outcome==='rejected'?'Заявка закрыта администратором без смены пароля':b.verified===true?'Услуга предоставлена: пароль изменён и проверен в Gizmo':'Администратор отметил услугу как предоставленную';
   const {data,error}=await client.from('club_commands').update({status:b.outcome,message,payload:{},updated_at:new Date().toISOString()}).eq('id',b.id).eq('kind','password_request').eq('status','awaiting_admin').select('id');if(error)throw error;
   if(!data?.length){
    const {data:existing,error:readError}=await client.from('club_commands').select('status').eq('id',b.id).eq('kind','password_request').single();
    if(readError)throw readError;if(existing?.status!==b.outcome)return json({ok:false,conflict:true,error:'Статус заявки уже изменился'});
   }
   return json({ok:true});
  }
  if(b.action==='cancel'){
   const {data:booking,error}=await client.from('club_bookings').select('telegram_id').eq('id',b.id).single();if(error)throw error;
   const {data,error:cancelError}=await client.rpc('club_cancel',{p_user:booking.telegram_id,p_id:b.id});if(cancelError)throw cancelError;
   return data?json({ok:true}):json({error:'Бронь нельзя отменить в текущем состоянии. Сессии не прерываем'},409);
  }
  return json({error:'unknown_action'},400);
 }catch{return json({error:'desk_service_error'},500);}
});
