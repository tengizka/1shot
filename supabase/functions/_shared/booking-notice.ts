// The guest gets a short note from @oneshotagent when a booking is made (needs the bot started once).
export async function notifyBooked(chat: number, b: {host_id:string,starts_at?:string|null,hold_until?:string|null,instant?:boolean}) {
 const token=Deno.env.get('TELEGRAM_BOT_TOKEN');if(!token||chat<0)return;  // app guests (negative id) have no bot chat
 const msk=(iso?:string|null)=>iso?new Date(iso).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}):'';
 const day=(iso?:string|null)=>{if(!iso)return '';const f=(d:Date)=>d.toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'});return f(new Date(iso))===f(new Date())?'сегодня':'завтра'};
 const pc=b.host_id==='1'?'PS5':'ПК '+b.host_id;
 const text=b.instant
  ?`✅ <b>${pc} твой!</b>\nДержим до ${msk(b.hold_until)}. Подходи и садись 🎮`
  :`✅ <b>${pc} забронирован</b>\n🕒 ${day(b.starts_at)} в ${msk(b.starts_at)}\n📍 1SHOT, Мытищи, ул. Мира, 37\n\nЕсли планы поменяются, отмени бронь в приложении.`;
 await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',signal:AbortSignal.timeout(3500),headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chat,text,parse_mode:'HTML'})});
}
