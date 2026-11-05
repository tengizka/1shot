/* After a booking: if the bot cannot write to the guest yet (never pressed «Старт» or blocked it), Telegram's own
   «Allow messages» popup appears, so booking notices and club news reach them. Guests the bot already reaches never
   see it. Declined: asked again only after 3 days. */
(()=>{
 const tg=window.Telegram?.WebApp;
 if(!tg?.initData||window.ONESHOT_APP||typeof tg.requestWriteAccess!=='function'||!tg.isVersionAtLeast?.('6.9'))return;
 const KEY='1shot_bot_access';
 const read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return {}}};
 const write=v=>{try{localStorage.setItem(KEY,JSON.stringify(v))}catch{}};
 const reach=()=>apiFetch(`${SUPA}/club-bookings`,{method:'POST',body:JSON.stringify({action:'bot_reach',initData:tg.initData})});
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 // Waits for the «Ждём вас» card to open and close, so the popup never lands on top of it.
 async function afterWelcome(){
  const card=()=>document.getElementById('bk-welcome');
  for(let t=0;t<30&&!card()?.open;t++)await sleep(500);
  while(card()?.open)await sleep(400);
  await sleep(500);
 }
 let busy=false;
 async function check(e){
  const s=read();
  if(busy||s.ok||(s.asked&&Date.now()-s.asked<3*864e5))return;
  busy=true;
  try{
   if((await reach())?.reachable){write({ok:true});return}
   if(e?.detail?.mode==='instant')await sleep(2500);else await afterWelcome();
   tg.requestWriteAccess(allowed=>{write(allowed?{ok:true}:{asked:Date.now()});if(allowed)reach().catch(()=>{})});
  }catch{}finally{busy=false}
 }
 addEventListener('club:booked',check);
})();
