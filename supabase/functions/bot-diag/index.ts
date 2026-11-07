// Diagnostics for the club bot: webhook state and whether the bot can post in the channel. Returns no secrets.
const TOKEN=Deno.env.get('TELEGRAM_BOT_TOKEN')||'';
const tg=async(m:string,b:unknown={})=>(await fetch(`https://api.telegram.org/bot${TOKEN}/${m}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)})).json();
Deno.serve(async()=>{
 const me=await tg('getMe');const h=await tg('getWebhookInfo');
 const w=h.result||{};
 const chat=await tg('getChat',{chat_id:'@oneshotmira17'});
 const member=me.ok?await tg('getChatMember',{chat_id:'@oneshotmira17',user_id:me.result.id}):null;
 return new Response(JSON.stringify({bot:me.result?.username,webhook:{url:w.url,pending:w.pending_update_count,last_error:w.last_error_message,last_error_date:w.last_error_date,allowed:w.allowed_updates},channel:{ok:chat.ok,title:chat.result?.title,err:chat.description},member:member&&{ok:member.ok,status:member.result?.status,can_post:member.result?.can_post_messages,err:member.description}}),{headers:{'content-type':'application/json'}});
});
