import {createClient} from 'npm:@supabase/supabase-js@2.7.1';
import {createHmac,timingSafeEqual} from 'node:crypto';
export const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type, x-agent-secret','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
export const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
export const db=()=>createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
export const publicFields='id,host_id,mode,duration_kind,starts_at,ends_at,hold_until,status,created_at,message';
export async function codeHash(id:string,code:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${id}:${code}`)))).map(b=>b.toString(16).padStart(2,'0')).join('');}
export function verify(initData: unknown, token: string): number {
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
