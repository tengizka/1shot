// Sends a finished SMM file (or a note) from tengizka.fun/smm/ to every SMM admin of the club bot.
// POST {url?, caption?, text?} with header x-smm-key; the key's SHA-256 must be in smm_send_keys.
// POST {url, caption, post:true, button?}: the picture comes as a ready channel post (our custom emoji, green button)
// with «Опубликовать в канал» and «Сделать рассылку», stored in smm_posts so club-bot can publish it.
// Only files under https://tengizka.fun/smm/ are sent, and only to smm_bot_admins, so the function cannot be used
// to message anyone else or to relay other content.
const TOKEN=Deno.env.get('TELEGRAM_BOT_TOKEN')||'';
const SB=Deno.env.get('SUPABASE_URL')||'',SKEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const ok=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'content-type':'application/json'}});
const db=async(path:string,init:RequestInit={})=>{const r=await fetch(`${SB}/rest/v1/${path}`,{...init,headers:{apikey:SKEY,Authorization:'Bearer '+SKEY,'content-type':'application/json',...(init.headers||{})}});return r.ok&&r.status!==204?await r.json():[]};
const tg=async(method:string,body:unknown)=>(await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json();
const MINIAPP='https://t.me/oneshotagent?startapp=channel';
let emap:[string,string][]|null=null;
async function emojis(){if(emap)return emap;const r=await tg('getStickerSet',{name:'oneshot_emoji_by_emojitengbot'});const seen=new Set<string>(),out:[string,string][]=[];
 for(const st of r?.result?.stickers||[]){const e=String(st.emoji||'').replace(/\ufe0f/g,'');if(e&&st.custom_emoji_id&&!seen.has(e)){seen.add(e);out.push([e,st.custom_emoji_id])}}if(r?.ok)emap=out;return out}
const esc=(t:string)=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
async function withEmoji(html:string){const map=await emojis();return html.split(/(<tg-emoji[^>]*>[\s\S]*?<\/tg-emoji>|<[^>]+>)/).map(part=>{if(part.startsWith('<'))return part;let t=part;for(const [e,id] of map)t=t.replace(new RegExp(esc(e)+'\ufe0f?','gu'),m=>`<tg-emoji emoji-id="${id}">${m}</tg-emoji>`);return t}).join('')}
const btn=(text:string,fancy:boolean)=>({text,url:MINIAPP,...(fancy?{style:'success',icon_custom_emoji_id:'5384056395358315887'}:{})});
const sha=async(t:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t)))).map(b=>b.toString(16).padStart(2,'0')).join('');
Deno.serve(async req=>{
 if(req.method!=='POST')return ok({ok:true});
 const key=req.headers.get('x-smm-key')||'';
 if(!key||!(await db(`smm_send_keys?hash=eq.${await sha(key)}&select=hash`)).length)return ok({error:'forbidden'},403);
 const {url='',caption='',text='',post=false,button=''}=await req.json().catch(()=>({}));
 if(url&&(!/^https:\/\/tengizka\.fun\/smm\/[\w\-./]+$/.test(url)||url.includes('..')))return ok({error:'bad_url'},400);
 const admins:{telegram_id:number}[]=await db('smm_bot_admins?select=telegram_id');
 let file:Blob|null=null;
 if(url){const f=await fetch(url);if(!f.ok)return ok({error:'not_found',status:f.status},404);file=await f.blob()}
 const out=[];
 if(post&&file){
  const pic:Blob=file;
  const cap=String(caption).slice(0,1000),fancyCap=await withEmoji(cap),bt=String(button||'').trim().slice(0,40)||'Забронировать место';
  const msk=new Date(Date.now()+3*3600e3).toISOString().slice(0,10);
  const [row]=await db('smm_posts',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({day:msk,title:'Пост от Claude',tg_photo:'pending',tg_caption:cap,button_text:bt,sent_at:new Date().toISOString()})});
  if(!row?.id)return ok({error:'db'},500);
  let fileId='';
  for(const a of admins){
   let sent:any=null;
   for(const [c,fancy] of [[fancyCap,true],[cap,true],[cap,false]] as [string,boolean][]){
    const f=new FormData();f.append('chat_id',String(a.telegram_id));if(fileId)f.append('photo',fileId);else f.append('photo',pic,'post.png');
    f.append('caption',c);f.append('parse_mode','HTML');
    f.append('reply_markup',JSON.stringify({inline_keyboard:[[btn(bt,fancy)],[{text:'📢 Опубликовать в канал',callback_data:'pub:'+row.id}],[{text:'📣 Сделать рассылку',callback_data:'bc:'+row.id}]]}));
    sent=await (await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`,{method:'POST',body:f})).json();if(sent?.ok)break;
   }
   if(sent?.ok&&!fileId){fileId=sent.result.photo.at(-1).file_id;await db(`smm_posts?id=eq.${row.id}`,{method:'PATCH',body:JSON.stringify({tg_photo:fileId})})}
   out.push(sent?.ok||sent?.description);
  }
  return ok({sent:out,post:row.id});
 }
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
