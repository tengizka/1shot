import {cors,json,db,verify,codeHash,publicFields} from '../_shared/club.ts';
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return json({error:'method_not_allowed'},405);
 try{
  const b=await req.json();const client=db();
  if(b.action==='capabilities'){
   const {data,error}=await client.from('club_settings').select('*').eq('id',true).single();
   if(error)throw error;return json({enabled:!!data.enabled,timezone:'Europe/Moscow',protocol:data.flow_version||1,poll_bundle:1});
  }
  let user:number;try{user=verify(b.initData,Deno.env.get('TELEGRAM_BOT_TOKEN')||'');}catch{return json({error:'Откройте приложение заново через Telegram'},403);}
  if(b.action==='state'){
   const {data,error}=await client.rpc('club_client_state',{p_user:user});if(error)throw error;
   const telegram=JSON.parse(new URLSearchParams(b.initData).get('user')||'{}');
   return json({...data,telegram:{first_name:telegram.first_name,last_name:telegram.last_name,photo_url:typeof telegram.photo_url==='string'&&telegram.photo_url.startsWith('https://')?telegram.photo_url:null}});
  }
  if(b.action==='list'){
   // Never let recent history push an old active/attention booking out of the list.
   const fields=publicFields+',protocol,for_friend,instant';
   const {data:active,error}=await client.from('club_bookings').select(fields).eq('telegram_id',user).not('status','in','(cancelled,expired,completed)').order('created_at',{ascending:false});
   if(error)throw error;
   const {data:history,error:historyError}=await client.from('club_bookings').select(fields).eq('telegram_id',user).in('status',['cancelled','expired','completed']).order('created_at',{ascending:false}).limit(20);
   if(historyError)throw historyError;return json({bookings:[...(active||[]),...(history||[])]});
  }
  if(b.action==='create_v2'){
   if(typeof b.host_id!=='string'||b.host_id.length>100||typeof b.for_friend!=='boolean')return json({error:'Некорректная заявка'},400);
   const {data,error}=await client.rpc('club_create_v2',{p_user:user,p_host:b.host_id,p_mode:b.mode,p_kind:b.duration_kind,p_start:b.starts_at||null,p_end:b.ends_at||null,p_request:b.client_request_id,p_friend:b.for_friend});
   if(error)throw error;return json({booking_id:data.id},201);
  }
  if(['enter','release'].includes(b.action)){
   const {data,error}=await client.rpc('club_booking_action',{p_user:user,p_id:b.id,p_action:b.action});if(error)throw error;
   return data?json({ok:true}):json({error:'Состояние брони изменилось или панель не готова'},409);
  }
  if(b.action==='account'){
   const {error}=await client.rpc('club_account_request',{p_user:user});if(error)throw error;
   const {data:account,error:readError}=await client.from('club_accounts').select('data,updated_at').eq('telegram_id',user).single();if(readError)throw readError;
   const {data:commands,error:cmdError}=await client.from('club_commands').select('id,kind,status,message,created_at').eq('telegram_id',user).order('created_at',{ascending:false}).limit(5);if(cmdError)throw cmdError;
   const {data:passwordRequests,error:passwordError}=await client.from('club_commands').select('id,status,message,created_at,updated_at').eq('telegram_id',user).eq('kind','password_request').order('created_at',{ascending:false}).limit(1);if(passwordError)throw passwordError;
   const telegram=JSON.parse(new URLSearchParams(b.initData).get('user')||'{}');
   return json({account,commands,password_request:passwordRequests?.[0]||null,telegram:{first_name:telegram.first_name,last_name:telegram.last_name,photo_url:typeof telegram.photo_url==='string'&&telegram.photo_url.startsWith('https://')?telegram.photo_url:null}});
  }
  if(b.action==='command'){
   const {data,error}=await client.rpc('club_command',{p_user:user,p_kind:b.kind,p_payload:b.payload||{},p_request:b.request_id});if(error)throw error;
   return json({id:data});
  }
  if(b.action==='create'){
   if(typeof b.host_id!=='string'||b.host_id.length>100||!['arrival','scheduled'].includes(b.mode)||!['hour','range','open'].includes(b.duration_kind))return json({error:'Некорректная заявка'},400);
   const {data,error}=await client.rpc('club_create_booking',{p_user:user,p_host:b.host_id,p_mode:b.mode,p_kind:b.duration_kind,p_start:b.starts_at||null,p_end:b.ends_at||null,p_request:b.client_request_id});
   if(error)throw error;return json({booking_id:data.id},201);
  }
  if(b.action==='checkin'){
   if(typeof b.id!=='string'||!/^\d{6}$/.test(b.code))return json({error:'Введите шестизначный код из клуба'},400);
   const {data,error}=await client.rpc('club_checkin',{p_user:user,p_id:b.id,p_hash:await codeHash(b.id,b.code)});
   if(error)throw error;
   const messages:Record<string,string>={invalid_code:'Неверный код',code_expired:'Код истёк. Попросите новый в клубе',too_many_attempts:'Лимит попыток. Обратитесь к администратору',not_waiting:'ПК ещё не ждёт вас или время брони истекло',not_found:'Бронь не найдена'};
   return messages[data]?json({error:messages[data]},409):json({status:data});
  }
  if(b.action==='cancel'){
   const {data,error}=await client.rpc('club_cancel',{p_user:user,p_id:b.id});if(error)throw error;
   return data?json({ok:true}):json({error:'Эту бронь сейчас нельзя отменить из приложения'},409);
  }
  return json({error:'unknown_action'},400);
 }catch(e){const err=e as {code?:string;message?:string};return json({error:err.code==='P0001'?err.message:'Сервис новых броней недоступен. Обратитесь в клуб'},err.code==='P0001'?409:500);}
});
