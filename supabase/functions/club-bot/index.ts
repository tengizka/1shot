// Telegram bot @oneshotagent: greets guests on /start and opens the 1SHOT mini-app.
// GET ?setup=1 points Telegram at this function and sets the menu button and descriptions (safe to repeat).
const TOKEN=Deno.env.get('TELEGRAM_BOT_TOKEN')||'';
const APP='https://tengizka.github.io/1shot/miniapp/';
const CALL='https://tengizka.github.io/1shot/call.html';
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
const WELCOME='<b>Привет! Это 1SHOT</b> — компьютерный клуб в Мытищах, ул. Мира, 37. Открыты 24/7.\n\n'+
 'В приложении:\n• бронь ПК за пару касаний\n• еда и напитки прямо к твоему ПК\n• аренда мышек, коврика и повербанка\n• пакеты часов и бонусы за пополнение';
const keyboard=(promo?:string)=>({inline_keyboard:[
 [{text:'Открыть 1SHOT',web_app:{url:APP+(promo?'?promo='+encodeURIComponent(promo):'')}}],
 [{text:'Позвонить в клуб',url:CALL},{text:'Канал клуба',url:'https://t.me/oneshotmira17'}]]});
Deno.serve(async req=>{
 const url=new URL(req.url);
 if(!TOKEN)return ok({error:'no_token'});
 if(req.method==='GET'&&url.searchParams.get('setup')==='1'){
  return ok({
   webhook:await tg('setWebhook',{url:HOOK,secret_token:await secret(),allowed_updates:['message'],drop_pending_updates:true}),
   menu:await tg('setChatMenuButton',{menu_button:{type:'web_app',text:'1SHOT',web_app:{url:APP}}}),
   commands:await tg('setMyCommands',{commands:[{command:'start',description:'Открыть 1SHOT'}]}),
   description:await tg('setMyDescription',{description:'Компьютерный клуб 1SHOT в Мытищах, 24/7. Бронь ПК, еда к столу, аренда девайсов и пакеты часов — в одном приложении.'}),
   short:await tg('setMyShortDescription',{short_description:'Компьютерный клуб 1SHOT · Мытищи · 24/7'}),
  });
 }
 if(req.method!=='POST')return ok({ok:true});
 if(req.headers.get('x-telegram-bot-api-secret-token')!==await secret())return new Response('forbidden',{status:403});
 try{
  const update=await req.json(),msg=update?.message;
  if(!msg?.chat?.id||msg.chat.type!=='private')return ok({ok:true});
  const text=String(msg.text||'').trim();
  if(text.startsWith('/start')){
   const raw=text.split(/\s+/)[1]||'';
   const promo=/^[A-Za-z0-9_-]{2,32}$/.test(raw)?raw.toUpperCase():'';
   const extra=promo?`\n\n🎁 Промокод <b>${promo}</b> уже подставлен: при регистрации получишь 1 час в STANDART.`:'';
   await tg('sendMessage',{chat_id:msg.chat.id,text:WELCOME+extra,parse_mode:'HTML',reply_markup:keyboard(promo)});
  }else{
   await tg('sendMessage',{chat_id:msg.chat.id,text:'Я бот-помощник 1SHOT. Бронь, еда, аренда и твой аккаунт — в приложении 👇\nЕсли нужен человек: +7 (495) 583-78-11',reply_markup:keyboard()});
  }
 }catch(_e){/* A broken update is dropped: Telegram must not retry it forever. */}
 return ok({ok:true});
});
