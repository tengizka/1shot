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
const CHANNEL='@oneshotmira17';
const CORS={'access-control-allow-origin':'https://tengizka.fun','access-control-allow-headers':'content-type','access-control-allow-methods':'GET, POST, OPTIONS'};
const ok=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'content-type':'application/json',...CORS}});
const db=async(path:string,init:RequestInit={})=>{const r=await fetch(`${SB}/rest/v1/${path}`,{...init,headers:{apikey:SKEY,Authorization:'Bearer '+SKEY,'content-type':'application/json',...(init.headers||{})}});return r.ok&&r.status!==204?await r.json():[]};
const tg=async(method:string,body:unknown)=>(await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json();
const tgForm=async(method:string,form:FormData)=>(await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`,{method:'POST',body:form})).json();
const url0=(r:Request)=>new URL(r.url);
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
 if(req.method==='GET'&&url0(req).searchParams.get('price')==='reception'){const [row]=await db('smm_price_screens?id=eq.reception&select=cfg,updated_at');return ok(row||{cfg:null})}
 if(req.method!=='POST')return ok({ok:true});
 const url=new URL(req.url);
 // Every 5 minutes pg_cron calls ?cron=1: scheduled posts whose time has come are copied from their preview to the channel.
 if(url.searchParams.get('cron')==='1'){
  const key=req.headers.get('x-smm-key')||'';const h=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)));
  if(!key||!(await db(`smm_send_keys?hash=eq.${h}&select=hash`)).length)return ok({error:'forbidden'},403);
  const due=await db(`smm_posts?published_at=is.null&scheduled_at=lte.${new Date().toISOString()}&preview_msg=not.is.null&select=id,button_text,button_url,preview_chat,preview_msg&order=scheduled_at.asc&limit=5`);
  const done=[];
  for(const p of due){
   const [claim]=await db(`smm_posts?id=eq.${p.id}&published_at=is.null`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({published_at:new Date().toISOString()})});
   if(!claim)continue;
   let r:any=null;for(const fancy of [true,false]){r=await tg('copyMessage',{chat_id:CHANNEL,from_chat_id:p.preview_chat,message_id:p.preview_msg,reply_markup:{inline_keyboard:[[btn(p.button_text||'Забронировать место',fancy)]]}});if(r?.ok)break}
   if(r?.ok){await tg('sendMessage',{chat_id:p.preview_chat,reply_to_message_id:p.preview_msg,text:'✅ Запланированный пост вышел в канале.'})}
   else{await db(`smm_posts?id=eq.${p.id}`,{method:'PATCH',body:JSON.stringify({published_at:null,scheduled_at:null})});await tg('sendMessage',{chat_id:p.preview_chat,reply_to_message_id:p.preview_msg,text:'⚠️ Не получилось опубликовать запланированный пост: '+String(r?.description||'')+'. Опубликуй кнопкой вручную.'})}
   done.push(p.id);
  }
  return ok({published:done});
 }
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
 // The price editor sends its recorded video as multipart (initData, mode=video, file): too big for JSON.
 if((req.headers.get('content-type')||'').startsWith('multipart/form-data')){
  const fd=await req.formData().catch(()=>null);if(!fd)return ok({error:'bad_request'},400);
  const u=await userFrom(String(fd.get('initData')||''));if(!u?.id)return ok({error:'Открой конструктор из бота'},401);
  if(!await isSmm(Number(u.id)))return ok({error:'Нет доступа'},403);
  const f=fd.get('file');if(!(f instanceof File)||!f.size||f.size>45_000_000)return ok({error:'Видео не дошло'},400);
  const ext=/mp4/.test(f.type)?'mp4':'webm';
  const vf=new FormData();vf.append('chat_id',String(u.id));vf.append('document',new Blob([await f.arrayBuffer()],{type:ext==='mp4'?'video/mp4':'video/webm'}),`1SHOT_price_${new Date(Date.now()+3*3600e3).toISOString().slice(5,16).replace(/[-T:]/g,'')}.${ext}`);
  vf.append('caption',ext==='mp4'?'Анимированный прайс':'Анимированный прайс (WebM: если экран его не открывает, используй ссылку для экрана)');
  const r=await tgForm('sendDocument',vf);return r?.ok?ok({ok:true}):ok({error:String(r?.description||'telegram')},502);
 }
 const body=await req.json().catch(()=>null);if(!body)return ok({error:'bad_request'},400);
 const user=await userFrom(String(body.initData||''));if(!user?.id)return ok({error:'Открой конструктор из бота'},401);
 if(!await isSmm(Number(user.id)))return ok({error:'Нет доступа'},403);
 // The page asks this first and shows the editor only to the SMM admins.
 if(body.mode==='check')return ok({ok:true});
 // Plan page: upcoming scheduled posts, cancel or move them.
 if(body.mode==='plan'){const rows=await db('smm_posts?published_at=is.null&scheduled_at=not.is.null&select=id,scheduled_at,tg_caption,title&order=scheduled_at.asc&limit=100');
  const last=await db('smm_posts?published_at=not.is.null&select=id,published_at,tg_caption&order=published_at.desc&limit=10');return ok({ok:true,rows,last})}
 if(body.mode==='unschedule'||body.mode==='schedule'){const id=Number(body.id);if(!Number.isSafeInteger(id))return ok({error:'bad_id'},400);
  const at=body.mode==='schedule'?new Date(String(body.at)):null;if(at&&(isNaN(+at)||+at<Date.now()-60e3))return ok({error:'Время уже прошло'},400);
  await db(`smm_posts?id=eq.${id}&published_at=is.null`,{method:'PATCH',body:JSON.stringify({scheduled_at:at?at.toISOString():null})});return ok({ok:true})}

 // Gizmo banner editor: the finished self-contained HTML comes back as a file.
 if(body.mode==='html'){const html=String(body.html||'');if(!html.startsWith('<!doctype html>')||html.length>12_000_000)return ok({error:'bad_html'},400);
  const nm=(String(body.name||'1SHOT_gizmo.html').match(/^[\w.\-]{1,80}\.html$/)||['1SHOT_gizmo.html'])[0];
  const hf=new FormData();hf.append('chat_id',String(user.id));hf.append('document',new Blob([html],{type:'text/html'}),nm);hf.append('caption','Баннер для Gizmo: загрузи этот файл в новости');
  const r=await tgForm('sendDocument',hf);return r?.ok?ok({ok:true}):ok({error:String(r?.description||'telegram')},502)}
 // The price editor saves the layout for the reception screen; the screen page reads it with GET ?price=reception.
 if(body.mode==='screen'){const cfg=body.cfg;const txt=JSON.stringify(cfg??null);if(!cfg||typeof cfg!=='object'||txt.length>60000)return ok({error:'bad_cfg'},400);
  await db('smm_price_screens',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({id:'reception',cfg,updated_at:new Date().toISOString()})});
  if(body.notify){const r=await tg('sendMessage',{chat_id:Number(user.id),text:'📺 Прайс для экрана на ресепшене. Открой ссылку в браузере на компе у экрана и нажми F11. Анимация крутится сама, а когда сохраняешь прайс в конструкторе, экран обновится за пару минут.',reply_markup:{inline_keyboard:[[{text:'Открыть прайс',url:MAKER+'price/?screen'}]]}});if(!r?.ok)return ok({error:String(r?.description||'telegram')},502)}
  return ok({ok:true})}
 const png=String(body.png||'');if(!png||png.length>14_000_000)return ok({error:'Картинка не дошла'},400);
 const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));const file=new Blob([bytes],{type:'image/png'});
 const name=`1SHOT_${body.format==='story'?'story':body.format==='price'?'price':'post'}_${new Date(Date.now()+3*3600e3).toISOString().slice(5,16).replace(/[-T:]/g,'')}.png`;
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
  f.append('reply_markup',JSON.stringify({inline_keyboard:[[btn(button_text,fancy)],[{text:'📢 Опубликовать в канал',callback_data:'pub:'+row.id}],[{text:'📣 Сделать рассылку',callback_data:'bc:'+row.id}]]}));
  sent=await tgForm('sendPhoto',f);if(sent?.ok)break;
 }
 if(!sent?.ok)return ok({error:String(sent?.description||'telegram')},502);
 const at=body.at?new Date(String(body.at)):null;const when=at&&!isNaN(+at)&&+at>Date.now()?at:null;
 await db(`smm_posts?id=eq.${row.id}`,{method:'PATCH',body:JSON.stringify({tg_photo:sent.result.photo.at(-1).file_id,preview_chat:chat,preview_msg:sent.result.message_id,scheduled_at:when?when.toISOString():null})});
 const whenTxt=when?new Date(+when+3*3600e3).toISOString().replace(/^\d{4}-(\d\d)-(\d\d)T(\d\d:\d\d).*$/,'$2.$1 в $3'):'';
 await tg('sendMessage',{chat_id:chat,reply_to_message_id:sent.result.message_id,text:when?`⏰ Пост выйдет в канале сам ${whenTxt} (по Москве). Передумал: опубликуй сразу кнопкой выше или отмени во вкладке «План» конструктора.`:'👆 Так пост будет выглядеть в канале. Всё ок? Жми «Опубликовать в канал» или «Сделать рассылку».'});
 return ok({ok:true});
});
