// Telegram bot @oneshotagent: greets guests on /start and opens the 1SHOT mini-app.
// GET ?setup=1 points Telegram at this function and sets the menu button and descriptions (safe to repeat).
const TOKEN=Deno.env.get('TELEGRAM_BOT_TOKEN')||'';
const APP='https://tengizka.github.io/1shot/miniapp/';
const PHONE='+74955837811';
// The mini-app promo video (GitHub Pages, under Telegram's 20 MB fetch limit); after the first send Telegram's file_id is reused.
const VIDEO='https://tengizka.github.io/1shot/miniapp/media/bot-welcome.mp4';
let videoId=Deno.env.get('BOT_VIDEO_FILE_ID')||'';
// The first frames are black: Telegram shows this still («Теперь можно бронировать») until play.
const COVER='https://tengizka.github.io/1shot/miniapp/media/bot-cover.jpg';
const HOOK=(Deno.env.get('SUPABASE_URL')||'')+'/functions/v1/club-bot';
const ok=(body:unknown)=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
async function tg(method:string,body:unknown){
 const r=await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 return await r.json();
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
   commands:await tg('setMyCommands',{commands:[{command:'start',description:'Открыть 1SHOT'}]}),
   description:await tg('setMyDescription',{description:'Компьютерный клуб 1SHOT в Мытищах, 24/7. Бронь ПК, еда к столу, аренда девайсов и пакеты часов — в одном приложении.'}),
   short:await tg('setMyShortDescription',{short_description:'Компьютерный клуб 1SHOT · Мытищи · 24/7'}),
  });
 }
 if(req.method!=='POST')return ok({ok:true});
 if(req.headers.get('x-telegram-bot-api-secret-token')!==await secret())return new Response('forbidden',{status:403});
 try{
  const update=await req.json(),msg=update?.message,cb=update?.callback_query;
  // «Позвонить»: a contact card, whose phone opens the dialer in one tap (Telegram buttons cannot hold tel: links).
  if(cb){
   await tg('answerCallbackQuery',{callback_query_id:cb.id});
   if(cb.data==='call'&&cb.message?.chat?.id)await tg('sendContact',{chat_id:cb.message.chat.id,phone_number:PHONE,first_name:'1SHOT',last_name:'компьютерный клуб'});
   return ok({ok:true});
  }
  if(!msg?.chat?.id||msg.chat.type!=='private')return ok({ok:true});
  const text=String(msg.text||'').trim();
  if(text.startsWith('/start')){
   const raw=text.split(/\s+/)[1]||'';
   const promo=/^[A-Za-z0-9_-]{2,32}$/.test(raw)?raw.toUpperCase():'';
   const extra=promo?`\n\n🎁 Промокод <b>${promo}</b> уже подставлен: при регистрации получишь 1 час в STANDART.`:'';
   const sent=await tg('sendVideo',{chat_id:msg.chat.id,video:videoId||VIDEO,cover:COVER,caption:WELCOME+extra,parse_mode:'HTML',supports_streaming:true,width:720,height:1280,reply_markup:keyboard(promo)});
   if(sent?.ok)videoId=sent.result?.video?.file_id||videoId;
   // Without the video the greeting still goes out as text.
   else await tg('sendMessage',{chat_id:msg.chat.id,text:WELCOME+extra,parse_mode:'HTML',reply_markup:keyboard(promo)});
  }else{
   await tg('sendMessage',{chat_id:msg.chat.id,text:'Я бот-помощник 1SHOT. Бронь ПК и твой аккаунт — в приложении 👇\nЕсли нужен человек: +7 (495) 583-78-11',reply_markup:keyboard()});
  }
 }catch(_e){/* A broken update is dropped: Telegram must not retry it forever. */}
 return ok({ok:true});
});
