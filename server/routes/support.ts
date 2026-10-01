import {db,json} from '../shared.ts';
export async function hosts(){const {data,error}=await db().from('hosts_cache').select('host_id,zone,status,gizmo_host_id,updated_at').order('host_id');return error?json({error:'hosts_unavailable'},503):json({hosts:data,diagnostic:data.length?null:'hosts_cache_empty'});}
export async function profile(req:Request){
 const b=await req.json();
 if(!b||!Number.isSafeInteger(b.telegram_id)||b.telegram_id<=0||!Number.isSafeInteger(b.gizmo_user_id)||b.gizmo_user_id<=0||typeof b.username!=='string'||!b.username.trim()||b.username.length>254)return json({error:'invalid_profile'},400);
 const row:Record<string,unknown>={telegram_id:b.telegram_id,gizmo_user_id:b.gizmo_user_id,username:b.username,updated_at:new Date().toISOString()};
 for(const field of ['first_name','last_name']){if(b[field]!==undefined&&(typeof b[field]!=='string'||b[field].length>254))return json({error:'invalid_profile'},400);if(b[field])row[field]=b[field];}
 const {error}=await db().from('profiles').upsert(row,{onConflict:'telegram_id'});return error?json({error:'profile_save_failed'},503):json({ok:true});
}
