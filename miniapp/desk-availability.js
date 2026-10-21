/* Read-only heartbeat gate. Reuses the existing poll; never changes sessions/bookings. */
(() => {
 const dialog=document.createElement('dialog');
 dialog.id='desk-availability';dialog.setAttribute('aria-labelledby','desk-availability-title');
 dialog.setAttribute('aria-describedby','desk-availability-copy');
 dialog.innerHTML=`<section><div class="da-loader"></div><h1 id="desk-availability-title">Проверяем связь с клубом</h1><p id="desk-availability-copy">Это займёт несколько секунд.</p></section><a class="btn-main da-call" href="tel:+74955837811"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/></svg>Связаться с клубом</a>`;
 document.body.append(dialog);
 /* The 1SHOT logo keeps filling while the club is unreachable. */
 const loader=window.oneshotLoader?.build(dialog.querySelector('.da-loader'));
 const spin=on=>{if(!loader)return;if(on){if(!dialog.dataset.spinning){dialog.dataset.spinning='1';loader.set(0);loader.cycle()}}else{delete dialog.dataset.spinning;loader.stop()}};
 new MutationObserver(()=>spin(dialog.open)).observe(dialog,{attributes:true,attributeFilter:['open']});
 dialog.addEventListener('cancel',e=>e.preventDefault());
 const title=dialog.querySelector('h1'),copy=dialog.querySelector('#desk-availability-copy');
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
