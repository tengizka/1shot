/* Maintenance: a full screen over the whole app; nothing behind it can be tapped or focused.
   To switch off: set ON to false (or drop this script). */
(()=>{
 const ON=true;
 if(!ON)return;
 const screen=document.createElement('div');screen.id='maintenance';screen.setAttribute('role','alert');
 screen.innerHTML=`<span class="smm-tag">1SHOT · Мытищи</span>
  <h1>Идут<br>техработы</h1>
  <p>Приложение временно недоступно. Брони и заказы сейчас не принимаются — скоро вернёмся.</p>
  <p class="mt-phone">Клуб работает как обычно</p>
  <div class="mt-actions"><a class="mt-call" href="tel:+74955837811">+7 (495) 583-78-11</a><button type="button" class="mt-copy">Скопировать</button></div>`;
 // Club photos behind the text, one after another (vertical shots first on phones, as on the landing).
 const wide=matchMedia('(min-aspect-ratio: 1/1)').matches;
 const photos=document.createElement('div');photos.className='mt-photos';photos.setAttribute('aria-hidden','true');
 for(const n of wide?[1,2]:[3,4,1,2]){const img=document.createElement('img');img.src='../landing/club-'+n+'.webp';img.alt='';img.decoding='async';photos.append(img)}
 photos.firstChild.classList.add('on');screen.prepend(photos);
 let shown=0;setInterval(()=>{const all=photos.children;all[shown].classList.remove('on');shown=(shown+1)%all.length;all[shown].classList.add('on')},5000);
 const copy=screen.querySelector('.mt-copy');
 copy.onclick=async()=>{try{await navigator.clipboard.writeText('+74955837811');copy.textContent='Скопировано'}catch{copy.textContent='+74955837811'}setTimeout(()=>copy.textContent='Скопировать',2500)};
 const logo=document.querySelector('.auth-logo')?.cloneNode(true);
 if(logo){logo.removeAttribute('class');logo.classList.add('mt-logo');logo.setAttribute('focusable','false');logo.setAttribute('aria-hidden','true');screen.append(logo)}
 const lock=()=>{for(const el of document.body.children)if(el!==screen)el.inert=true};
 document.body.append(screen);document.body.classList.add('maintenance');lock();
 // Screens added later (splash, dialogs, toasts) are locked too.
 new MutationObserver(lock).observe(document.body,{childList:true});
})();
