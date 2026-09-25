import { createClient } from 'npm:@supabase/supabase-js@2.7.1';
import { createHmac, timingSafeEqual } from 'node:crypto';
const headers = {'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const json = (body: unknown, status=200) => new Response(JSON.stringify(body),{status,headers});
function verify(initData: unknown, token: string): number {
  if (typeof initData!=='string' || !token) throw Error('invalid_init_data');
  const params=new URLSearchParams(initData);
  if (new Set(params.keys()).size!==Array.from(params.keys()).length) throw Error('duplicate_fields');
  const hash=params.get('hash') || ''; params.delete('hash');
  if (!/^[a-f0-9]{64}$/.test(hash)) throw Error('invalid_hash');
  const check=Array.from(params.entries()).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('\n');
  const key=createHmac('sha256','WebAppData').update(token).digest();
  const expected=createHmac('sha256',key).update(check).digest();
  const supplied=Uint8Array.from(hash.match(/../g)!,x=>parseInt(x,16));
  if(!timingSafeEqual(expected,supplied))throw Error('invalid_signature');
  const age=Date.now()/1000-Number(params.get('auth_date'));
  if(!Number.isFinite(age)||age< -30||age>3600)throw Error('expired_init_data');
  const user=JSON.parse(params.get('user')||'{}');
  if(!Number.isSafeInteger(user.id)||user.id<=0)throw Error('invalid_user');
  return user.id;
}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{headers});
  if(req.method!=='POST')return json({error:'method_not_allowed'},405);
  const token=Deno.env.get('TELEGRAM_BOT_TOKEN');
  if(!token)return json({error:'TELEGRAM_BOT_TOKEN не настроен на сервере'},500);
  try {
    const body=await req.json();let telegramId:number;
    try{telegramId=verify(body.initData,token);}catch{return json({error:'Откройте мини-апп заново через Telegram'},403);}
    if(typeof body.host_id!=='string'||!body.host_id||body.host_id.length>100)return json({error:'Некорректный номер компьютера'},400);
    if (body.host_id.trim() === '1' || body.host_id.trim().toLowerCase() === 'ps5') return json({error:'PS5 бронируется только по телефону: +7 (495) 583-78-11'},409);
    const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    // Browser-supplied identity, duration and price are deliberately ignored.
    const {data,error}=await client.rpc('reserve_club_host',{p_telegram_id:telegramId,p_host_id:body.host_id});
    if(error)return json({error:error.message,code:error.code},error.code==='P0001'?409:500);
    return json({success:true,reservation:data},201);
  }catch{return json({error:'Не удалось обработать запрос бронирования'},400);}
});
