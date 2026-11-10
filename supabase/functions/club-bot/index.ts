// Telegram bot @oneshotagent: greets guests on /start and opens the 1SHOT mini-app.
// GET ?setup=1 points Telegram at this function and sets the menu button and descriptions (safe to repeat).
const TOKEN=Deno.env.get('TELEGRAM_BOT_TOKEN')||'';
const APP='https://tengizka.github.io/1shot/miniapp/';
const PHONE='+74955837811';
// The mini-app promo video, its cover and thumbnail (GitHub Pages, served from the tengizka.fun domain).
const MEDIA='https://tengizka.fun/1shot/miniapp/media/';
let videoId=Deno.env.get('BOT_VIDEO_FILE_ID')||'';
// The first frames are black: Telegram shows this cover (mascot, «Бронируй ПК сам») until play.
const COVER=MEDIA+'bot-cover.jpg';
const HOOK=(Deno.env.get('SUPABASE_URL')||'')+'/functions/v1/club-bot';
const ok=(body:unknown)=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
async function tg(method:string,body:unknown){
 const r=await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 return await r.json();
}
// The first send uploads the file itself with our cover and thumbnail (a link would get Telegram's black first frame);
// later sends reuse Telegram's file_id, which keeps them.
async function uploadVideo(fields:Record<string,unknown>){
 const form=new FormData();
 for(const [k,v] of Object.entries(fields))form.append(k,typeof v==='string'?v:JSON.stringify(v));
 const file=async(name:string)=>new Blob([await (await fetch(MEDIA+name)).arrayBuffer()]);
 form.append('video',await file('bot-welcome.mp4'),'1shot.mp4');
 form.append('thumbfile',await file('bot-thumb.jpg'),'thumb.jpg');form.append('thumbnail','attach://thumbfile');
 form.append('coverfile',await file('bot-cover.jpg'),'cover.jpg');form.append('cover','attach://coverfile');
 const r=await fetch(`https://api.telegram.org/bot${TOKEN}/sendVideo`,{method:'POST',body:form});
 return await r.json();
}
// /app: a picture card with the instructions, then the Android app as a file right under it.
// Telegram drops custom covers on .apk files (tested: the same picture shows on .zip and .txt), hence the card.
const APK='https://github.com/tengizka/1shot/releases/download/app-v0.1.0/1SHOT.apk';
let apkId='',cardId='';
const APP_TEXT='🤖 <b>1SHOT для Android</b>\n\nТа же бронь ПК, что в боте, только своим приложением на телефоне.\n\n1. Нажми на файл ниже и установи. Android спросит про «неизвестный источник» — разреши, это наше приложение.\n2. Войди ником и паролем от аккаунта клуба.\n\nНет аккаунта? Его создаёт администратор в клубе, это пара минут.';
async function sendApp(chat:number){
 const card=await tg('sendPhoto',{chat_id:chat,photo:cardId||MEDIA+'app-card.jpg',caption:APP_TEXT,parse_mode:'HTML'});
 if(card?.ok)cardId=card.result?.photo?.at(-1)?.file_id||cardId;
 const note=card?.ok?'':APP_TEXT;
 if(apkId){const r=await tg('sendDocument',{chat_id:chat,document:apkId,caption:note,parse_mode:'HTML'});if(r?.ok)return}
 const form=new FormData();
 form.append('chat_id',String(chat));form.append('caption',note);form.append('parse_mode','HTML');
 form.append('document',new Blob([await (await fetch(APK)).arrayBuffer()],{type:'application/vnd.android.package-archive'}),'1SHOT.apk');
 const r=await (await fetch(`https://api.telegram.org/bot${TOKEN}/sendDocument`,{method:'POST',body:form})).json();
 if(r?.ok)apkId=r.result?.document?.file_id||'';
}
// /smm: a hidden command for the club's SMM admin (table smm_bot_admins). It sends the ready posts from smm_posts:
// the picture as a file (full quality), the post text, then the story picture and its line. Emoji that exist in our
// pack (EMOJI_SET) go out as custom emoji; if Telegram refuses them, the same text goes out with plain emoji.
const SB=Deno.env.get('SUPABASE_URL')||'',SKEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const EMOJI_SET='oneshot_emoji_by_emojitengbot';
async function db(path:string){
 const r=await fetch(`${SB}/rest/v1/${path}`,{headers:{apikey:SKEY,Authorization:'Bearer '+SKEY}});
 return r.ok?await r.json():[];
}
const isSmm=async(id:number)=>Number.isSafeInteger(id)&&(await db(`smm_bot_admins?telegram_id=eq.${id}&select=telegram_id`)).length>0;
let emap:[string,string][]|null=null;
async function emojis(){
 if(emap)return emap;
 const r=await tg('getStickerSet',{name:EMOJI_SET});const seen=new Set<string>();const out:[string,string][]=[];
 for(const st of r?.result?.stickers||[]){const e=String(st.emoji||'').replace(/\uFE0F/g,'');if(e&&st.custom_emoji_id&&!seen.has(e)){seen.add(e);out.push([e,st.custom_emoji_id])}}
 if(r?.ok)emap=out;return out;
}
const esc=(t:string)=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
async function withEmoji(html:string){
 let s=html;
 for(const [e,id] of await emojis())s=s.replace(new RegExp(esc(e)+'\uFE0F?','gu'),m=>`<tg-emoji emoji-id="${id}">${m}</tg-emoji>`);
 return s;
}
async function sendText(chat:number,html:string){
 const base={chat_id:chat,parse_mode:'HTML',link_preview_options:{is_disabled:true}};
 const fancy=await withEmoji(html);
 if(fancy!==html){const r=await tg('sendMessage',{...base,text:fancy});if(r?.ok)return}
 const r=await tg('sendMessage',{...base,text:html});
 if(!r?.ok)await tg('sendMessage',{chat_id:chat,text:html.replace(/<[^>]+>/g,'')});
}
// Telegram takes documents by URL only for PDF/ZIP, so the picture is uploaded as a file.
async function sendFile(chat:number,url:string,caption:string){
 const img=await fetch(url);if(!img.ok){await tg('sendMessage',{chat_id:chat,text:'Не нашёл картинку: '+url});return}
 const form=new FormData();form.append('chat_id',String(chat));form.append('caption',caption);
 form.append('document',new Blob([await img.arrayBuffer()],{type:'image/jpeg'}),url.split('/').slice(-2).join('_'));
 await fetch(`https://api.telegram.org/bot${TOKEN}/sendDocument`,{method:'POST',body:form});
}
type Post={id:number,day:string,title:string,feed_image?:string,feed_text?:string,story_image?:string,story_text?:string};
const DAYS=['вс','пн','вт','ср','чт','пт','сб'];
const dayLabel=(d:string)=>{const t=new Date(d+'T12:00:00Z');return `${DAYS[t.getUTCDay()]} ${d.slice(8,10)}.${d.slice(5,7)}`};
async function sendPost(chat:number,p:Post){
 await tg('sendMessage',{chat_id:chat,text:`📌 <b>${p.title}</b> · ${dayLabel(p.day)}`,parse_mode:'HTML'});
 if(p.feed_image)await sendFile(chat,p.feed_image,'Картинка для поста');
 if(p.feed_text)await sendText(chat,p.feed_text);
 if(p.story_image)await sendFile(chat,p.story_image,'Картинка для сторис');
 if(p.story_text)await sendText(chat,p.story_text);
}
async function smmMenu(chat:number){
 const since=new Date(Date.now()+3*3600e3-86400e3).toISOString().slice(0,10);
 let posts:Post[]=await db(`smm_posts?day=gte.${since}&order=day.asc,id.asc&limit=8`);
 if(!posts.length)posts=await db('smm_posts?order=day.desc,id.desc&limit=3');
 if(!posts.length){await tg('sendMessage',{chat_id:chat,text:'Готовых постов пока нет.'});return}
 if(posts.length===1){await sendPost(chat,posts[0]);return}
 await tg('sendMessage',{chat_id:chat,text:'Какой пост прислать?',reply_markup:{inline_keyboard:posts.map(p=>[{text:`${dayLabel(p.day)} · ${p.title}`,callback_data:'smm:'+p.id}])}});
}
// Posts to every guest. The owner types /broadcast, sees the post exactly as guests will, then taps «Отправить всем».
const rest=(path:string,init:RequestInit={})=>fetch(`${SB}/rest/v1/${path}`,{...init,headers:{apikey:SKEY,authorization:'Bearer '+SKEY,'content-type':'application/json',...(init.headers||{})}});
const POST={key:'missyou-2026-11',text:'💚 <b>1SHOT соскучился!</b>\n\nЗаглядывай на пару катков — ПК уже прогреты 🖥🔥\n\nСвободные места видно прямо в приложении, бронь за пару касаний.\n\n📍 ул. Мира, 37 · 🕹 открыты 24/7'};
let postPhoto=MEDIA+'missyou.jpg';
// The picture goes as the first message's photo; Telegram's file_id is reused for the rest.
async function sendPostTo(chat:number){
 const r=await tg('sendPhoto',{chat_id:chat,photo:postPhoto,caption:POST.text,parse_mode:'HTML',reply_markup:postKeyboard});
 if(r?.ok)postPhoto=r.result?.photo?.at(-1)?.file_id||postPhoto;
 return r;
}
const postKeyboard={inline_keyboard:[[{text:'🎮 Забронировать ПК',web_app:{url:APP}}]]};
async function guests():Promise<number[]>{const r=await rest('profiles?telegram_id=gt.0&select=telegram_id');return r.ok?(await r.json()).map((x:{telegram_id:number})=>x.telegram_id):[]}
async function previewPost(chat:number){
 await sendPostTo(chat);
 const n=(await guests()).length;
 await tg('sendMessage',{chat_id:chat,text:`👆 Так сообщение увидят гости. Получателей: ${n}.`,reply_markup:{inline_keyboard:[[{text:`✅ Отправить всем ${n}`,callback_data:'bc_go'}]]}});
}
// Sends only once: the row must be approved in the database and not started yet; the first call marks it started,
// so a second tap or request finds nothing to claim and sends nothing.
async function broadcast(report?:number){
 const claim=await rest(`club_bot_broadcasts?key=eq.${POST.key}&approved=is.true&started_at=is.null`,{method:'PATCH',headers:{prefer:'return=representation'},body:JSON.stringify({started_at:new Date().toISOString()})});
 const rows=claim.ok?await claim.json():[];
 if(rows.length!==1){if(report)await tg('sendMessage',{chat_id:report,text:'Это сообщение уже отправлено или не одобрено, ничего не шлю.'});return {ok:false,reason:'not_claimed'}}
 let sent=0,failed=0;
 for(const id of new Set(await guests())){
  const r=await sendPostTo(id);
  r?.ok?sent++:failed++;
  await new Promise(res=>setTimeout(res,60));  // well under Telegram's 30 messages a second
 }
 await rest(`club_bot_broadcasts?key=eq.${POST.key}`,{method:'PATCH',body:JSON.stringify({sent,failed,finished_at:new Date().toISOString()})});
 if(report)await tg('sendMessage',{chat_id:report,text:`Готово ✅ Доставлено: ${sent}.`+(failed?` Не дошло: ${failed} (гость остановил или удалил бота).`:'')});
 return {ok:true,sent,failed};
}
// /stats for the owner: how many guests are in the mini-app and the bot, and how bookings go.
const seen=(id:number)=>rest('rpc/club_bot_seen',{method:'POST',body:JSON.stringify({p_id:id})}).catch(()=>{});
async function stats(chat:number){
 const r=await rest('rpc/club_bot_stats',{method:'POST',body:'{}'});const s=r.ok?await r.json():null;
 if(!s){await tg('sendMessage',{chat_id:chat,text:'Не получилось собрать статистику, попробуй ещё раз.'});return}
 const when=new Date().toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'});
 const text=`📊 <b>1SHOT · статистика</b>\n<i>${when} МСК</i>\n\n`+
  `📱 <b>Мини-апп:</b> ${s.miniapp} гостей (+${s.miniapp_week} за 7 дней)\n`+
  `🤖 <b>Бот может написать:</b> ${s.reachable} из ${s.miniapp}\n`+
  `💬 <b>Писали боту:</b> ${s.bot_users} (за 7 дней ${s.bot_week}), из них без мини-аппа ${s.bot_only}\n`+
  `🤳 <b>Android-приложение:</b> ${s.android}\n\n`+
  `🎮 <b>Брони:</b> сегодня ${s.bookings_today} · за 7 дней ${s.bookings_week}\n`+
  `✅ Пришли по брони за 7 дней: ${s.came_week}\n`+
  `👤 Бронировали за 7 дней: ${s.bookers_week} чел.`;
 await tg('sendMessage',{chat_id:chat,text,parse_mode:'HTML'});
}
// /smmnew: the next queued post (tg_photo set, not sent yet) as it will look in the channel: picture, caption with our
// custom emoji and the mini-app button. Below it «Опубликовать в канал» posts the same thing to CHANNEL (the bot must be
// a channel admin). Once a post has been sent here it leaves the queue; the /smmnew menu entry shows only while the
// queue is not empty (commands scoped to each SMM admin's chat, refreshed after every change and by GET ?smmcmd=1).
const CHANNEL='@oneshotmira17';
const MINIAPP='https://t.me/oneshotagent?startapp=channel';
async function dbPatch(path:string,body:unknown){
 await fetch(`${SB}/rest/v1/${path}`,{method:'PATCH',headers:{apikey:SKEY,Authorization:'Bearer '+SKEY,'content-type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(body)});
}
type QPost={id:number,title:string,tg_photo:string,tg_caption?:string,button_text?:string,button_url?:string,published_at?:string|null};
const queue=async()=>(await db('smm_posts?tg_photo=not.is.null&sent_at=is.null&order=day.asc,id.asc&limit=1')) as QPost[];
async function smmCommands(){
 const pending=(await queue()).length>0;
 for(const a of await db('smm_bot_admins?select=telegram_id')){
  const commands=[{command:'start',description:'Открыть 1SHOT'},{command:'app',description:'Приложение для Android'},{command:'smm',description:'Готовые посты'},{command:'stats',description:'Статистика'}];
  if(pending)commands.push({command:'smmnew',description:'Новый пост для канала'});
  await tg('setMyCommands',{commands,scope:{type:'chat',chat_id:a.telegram_id}});
 }
 return pending;
}
// Our style for the button: green with the 1SHOT emoji, where Telegram supports it; otherwise a plain button.
const btn=(p:QPost,fancy:boolean)=>({text:p.button_text||'🎮 Забронировать место',url:p.button_url||MINIAPP,...(fancy?{style:'success',icon_custom_emoji_id:'5384056395358315887'}:{})});
async function sendQ(chat:number|string,p:QPost,extra:unknown[][]=[]){
 const caption=p.tg_caption||'';const fancyCap=await withEmoji(caption);
 for(const [cap,fancy] of [[fancyCap,true],[caption,true],[caption,false]] as [string,boolean][]){
  const r=await tg('sendPhoto',{chat_id:chat,photo:p.tg_photo,caption:cap,parse_mode:'HTML',reply_markup:{inline_keyboard:[[btn(p,fancy)],...extra]}});
  if(r?.ok)return r;
  if(cap===caption&&!fancy)return r;
 }
}
async function smmNew(chat:number){
 const [p]=await queue();
 if(!p){await tg('sendMessage',{chat_id:chat,text:'Новых постов пока нет.'});await smmCommands();return}
 const r=await sendQ(chat,p,[[{text:'📢 Опубликовать в канал',callback_data:'pub:'+p.id}]]);
 if(r?.ok){await dbPatch(`smm_posts?id=eq.${p.id}`,{sent_at:new Date().toISOString()});await smmCommands()}
 else await tg('sendMessage',{chat_id:chat,text:'Не получилось отправить пост: '+String(r?.description||'')});
}
// Telegram lets bots send custom emoji in private chats and groups but not in channels, so a fresh sendPhoto to the
// channel loses them. Copying the preview the admin already has keeps the emoji (copy works like a forward without
// the «forwarded from» line); the button is attached again. A fresh send stays as the last resort.
async function copyPreview(src:number,msg:number,p:QPost){
 for(const fancy of [true,false]){
  const r=await tg('copyMessage',{chat_id:CHANNEL,from_chat_id:src,message_id:msg,reply_markup:{inline_keyboard:[[btn(p,fancy)]]}});
  if(r?.ok)return r;
 }
 return null;
}
async function publish(chat:number,id:string,msg?:number){
 const [p]=await db(`smm_posts?id=eq.${id}`) as QPost[];
 if(!p){await tg('sendMessage',{chat_id:chat,text:'Пост не найден.'});return}
 if(p.published_at){await tg('sendMessage',{chat_id:chat,text:'Этот пост уже опубликован.'});return}
 const r=(msg&&await copyPreview(chat,msg,p))||await sendQ(CHANNEL,p);
 if(r?.ok){await dbPatch(`smm_posts?id=eq.${id}`,{published_at:new Date().toISOString()});await tg('sendMessage',{chat_id:chat,text:'✅ Опубликовано в канале.'})}
 else await tg('sendMessage',{chat_id:chat,text:'Не вышло опубликовать: '+String(r?.description||'')+'\n\nПроверь, что бот добавлен в канал администратором с правом публиковать сообщения.'});
}
// Telegram signs every webhook call with this secret; it is derived from the bot token, never stored.
async function secret(){
 const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('1shot-bot:'+TOKEN));
 return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,48);
}
const WELCOME='👋 <b>Привет! Это 1SHOT</b> — компьютерный клуб в Мытищах\n📍 ул. Мира, 37 · 🕹 открыты 24/7\n\n'+
 '📱 <b>В приложении:</b>\n🖥 бронь ПК за пару касаний\n👀 видно, какие ПК свободны прямо сейчас\n🎁 акции и бонусы клуба\n\n👇 Жми «Открыть 1SHOT»';
const keyboard=(promo?:string)=>({inline_keyboard:[
 [{text:'🎮 Открыть 1SHOT',web_app:{url:APP+(promo?'?promo='+encodeURIComponent(promo):'')}}],
 [{text:'📞 Позвонить в клуб',callback_data:'call'},{text:'📢 Канал клуба',url:'https://t.me/oneshotmira17'}]]});
Deno.serve(async req=>{
 const url=new URL(req.url);
 if(!TOKEN)return ok({error:'no_token'});
 if(req.method==='GET'&&url.searchParams.get('setup')==='1'){
  return ok({
   webhook:await tg('setWebhook',{url:HOOK,secret_token:await secret(),allowed_updates:['message','callback_query'],drop_pending_updates:true}),
   menu:await tg('setChatMenuButton',{menu_button:{type:'web_app',text:'1SHOT',web_app:{url:APP}}}),
   commands:await tg('setMyCommands',{commands:[{command:'start',description:'Открыть 1SHOT'},{command:'app',description:'Приложение для Android'}]}),
   description:await tg('setMyDescription',{description:'Компьютерный клуб 1SHOT в Мытищах, 24/7. Бронь ПК, еда к столу, аренда девайсов и пакеты часов — в одном приложении.'}),
   short:await tg('setMyShortDescription',{short_description:'Компьютерный клуб 1SHOT · Мытищи · 24/7'}),
  });
 }
 if(req.method==='GET'&&url.searchParams.get('smmcmd')==='1')return ok({pending:await smmCommands()});
 if(req.method==='GET'&&url.searchParams.get('emojis')==='1')return ok(await emojis());
 // Starts the approved post (see broadcast()); without an approved, unstarted row it does nothing.
 if(req.method==='GET'&&url.searchParams.get('broadcast')===POST.key){
  const [admin]=await db('smm_bot_admins?select=telegram_id&limit=1');
  return ok(await broadcast(admin?.telegram_id));
 }
 // Checks which guests the bot can reach (getChat sends nothing to anyone); the answer holds only counts.
 if(req.method==='GET'&&url.searchParams.get('reach')==='1'){
  const rows=[];for(const id of new Set(await guests())){const r=await tg('getChat',{chat_id:id});rows.push({telegram_id:id,reachable:!!r?.ok,checked_at:new Date().toISOString()})}
  await rest('club_bot_reach',{method:'POST',headers:{prefer:'resolution=merge-duplicates'},body:JSON.stringify(rows)});
  return ok({checked:rows.length,reachable:rows.filter(r=>r.reachable).length});
 }
 // Notes the database queued (the PC queue): each row is claimed once, so a repeated call never sends twice.
 if(url.searchParams.get('outbox')==='1'){
  const r=await rest('club_bot_outbox?sent_at=is.null&created_at=gt.'+new Date(Date.now()-3600e3).toISOString(),{method:'PATCH',headers:{prefer:'return=representation'},body:JSON.stringify({sent_at:new Date().toISOString()})});
  const rows:{chat_id:number,text:string}[]=r.ok?await r.json():[];
  for(const m of rows)await tg('sendMessage',{chat_id:m.chat_id,text:m.text,parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'🎮 Открыть 1SHOT',web_app:{url:APP}}]]}}).catch(()=>{});
  return ok({sent:rows.length});
 }
 if(req.method!=='POST')return ok({ok:true});
 if(req.headers.get('x-telegram-bot-api-secret-token')!==await secret())return new Response('forbidden',{status:403});
 try{
  const update=await req.json(),msg=update?.message,cb=update?.callback_query;
  // «Позвонить»: a contact card, whose phone opens the dialer in one tap (Telegram buttons cannot hold tel: links).
  if(cb){
   await tg('answerCallbackQuery',{callback_query_id:cb.id});
   if(cb.data==='bc_go'&&cb.message?.chat?.id&&await isSmm(Number(cb.from?.id))){
    await tg('editMessageReplyMarkup',{chat_id:cb.message.chat.id,message_id:cb.message.message_id,reply_markup:{inline_keyboard:[]}});
    await broadcast(cb.message.chat.id);return ok({ok:true});
   }
   const pb=/^pub:(\d+)$/.exec(String(cb.data||''));
   if(pb&&cb.message?.chat?.id&&await isSmm(Number(cb.from?.id))){await publish(cb.message.chat.id,pb[1],cb.message.message_id);return ok({ok:true})}
   const sm=/^smm:(\d+)$/.exec(String(cb.data||''));
   if(sm&&cb.message?.chat?.id&&await isSmm(Number(cb.from?.id))){
    const [p]=await db(`smm_posts?id=eq.${sm[1]}`);if(p)await sendPost(cb.message.chat.id,p);
    return ok({ok:true});
   }
   if(cb.data==='call'&&cb.message?.chat?.id)await tg('sendContact',{chat_id:cb.message.chat.id,phone_number:PHONE,first_name:'1SHOT',last_name:'компьютерный клуб'});
   return ok({ok:true});
  }
  if(!msg?.chat?.id||msg.chat.type!=='private')return ok({ok:true});
  const text=String(msg.text||'').trim();
  await seen(msg.chat.id);
  if(/^\/stats(@\w+)?$/i.test(text)&&await isSmm(Number(msg.from?.id))){await stats(msg.chat.id);return ok({ok:true})}
  if(text==='/broadcast'&&await isSmm(Number(msg.from?.id))){await previewPost(msg.chat.id);return ok({ok:true})}
  if(/^\/smmnew(@\w+)?$/i.test(text)&&await isSmm(Number(msg.from?.id))){await smmNew(msg.chat.id);return ok({ok:true})}
  if(/^\/smm(@\w+)?$/i.test(text)&&await isSmm(Number(msg.from?.id))){await smmMenu(msg.chat.id);return ok({ok:true})}
  if(text.startsWith('/app')){await sendApp(msg.chat.id);return ok({ok:true})}
  if(text.startsWith('/start')){
   const raw=text.split(/\s+/)[1]||'';
   const promo=/^[A-Za-z0-9_-]{2,32}$/.test(raw)?raw.toUpperCase():'';
   const extra=promo?`\n\n🎁 Промокод <b>${promo}</b> уже подставлен: при регистрации получишь 1 час в STANDART.`:'';
   const fields={chat_id:msg.chat.id,caption:WELCOME+extra,parse_mode:'HTML',supports_streaming:true,width:720,height:1280,reply_markup:keyboard(promo)};
   const sent=videoId?await tg('sendVideo',{...fields,video:videoId,cover:COVER}):await uploadVideo(fields);
   if(sent?.ok)videoId=sent.result?.video?.file_id||videoId;
   // Without the video the greeting still goes out as text.
   else await tg('sendMessage',{chat_id:msg.chat.id,text:WELCOME+extra,parse_mode:'HTML',reply_markup:keyboard(promo)});
  }else{
   await tg('sendMessage',{chat_id:msg.chat.id,text:'Я бот-помощник 1SHOT. Бронь ПК и твой аккаунт — в приложении 👇\nЕсли нужен человек: +7 (495) 583-78-11',reply_markup:keyboard()});
  }
 }catch(_e){/* A broken update is dropped: Telegram must not retry it forever. */}
 return ok({ok:true});
});
