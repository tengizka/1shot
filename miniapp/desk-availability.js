/* Read-only heartbeat gate. Reuses the existing poll; never changes sessions/bookings. */
(() => {
 const dialog=document.createElement('dialog');
 dialog.id='desk-availability';dialog.setAttribute('aria-labelledby','desk-availability-title');
 dialog.setAttribute('aria-describedby','desk-availability-copy');
 dialog.innerHTML=`<section><svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="6" y="9" width="36" height="25" rx="5"/><path d="M17 41h14M24 34v7M15 22h5l3-6 4 12 3-6h4"/></svg><h1 id="desk-availability-title">Проверяем связь с клубом</h1><p id="desk-availability-copy">Это займёт несколько секунд.</p><span class="desk-availability-pulse" aria-hidden="true"></span><a href="tel:+74955837811">Связаться с клубом</a></section>`;
 document.body.append(dialog);
 dialog.addEventListener('cancel',e=>e.preventDefault());
 const title=dialog.querySelector('h1'),copy=dialog.querySelector('p');
 title.setAttribute('aria-live','polite');
 let blocked=true,deadline=0,expiry=null,lastSample=-Infinity,reason='checking';
 function render(){
  dialog.dataset.state=reason;
  title.textContent=reason==='checking'?'Проверяем связь с клубом':reason==='network'?'Не удалось проверить связь':'Ведутся тех. работы';
  copy.textContent=reason==='checking'?'Это займёт несколько секунд.':reason==='network'?'Проверьте интернет или откройте приложение заново. Мы повторим проверку автоматически.':'Скоро вернёмся. Приложение откроется автоматически, когда связь восстановится.';
  // Keep the startup animation; gate all writes even while the splash is visible.
  if(blocked&&!document.getElementById('splash')?.classList.contains('active')){
   if(!dialog.open){document.querySelectorAll('dialog[open]').forEach(d=>{if(d!==dialog)d.close()});dialog.showModal();}
  }else if(!blocked&&dialog.open)dialog.close();
 }
 function block(next){blocked=true;reason=next;render();}
 function expire(){clearTimeout(expiry);expiry=null;deadline=0;block('maintenance');}
 window.deskAvailability={
  get blocked(){if(!blocked&&performance.now()>=deadline)expire();return blocked;},
  accept(desk,started){
   if(started<lastSample)return;lastSample=started;
   clearTimeout(expiry);expiry=null;
   if(!desk||typeof desk.online!=='boolean'||!Number.isFinite(desk.valid_for_ms)){
    deadline=0;block('network');return;
   }
   // Server duration minus the entire round trip: delayed replies cannot extend
   // the lease. The phone's wall clock is deliberately not used.
   const left=Math.min(30000,Math.max(0,desk.valid_for_ms))-(performance.now()-started);
   if(!desk.online||left<=0){expire();return;}
   deadline=performance.now()+left;blocked=false;render();expiry=setTimeout(expire,left);
  },
  failure(){if(performance.now()>=deadline){deadline=0;block(reason==='maintenance'?'maintenance':'network');}},
  guard(url,opts){
   if(!this.blocked||String(opts.method||'GET').toUpperCase()==='GET')return;
   let action;try{action=JSON.parse(opts.body||'{}').action}catch{/* Invalid writes remain blocked. */}
   const path=new URL(url,location.href).pathname;
   if(path.endsWith('/club-bookings')&&['capabilities','state','list','account'].includes(action))return;
   // Previously submitted authentication can finish; never replay the request.
   if(path.endsWith('/club-auth')&&action==='status')return;
   throw Error('Ведутся тех. работы. Дождитесь восстановления связи с клубом.');
  }
 };
 const splash=document.getElementById('splash');
 if(splash){const observer=new MutationObserver(()=>{render();if(!splash.classList.contains('active'))observer.disconnect()});observer.observe(splash,{attributes:true,attributeFilter:['class']});}
 document.addEventListener('visibilitychange',()=>{
  if(!document.hidden){clearTimeout(expiry);deadline=0;lastSample=performance.now();block('checking');}
 });
 window.addEventListener('offline',()=>{clearTimeout(expiry);deadline=0;lastSample=performance.now();block('network');});
 window.addEventListener('online',()=>{if(!document.hidden)window.dispatchEvent(new Event('club:resume'));});
 render();
})();
