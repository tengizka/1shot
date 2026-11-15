// Post maker for the SMM admin (page tengizka.fun/smm/1shot/maker/, opened from the club bot as a mini-app).
// POST {initData,png,mode,caption,button}: Telegram's initData proves who opened the page (HMAC with the bot token);
// only users in smm_bot_admins are served. The picture always comes back as a file; with mode=post the bot also sends
// the finished channel post (caption with our custom emoji, green button, «Опубликовать в канал»), stored in smm_posts
// so club-bot's publish() can copy it to the channel with the emoji intact.
// POST ?pin=1 with header x-smm-key (hash in smm_send_keys) sends each admin the button that opens the maker and pins it.
const TOKEN=Deno.env.get('TELEGRAM_BOT_TOKEN')||'';
const SB=Deno.env.get('SUPABASE_URL')||'',SKEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const MAKER='https://tengizka.fun/smm/1shot/maker/';
const MINIAPP='https://t.me/oneshotagent?startapp=channel';
const CORS={'access-control-allow-origin':'https://tengizka.fun','access-control-allow-headers':'content-type','access-control-allow-methods':'POST, OPTIONS'};
const ok=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'content-type':'application/json',...CORS}});
const db=async(path:string,init:RequestInit={})=>{const r=await fetch(`${SB}/rest/v1/${path}`,{...init,headers:{apikey:SKEY,Authorization:'Bearer '+SKEY,'content-type':'application/json',...(init.headers||{})}});return r.ok&&r.status!==204?await r.json():[]};
const tg=async(method:string,body:unknown)=>(await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json();
const tgForm=async(method:string,form:FormData)=>(await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`,{method:'POST',body:form})).json();
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');
const hmac=async(key:ArrayBuffer|Uint8Array,data:string)=>crypto.subtle.sign('HMAC',await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']),new TextEncoder().encode(data));
async function userFrom(initData:string){
 const p=new URLSearchParams(initData);const hash=p.get('hash');if(!hash)return null;p.delete('hash');
 const dcs=[...p.entries()].sort(([a],[b])=>a<b?-1:1).map(([k,v])=>`${k}=${v}`).join('\n');
 const secret=await hmac(new TextEncoder().encode('WebAppData'),TOKEN);
 if(hex(await hmac(secret,dcs))!==hash)return null;
 if(Date.now()/1000-Number(p.get('auth_date')||0)>86400)return null;
 try{return JSON.parse(p.get('user')||'null')}catch{return null}
}
const isSmm=async(id:number)=>Number.isSafeInteger(id)&&(await db(`smm_bot_admins?telegram_id=eq.${id}&select=telegram_id`)).length>0;
// Our emoji pack: plain emoji in the caption become custom ones (the same rule as in club-bot).
let emap:[string,string][]|null=null;
async function emojis(){if(emap)return emap;const r=await tg('getStickerSet',{name:'oneshot_emoji_by_emojitengbot'});const seen=new Set<string>(),out:[string,string][]=[];
 for(const st of r?.result?.stickers||[]){const e=String(st.emoji||'').replace(/️/g,'');if(e&&st.custom_emoji_id&&!seen.has(e)){seen.add(e);out.push([e,st.custom_emoji_id])}}if(r?.ok)emap=out;return out}
const esc=(t:string)=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
async function withEmoji(html:string){const map=await emojis();return html.split(/(<tg-emoji[^>]*>[\s\S]*?<\/tg-emoji>|<[^>]+>)/).map(part=>{if(part.startsWith('<'))return part;let t=part;for(const [e,id] of map)t=t.replace(new RegExp(esc(e)+'️?','gu'),m=>`<tg-emoji emoji-id="${id}">${m}</tg-emoji>`);return t}).join('')}
// The page's caption field has no Enter key: « // » is an empty line, « / » a new line, *text* is bold.
const captionHtml=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\s+\/\/\s+/g,'\n\n').replace(/\s+\/\s+/g,'\n').replace(/\*([^*\n]+)\*/g,'<b>$1</b>').trim();
const btn=(text:string,fancy:boolean)=>({text,url:MINIAPP,...(fancy?{style:'success',icon_custom_emoji_id:'5384056395358315887'}:{})});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:CORS});
 if(req.method!=='POST')return ok({ok:true});
 const url=new URL(req.url);
 if(url.searchParams.get('pin')==='1'){
  const key=req.headers.get('x-smm-key')||'';
  const h=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)));
  if(!key||!(await db(`smm_send_keys?hash=eq.${h}&select=hash`)).length)return ok({error:'forbidden'},403);
  const out=[];
  for(const a of await db('smm_bot_admins?select=telegram_id')){
   const r=await tg('sendMessage',{chat_id:a.telegram_id,text:'🎨 Конструктор постов 1SHOT\n\nСобирай картинки в нашем стиле: пост 4:5 или сторис 9:16, фото клуба или своё, текст. Готовый пост с кнопкой придёт сюда.',reply_markup:{inline_keyboard:[[{text:'Открыть конструктор',web_app:{url:MAKER}}]]}});
   if(r?.ok)await tg('pinChatMessage',{chat_id:a.telegram_id,message_id:r.result.message_id,disable_notification:true});
   out.push(r?.ok||r?.description);
  }
  return ok({sent:out});
 }
 const body=await req.json().catch(()=>null);if(!body)return ok({error:'bad_request'},400);
 const user=await userFrom(String(body.initData||''));if(!user?.id)return ok({error:'Открой конструктор из бота'},401);
 if(!await isSmm(Number(user.id)))return ok({error:'Нет доступа'},403);
 // The page asks this first and shows the editor only to the SMM admins.
 if(body.mode==='check')return ok({ok:true});
 const png=String(body.png||'');if(!png||png.length>14_000_000)return ok({error:'Картинка не дошла'},400);
 const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));const file=new Blob([bytes],{type:'image/png'});
 const name=`1SHOT_${body.format==='story'?'story':'post'}_${new Date(Date.now()+3*3600e3).toISOString().slice(5,16).replace(/[-T:]/g,'')}.png`;
 const chat=Number(user.id);
 // The full-quality file first: it is what goes to VK, Instagram and the stories.
 const df=new FormData();df.append('chat_id',String(chat));df.append('document',file,name);df.append('caption','Картинка в полном качестве');
 const d=await tgForm('sendDocument',df);if(!d?.ok)return ok({error:String(d?.description||'telegram')},502);
 if(body.mode!=='post')return ok({ok:true});
 const caption=captionHtml(String(body.caption||'')),fancyCap=await withEmoji(caption);
 const button_text=String(body.button||'').trim().slice(0,40)||'Забронировать место';
 const msk=new Date(Date.now()+3*3600e3).toISOString().slice(0,10);
 const [row]=await db('smm_posts',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({day:msk,title:'Пост из конструктора',tg_photo:'pending',tg_caption:caption,button_text,sent_at:new Date().toISOString()})});
 if(!row?.id)return ok({error:'Не сохранился пост'},500);
 let sent:any=null;
 for(const [cap,fancy] of [[fancyCap,true],[caption,true],[caption,false]] as [string,boolean][]){
  const f=new FormData();f.append('chat_id',String(chat));f.append('photo',file,name);f.append('caption',cap);f.append('parse_mode','HTML');
  f.append('reply_markup',JSON.stringify({inline_keyboard:[[btn(button_text,fancy)],[{text:'📢 Опубликовать в канал',callback_data:'pub:'+row.id}]]}));
  sent=await tgForm('sendPhoto',f);if(sent?.ok)break;
 }
 if(!sent?.ok)return ok({error:String(sent?.description||'telegram')},502);
 await db(`smm_posts?id=eq.${row.id}`,{method:'PATCH',body:JSON.stringify({tg_photo:sent.result.photo.at(-1).file_id})});
 await tg('sendMessage',{chat_id:chat,reply_to_message_id:sent.result.message_id,text:'👆 Так пост будет выглядеть в канале. Всё ок? Жми «Опубликовать в канал».'});
 return ok({ok:true});
});
