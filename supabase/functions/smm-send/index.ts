// Sends a finished SMM file (or a note) from tengizka.fun/smm/ to every SMM admin of the club bot.
// POST {url?, caption?, text?} with header x-smm-key; the key's SHA-256 must be in smm_send_keys.
// Only files under https://tengizka.fun/smm/ are sent, and only to smm_bot_admins, so the function cannot be used
// to message anyone else or to relay other content.
const TOKEN=Deno.env.get('TELEGRAM_BOT_TOKEN')||'';
const SB=Deno.env.get('SUPABASE_URL')||'',SKEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const ok=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'content-type':'application/json'}});
const db=async(path:string)=>{const r=await fetch(`${SB}/rest/v1/${path}`,{headers:{apikey:SKEY,Authorization:'Bearer '+SKEY}});return r.ok?await r.json():[]};
const sha=async(t:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t)))).map(b=>b.toString(16).padStart(2,'0')).join('');
Deno.serve(async req=>{
 if(req.method!=='POST')return ok({ok:true});
 const key=req.headers.get('x-smm-key')||'';
 if(!key||!(await db(`smm_send_keys?hash=eq.${await sha(key)}&select=hash`)).length)return ok({error:'forbidden'},403);
 const {url='',caption='',text=''}=await req.json().catch(()=>({}));
 if(url&&(!/^https:\/\/tengizka\.fun\/smm\/[\w\-./]+$/.test(url)||url.includes('..')))return ok({error:'bad_url'},400);
 const admins:{telegram_id:number}[]=await db('smm_bot_admins?select=telegram_id');
 let file:Blob|null=null;
 if(url){const f=await fetch(url);if(!f.ok)return ok({error:'not_found',status:f.status},404);file=await f.blob()}
 const out=[];
 for(const a of admins){
  if(file){
   const form=new FormData();form.append('chat_id',String(a.telegram_id));if(caption)form.append('caption',String(caption).slice(0,1000));
   form.append('document',file,url.split('/').pop()||'file');
   const r=await (await fetch(`https://api.telegram.org/bot${TOKEN}/sendDocument`,{method:'POST',body:form})).json();
   out.push(r.ok||r.description);
  }else if(text){
   const r=await (await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:a.telegram_id,text:String(text).slice(0,4000),link_preview_options:{is_disabled:true}})})).json();
   out.push(r.ok||r.description);
  }
 }
 return ok({sent:out});
});
