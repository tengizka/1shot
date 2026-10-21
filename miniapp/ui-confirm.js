/* 2.3 · In-app confirmation instead of the Telegram/browser popups.
   uiConfirm('Завершить сеанс на ПК 13? Сохраните игру.', {ok:'Завершить', danger:true}) → Promise<boolean>.
   The text up to the first "?" becomes the heading, the rest the explanation. */
(()=>{
 let box=null,resolve=null;
 function build(){
  box=document.createElement('dialog');box.id='ui-confirm';box.className='ui-confirm';
  box.innerHTML='<h2></h2><p></p><div class="ui-confirm-actions"><button type="button" class="btn-main ok"></button><button type="button" class="ui-confirm-cancel">Отмена</button></div>';
  document.body.append(box);
  box.querySelector('.ok').onclick=()=>done(true);
  box.querySelector('.ui-confirm-cancel').onclick=()=>done(false);
  box.addEventListener('cancel',e=>{e.preventDefault();done(false)});
  box.addEventListener('click',e=>{if(e.target===box)done(false)});
 }
 function done(value){if(!resolve)return;const r=resolve;resolve=null;box.close();r(value)}
 window.uiConfirm=(message,{ok='Да',danger=false}={})=>{
  if(!box)build();if(resolve)done(false);
  const text=String(message||''),cut=text.indexOf('?');
  box.querySelector('h2').textContent=cut>0?text.slice(0,cut+1):text;
  const rest=cut>0?text.slice(cut+1).trim():'';const p=box.querySelector('p');p.textContent=rest;p.hidden=!rest;
  const btn=box.querySelector('.ok');btn.textContent=ok;btn.classList.toggle('danger',danger);
  try{window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('warning')}catch{}
  box.showModal();btn.blur();
  return new Promise(r=>resolve=r);
 };
})();
