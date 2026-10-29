/* 1SHOT top-up: the balance chip sits on top of every section, a tap on it (or «Пополнить» in the profile) opens the top-up sheet.
 * Payment: Desk asks Gizmo for a deposit payment intent, the guest pays on the T-Bank page, Gizmo credits the deposit. */
(()=>{
 const tg=window.Telegram?.WebApp;
 const AMOUNTS=[500,700,1000,2000,3000];
 // The club's top-up promotion (Клуб → Акции): one payment of at least this sum brings these hours.
 const BONUS=[[3000,'6h STD или 3h VIP или 3h TV'],[2000,'4h STD или 2h VIP или 2h TV'],[1000,'2h STD или 1h VIP или 1h TV'],[700,'1h STD']];
 const MIN=100,MAX=50000;
 const CARD='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>';
 const $=id=>document.getElementById(id);
 const rub=n=>n.toLocaleString('ru-RU')+' ₽';
 let dialog,amount=1000,busy=false;

 function balanceText(){
  const value=$('ui-balance')?.textContent||'';
  return $('ui-currency')?.hidden===false?value+' ₽':value;
 }
 function syncChips(){for(const chip of document.querySelectorAll('.ov-balance span'))chip.textContent=balanceText()}

 function build(){
  dialog=document.createElement('dialog');dialog.id='topup';dialog.className='topup';
  dialog.innerHTML=`<button type="button" class="topup-close" aria-label="Закрыть">×</button>
   <h2>Пополнить<br>баланс</h2><p class="topup-now"></p>
   <label class="topup-sum"><input id="topup-amount" type="text" inputmode="numeric" autocomplete="off" aria-label="Сумма пополнения"><span>₽</span></label>
   <div class="topup-chips">${AMOUNTS.map(a=>`<button type="button" data-sum="${a}">${a.toLocaleString('ru-RU')}</button>`).join('')}</div>
   <p class="topup-bonus" hidden></p><p class="topup-msg" role="status"></p>
   <button type="button" class="btn-main topup-pay"></button>`;
  document.body.append(dialog);
  const input=dialog.querySelector('#topup-amount');
  input.addEventListener('input',()=>{const n=parseInt(input.value.replace(/\D/g,''),10);amount=Number.isFinite(n)?Math.min(n,MAX):0;input.value=amount?amount.toLocaleString('ru-RU'):'';paint()});
  dialog.querySelector('.topup-chips').addEventListener('click',e=>{const b=e.target.closest('[data-sum]');if(!b)return;amount=+b.dataset.sum;input.value=amount.toLocaleString('ru-RU');paint()});
  dialog.querySelector('.topup-close').addEventListener('click',close);
  dialog.addEventListener('click',e=>{if(e.target===dialog)close()});
 }
 function paint(){
  const ok=amount>=MIN;
  for(const b of dialog.querySelectorAll('[data-sum]'))b.classList.toggle('on',+b.dataset.sum===amount);
  const bonus=BONUS.find(([from])=>amount>=from);
  const line=dialog.querySelector('.topup-bonus');line.hidden=!bonus;
  if(bonus)line.innerHTML='<b>+ в подарок</b>'+bonus[1];
  const btn=dialog.querySelector('.topup-pay');btn.onclick=pay;
  btn.textContent=ok?'Оплатить '+rub(amount):'От '+rub(MIN);btn.disabled=!ok||busy;
 }
 function say(text,kind=''){const m=dialog.querySelector('.topup-msg');m.textContent=text;m.dataset.kind=kind}
 function open(){
  if(!dialog)build();
  dialog.querySelector('.topup-now').textContent='Сейчас на балансе: '+balanceText();
  dialog.querySelector('#topup-amount').value=amount.toLocaleString('ru-RU');say('');paint();
  if(!dialog.open)dialog.showModal();
  tg?.HapticFeedback?.impactOccurred?.('light');
 }
 function close(){if(dialog?.open)dialog.close()}

 const call=(action,data={})=>apiFetch(`${SUPA}/club-bookings`,{method:'POST',body:JSON.stringify({action,initData:tg?.initData||'',...data})});
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const clean=t=>(window.clubText?clubText(String(t||'')):String(t||'')).replace(/^HTTP \d+:\s*/,'');
 function openPay(url){
  if(tg?.openLink)tg.openLink(url);else window.open(url,'_blank','noopener');
  const btn=dialog.querySelector('.topup-pay');btn.textContent='Открыть оплату ещё раз';btn.disabled=false;btn.onclick=()=>openPay(url);
  say('Оплати на странице Т-Банка. Деньги придут на баланс сами, как только оплата пройдёт','ok');
  // Back from the bank: the balance refreshes a few times while Gizmo credits the deposit.
  const back=()=>{if(document.hidden)return;document.removeEventListener('visibilitychange',back);for(const t of [1500,8000,20000,45000])setTimeout(()=>dispatchEvent(new Event('club:resume')),t)};
  document.addEventListener('visibilitychange',back);
 }
 // Desk asks Gizmo for a deposit payment intent and returns the T-Bank link as the command result.
 async function pay(){
  if(busy||amount<MIN)return;
  busy=true;paint();say('');const btn=dialog.querySelector('.topup-pay');btn.textContent='Готовим оплату…';
  let text='';
  try{
   const {id}=await call('command',{kind:'topup',payload:{amount},request_id:crypto.randomUUID()});
   const until=Date.now()+30000;
   while(Date.now()<until){
    await sleep(1500);
    const c=(await call('account')).commands?.find(x=>x.id===id);
    if(c?.status==='done'&&/^https:\/\//.test(c.message||'')){busy=false;return openPay(c.message)}
    if(c&&['attention','rejected','failed'].includes(c.status)){text=/Неизвестная операция/.test(c.message||'')?'Онлайн-оплата заработает после обновления Desk в клубе':clean(c.message)||'Не получилось создать оплату';break}
   }
   text=text||'Клуб не ответил. Попробуй ещё раз через минуту';
  }catch(e){text=clean(e?.message)||'Не получилось открыть оплату. Попробуй ещё раз'}
  busy=false;paint();say(text,'err');
 }

 // Paused while the club sorts out taxes: the balance stays visible, but nothing opens a payment.
 const PAUSED=true;
 function mount(){
  if(PAUSED){window.oneshotTopup={open(){},close(){}};return}
  const chip=document.querySelector('.app-header .balance-chip');
  if(chip&&!chip.dataset.topup){chip.dataset.topup='1';chip.setAttribute('role','button');chip.tabIndex=0;chip.setAttribute('aria-label','Баланс, пополнить');chip.addEventListener('click',open)}
  for(const head of document.querySelectorAll('.overlay .ov-head')){
   if(head.querySelector('.ov-balance'))continue;
   const b=document.createElement('button');b.type='button';b.className='balance-chip ov-balance';b.setAttribute('aria-label','Баланс, пополнить');
   b.innerHTML=CARD+'<span></span>';b.addEventListener('click',open);head.append(b);
  }
  const card=document.querySelector('#ov-profile .bal-card');
  if(card&&!card.querySelector('.bal-topup')){
   const b=document.createElement('button');b.type='button';b.className='bal-topup';b.textContent='Пополнить';b.addEventListener('click',open);card.append(b);
  }
  syncChips();
  const src=$('ui-balance');if(src)new MutationObserver(syncChips).observe(src,{childList:true,characterData:true,subtree:true});
  const cur=$('ui-currency');if(cur)new MutationObserver(syncChips).observe(cur,{attributes:true});
 }
 window.oneshotTopup={open,close};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
