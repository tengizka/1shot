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
 if(req.method==='GET'&&url.searchParams.get('emojis')==='1')return ok(await emojis());
 if(req.method!=='POST')return ok({ok:true});
 if(req.headers.get('x-telegram-bot-api-secret-token')!==await secret())return new Response('forbidden',{status:403});
 try{
  const update=await req.json(),msg=update?.message,cb=update?.callback_query;
  // «Позвонить»: a contact card, whose phone opens the dialer in one tap (Telegram buttons cannot hold tel: links).
  if(cb){
   await tg('answerCallbackQuery',{callback_query_id:cb.id});
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
