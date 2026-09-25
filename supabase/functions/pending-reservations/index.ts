import { createClient } from 'npm:@supabase/supabase-js@2.7.1';
const headers={'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-agent-secret',
  'Access-Control-Allow-Methods':'GET, PATCH, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{headers});
  const secret=Deno.env.get('AGENT_SECRET');
  if(!secret||req.headers.get('x-agent-secret')!==secret)return json({error:'Unauthorized'},403);
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try{
    if(req.method==='GET'){
      const {data,error}=await db.from('reservations').select('*').eq('status','pending')
        .gt('created_at',new Date(Date.now()-3600000).toISOString()).order('created_at').limit(10);
      if(error)throw error;
      const ids = [...new Set((data || []).map((r: {telegram_id: number}) => r.telegram_id))];
      if (!ids.length) return json({reservations:[]});
      const {data:profiles,error:profileError} = await db.from('profiles')
        .select('telegram_id,gizmo_user_id').in('telegram_id',ids);
      if (profileError) throw profileError;
      const byTelegram = new Map((profiles || []).map((p: {telegram_id:number;gizmo_user_id:number}) => [String(p.telegram_id),p.gizmo_user_id]));
      return json({reservations:(data || []).map((r: {telegram_id:number}) => ({...r,gizmo_user_id:byTelegram.get(String(r.telegram_id)) ?? null}))});
    }
    if(req.method==='PATCH'){
      const {id,status,gizmo_reservation_id,error_message}=await req.json();
      if(typeof id!=='string'||!['confirmed','failed'].includes(status))return json({error:'invalid_update'},400);
      if(status==='confirmed'&&!gizmo_reservation_id)return json({error:'missing_gizmo_reservation_id'},400);
      // processed_at is not part of the supplied schema; do not write it.
      const {data,error}=await db.from('reservations').update({status,
        gizmo_reservation_id:gizmo_reservation_id?String(gizmo_reservation_id):null,
        error_message:error_message?String(error_message):null,
      }).eq('id',id).eq('status','pending').select('id');
      if(error)throw error;
      return data?.length?json({success:true}):json({error:'reservation_not_pending'},409);
    }
    return json({error:'method_not_allowed'},405);
  }catch(error){return json({error:error instanceof Error?error.message:'reservation_queue_error'},500);}
});
