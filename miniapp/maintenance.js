/* Maintenance: a full screen over the whole app; nothing behind it can be tapped or focused.
   To switch off: set ON to false (or drop this script). */
(()=>{
 const ON=true;
 if(!ON)return;
 const screen=document.createElement('div');screen.id='maintenance';screen.setAttribute('role','alert');
 screen.innerHTML=`<span class="smm-tag">1SHOT · Мытищи</span>
  <h1>Идут<br>техработы</h1>
  <p>Приложение временно недоступно. Брони и заказы сейчас не принимаются — скоро вернёмся.</p>
  <p class="mt-phone">Клуб работает как обычно<br><b>+7 (495) 583-78-11</b></p>`;
 const logo=document.querySelector('.auth-logo')?.cloneNode(true);
 if(logo){logo.removeAttribute('class');logo.classList.add('mt-logo');logo.setAttribute('focusable','false');logo.setAttribute('aria-hidden','true');screen.prepend(logo)}
 const lock=()=>{for(const el of document.body.children)if(el!==screen)el.inert=true};
 document.body.append(screen);document.body.classList.add('maintenance');lock();
 // Screens added later (splash, dialogs, toasts) are locked too.
 new MutationObserver(lock).observe(document.body,{childList:true});
})();
