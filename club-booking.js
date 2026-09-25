/* App-owned booking UI. Disabled until the backend is explicitly enabled. */
window.clubV2=false;
(() => {
 const state={host:null,mode:'arrival',kind:'range',part:'start',start:[18,0],end:[19,0],request:null,rows:[],busy:false,protocol:1,forFriend:false,account:null,accountTime:null};
 const statusNames={requested:'Ждём подтверждение клуба',waiting:'ПК пока занят · клуб уведомлён',holding:'Ваш ПК ждёт вас',checkin_pending:'Выполняем вход…',in_session:'Вы вошли · приятной игры',attention:'Бронь требует проверки',cancel_requested:'Снимаем бронь',cancelled:'Отменена',expired:'Время ожидания истекло',completed:'Завершена'};
 const terminal=new Set(['cancelled','expired','completed']);
 const sheet=document.createElement('dialog');sheet.id='club-booking';sheet.className='club-booking-dialog';
 sheet.innerHTML=`<div class="club-sheet-head"><span id="club-pc">БРОНЬ</span><button type="button" id="club-close" aria-label="Закрыть"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div><div id="club-create"><h2>Когда ждать тебя?</h2><div class="club-segments" id="club-modes"><button data-mode="instant" id="instant-mode" hidden>Войти сейчас</button><button data-mode="arrival">В течение часа</button><button data-mode="scheduled">Сегодня к…</button></div><div id="club-schedule" hidden><p class="club-note">Время клуба · Москва</p><p id="club-start" class="arrival-time"></p><div class="club-wheels"><div class="club-wheel" id="club-hours" role="listbox" tabindex="0" aria-label="Часы"></div><b>:</b><div class="club-wheel" id="club-minutes" role="listbox" tabindex="0" aria-label="Минуты"></div></div></div><p id="club-rules" class="club-note"></p><button id="club-submit" class="btn-main">Забронировать</button></div><div id="club-mine" hidden></div><p id="club-error" role="alert"></p><a class="club-help" href="tel:+74955837811">Если нужна помощь: +7 (495) 583-78-11</a>`;
 document.body.append(sheet);
 const $=id=>document.getElementById(id);
 const time=a=>a.map(n=>String(n).padStart(2,'0')).join(':');
 const fmt=v=>new Date(v).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'});
 const date=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'});
 async function call(action,data={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{return await apiFetch(`${SUPA}/club-bookings`,{method:'POST',signal:controller.signal,body:JSON.stringify({action,initData:tg?.initData||'',...data})})}finally{clearTimeout(timer)}}
 function open(){window.hallMotion?.cancel();if(!sheet.open)sheet.showModal()}
 function close(){if(!state.busy)sheet.close()}
 const handle=sheet.querySelector('.club-sheet-head');let drag=null;
 handle.addEventListener('pointerdown',e=>{if(e.target.closest('button')||state.busy||!e.isPrimary||(e.pointerType==='mouse'&&e.button!==0))return;e.preventDefault();drag={id:e.pointerId,x:e.clientX,y:e.clientY,t:performance.now()};handle.setPointerCapture(e.pointerId)});
 handle.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;const dy=e.clientY-drag.y;sheet.style.transform=`translateY(${Math.max(0,Math.min(100,dy*.45))}px)`});
 const finishDrag=e=>{if(!drag||e.pointerId!==drag.id)return;const dy=e.clientY-drag.y,dx=e.clientX-drag.x,elapsed=performance.now()-drag.t;sheet.style.transform='';if(e.type==='pointerup'&&dy>100&&dy>Math.abs(dx)*1.5&&elapsed>100&&elapsed<1800)close();drag=null};
 handle.addEventListener('pointerup',finishDrag);handle.addEventListener('pointercancel',finishDrag);
 $('club-close').onclick=close;sheet.addEventListener('cancel',e=>{if(state.busy)e.preventDefault()});
 function wheels(){['hours','minutes'].forEach((name,i)=>{const el=$('club-'+name);el.dataset.setting='true';el.scrollTop=state.start[i]/(i?5:1)*44;el.querySelectorAll('[role=option]').forEach((opt,n)=>opt.setAttribute('aria-selected',String(n*(i?5:1)===state.start[i])));setTimeout(()=>delete el.dataset.setting,100)})}
 function render(){
  $('club-pc').textContent='ПК '+state.host+' · БРОНЬ';$('club-error').textContent='';
  $('club-schedule').hidden=state.mode!=='scheduled';
  $('club-submit').textContent=state.mode==='instant'?'Войти в свой аккаунт':'Забронировать';
  document.querySelectorAll('[data-mode]').forEach(e=>e.setAttribute('aria-pressed',String(e.dataset.mode===state.mode)));
  $('club-start').textContent='К '+time(state.start)+' · ждём 30 минут';
  $('club-rules').textContent=state.mode==='arrival'?'Ждём вас в течение часа.':'';
  $('club-rules').hidden=state.mode!=='arrival';
 }
 document.querySelectorAll('[data-mode]').forEach(e=>e.onclick=()=>{state.mode=e.dataset.mode;if(state.mode==='instant')state.forFriend=false;state.request=null;render();wheels()});
 ['hours','minutes'].forEach((name,i)=>{
  const el=$('club-'+name),count=i?12:24;let timer;
  for(let n=0;n<count;n++){const opt=document.createElement('button');opt.type='button';opt.tabIndex=-1;opt.setAttribute('role','option');opt.textContent=String(n*(i?5:1)).padStart(2,'0');opt.onclick=()=>el.scrollTo({top:n*44,behavior:'smooth'});el.append(opt)}
  function select(){const n=Math.max(0,Math.min(count-1,Math.round(el.scrollTop/44)));state.start[i]=n*(i?5:1);state.request=null;el.querySelectorAll('[role=option]').forEach((o,j)=>o.setAttribute('aria-selected',String(n===j)));render()}
  el.addEventListener('scroll',()=>{if(el.dataset.setting)return;clearTimeout(timer);timer=setTimeout(select,90)});
  el.commitSelection=select;
  el.onkeydown=e=>{if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?count-1:state.start[i]/(i?5:1)+(e.key==='ArrowDown'?1:-1);el.scrollTop=Math.max(0,Math.min(count-1,n))*44;select()};
 });
 window.openClubBooking=(id)=>{
  if(liveHostStatus(hostsData[String(id)])!=='free'){window.showOccupied?.();return}
  state.host=String(id);state.forFriend=false;state.mode=liveHostStatus(hostsData[String(id)])==='free'?(state.protocol>=2&&!state.forFriend?'instant':'arrival'):'scheduled';state.kind='range';state.part='start';state.request=null;
  const soon=new Date(Date.now()+600000);state.start=[Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Moscow',hour:'2-digit',hourCycle:'h23'}).format(soon)),Math.floor(soon.getUTCMinutes()/5)*5];state.end=[(state.start[0]+1)%24,state.start[1]];
  $('club-create').hidden=false;$('club-mine').hidden=true;render();open();requestAnimationFrame(wheels);
 };
 $('club-submit').onclick=async()=>{
  if(state.busy)return;if(!tg?.initData){$('club-error').textContent='Откройте приложение через Telegram';return}
  if(liveHostStatus(hostsData[state.host])!=='free'){$('club-error').textContent='ПК сейчас недоступен. Выберите свободный компьютер';return}
  if(state.mode==='scheduled'){for(const name of ['hours','minutes'])$('club-'+name).commitSelection()}
  state.busy=true;$('club-submit').disabled=true;$('club-error').textContent='';
  state.request ||= crypto.randomUUID();
  const start=state.mode==='scheduled'?`${date()}T${time(state.start)}:00+03:00`:null;
  const end=start?new Date(Date.parse(start)+30*60000).toISOString():null;
  try{await call(state.protocol>=2?'create_v2':'create',{for_friend:state.forFriend,host_id:state.host,mode:state.mode,duration_kind:state.kind,starts_at:start,ends_at:end,client_request_id:state.request});state.request=null;await refresh();if(state.mode==='instant'){showMine();$('club-pc').textContent='ПОДКЛЮЧЕНИЕ'}else showMine();fetchHosts()}
  catch(e){$('club-error').textContent=clubText(e.message)||'Не удалось отправить бронь'}
  finally{state.busy=false;$('club-submit').disabled=false}
 };
 function mine(){
  const box=$('club-mine');box.replaceChildren();
  if(state.protocol>=2&&state.account?.session&&(!state.host||state.account.session.host_id===state.host))renderSession(box);
  const rows=state.rows.filter(b=>!terminal.has(b.status)&&(!state.host||b.host_id===state.host)&&!(b.status==='in_session'&&state.account?.session?.host_id===b.host_id));
  if(!rows.length&&!state.account?.session){const p=document.createElement('p');p.textContent='Активных броней пока нет';box.append(p)}
  rows.forEach(b=>{
   const card=document.createElement('section');card.className='club-reservation';
   const add=(tag,text,cl)=>{const e=document.createElement(tag);e.textContent=text;if(cl)e.className=cl;card.append(e);return e};
   add('h2','ПК '+b.host_id);if(b.instant&&!['attention','cancelled','expired'].includes(b.status)){add('strong','Подключаем ваш аккаунт…');box.append(card);return}add('strong',statusNames[b.status]||b.status);
   add('p',b.mode==='arrival'?`Ждём до ${fmt(b.hold_until)} МСК`:`Сегодня ${fmt(b.starts_at)} → ${b.duration_kind==='open'?'Как пойдёт':fmt(b.ends_at)} МСК`,'club-note');
   if(b.for_friend)add('p','Бронь старой версии · доступна отмена','club-note');
   if(b.status==='release_requested')add('p','Снимаем блокировку. Друг войдёт сам.','club-note');
   if(b.status==='holding'&&!b.for_friend&&b.protocol>=2&&['free','reserved'].includes(liveHostStatus(hostsData[b.host_id]))){
    const btn=add('button',b.for_friend?'Разблокировать для друга':'Войти в свой аккаунт','btn-main');btn.onclick=()=>{if(confirm(b.for_friend?'Друг уже у компьютера? Снять блокировку для его входа?':'Начать игровую сессию на ПК '+b.host_id+'?'))action(btn,b.for_friend?'release':'enter',{id:b.id})};
   }
   if(b.status==='holding'&&!(b.protocol>=2)&&['free','reserved'].includes(liveHostStatus(hostsData[b.host_id]))){
    add('p','Вы уже в клубе? Узнайте код в панели администратора.','club-note');
    const input=add('input','');input.inputMode='numeric';input.autocomplete='one-time-code';input.maxLength=6;input.placeholder='Код из клуба';input.setAttribute('aria-label','Шестизначный код присутствия');
    const btn=add('button','Я пришёл → Войти','btn-main');btn.onclick=()=>action(btn,'checkin',{id:b.id,code:input.value});
   }
   if(['requested','waiting','holding','attention','checkin_pending','release_requested','in_session'].includes(b.status)){const btn=add('button','Отменить бронь','club-cancel');btn.onclick=()=>{if(confirm('Отменить бронь ПК '+b.host_id+'?'))action(btn,'cancel',{id:b.id})}}

   box.append(card);
  });

 }
 async function action(btn,name,data){if(state.busy)return;state.busy=true;btn.disabled=true;$('club-error').textContent='';try{await call(name,data);await refresh();mine()}catch(e){$('club-error').textContent=clubText(e.message)}finally{state.busy=false;btn.disabled=false}}
 function showMine(){$('club-create').hidden=true;$('club-mine').hidden=false;$('club-pc').textContent='МОИ БРОНИ';$('club-error').textContent='';mine();open()}

 window.openOwnBooking=id=>{if(accountFresh()&&state.account?.session?.host_id===String(id)){state.host=String(id);showMine();return true}if(state.rows.some(b=>b.host_id===String(id)&&!terminal.has(b.status))){state.host=String(id);showMine();return true}return false};
 const sessionBanner=document.createElement('button');sessionBanner.id='my-session-banner';sessionBanner.className='my-session-banner';sessionBanner.type='button';sessionBanner.hidden=true;sessionBanner.innerHTML='<span><strong>Моя сессия</strong><small></small></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
 document.querySelector('.app-header').insertAdjacentElement('afterend',sessionBanner);
 sessionBanner.onclick=()=>{state.host=null;showMine();$('club-pc').textContent='МОЯ СЕССИЯ'};
 function renderSessionBanner(){const current=state.account?.session;sessionBanner.hidden=!current;document.getElementById('app').classList.toggle('has-session',!!current);if(current){sessionBanner.querySelector('small').textContent='ПК '+current.host_id+(accountFresh()?' · управление и завершение':' · данные обновляются');}}
 function renderSession(box){
  const current=state.account.session;const card=document.createElement('section');card.className='club-reservation current-session';
  const title=document.createElement('h2');title.textContent=(accountFresh()?'Вы играете · ПК ':'Последняя сессия · ПК ')+current.host_id;card.append(title);
  const p=document.createElement('p');p.className='club-note';p.textContent=current.last_login?'Начало '+fmt(current.last_login)+' МСК':'Время начала сессии пока недоступно';card.append(p);
  const balance=document.createElement('p');balance.textContent=accountFresh()&&Number.isFinite(state.account.balance)?'Баланс клуба: '+state.account.balance+' ₽':'Баланс обновляется';card.append(balance);
  const exit=document.createElement('button');exit.className='btn-main';exit.textContent='Завершить мою сессию';exit.disabled=!current.key||!accountFresh();
  exit.onclick=async()=>{if(!confirm('Выйти из аккаунта на ПК '+current.host_id+'? Сохраните игру перед выходом.'))return;exit.disabled=true;try{await command('logout',{session_key:current.key});$('club-error').textContent='Команда отправлена. Ждём подтверждение клуба.'}catch(e){$('club-error').textContent=clubText(e.message)}finally{exit.disabled=false}};
  card.append(exit);box.append(card);
 }
 let accountSetup=false,accountPending=false;
 function accountFresh(){return !!state.accountTime&&Date.now()-Date.parse(state.accountTime)<45000}
 function setupAccount(){
  if(accountSetup)return;accountSetup=true;
  const box=document.createElement('section');box.className='account-tools';
  box.innerHTML='<h3>Игровая статистика</h3><div id="profile-stats" class="profile-stat-grid"></div><p id="stats-period" class="club-note"></p><h3>Данные аккаунта</h3><form id="edit-account"><label>Никнейм<input name="username" minlength="3" maxlength="30" autocomplete="username" required></label><label>Имя<input name="firstName" maxlength="45"></label><label>Фамилия<input name="lastName" maxlength="45"></label><label>Email<input name="email" type="email" maxlength="254"></label><label>Телефон<input name="mobilePhone" maxlength="20"></label><label>Дата рождения · только просмотр<input id="account-birthday" readonly></label><button class="btn-main">Сохранить изменения</button></form><button id="request-password" class="btn-main">Сменить / восстановить пароль через администратора</button><p id="password-result" role="status"></p><p id="account-result" role="status"></p>';
  document.querySelector('#mini-build').before(box);document.querySelector('#mini-build').before(document.querySelector('#ov-profile .btn-danger'));
  $('edit-account').onsubmit=async e=>{e.preventDefault();if(!confirm('Сохранить данные аккаунта в клубе? Новый никнейм будет использоваться для входа на ПК.'))return;const btn=e.target.querySelector('button');btn.disabled=true;try{const requested=await command('profile_edit',Object.fromEntries(new FormData(e.target)));e.target.dataset.pendingId=requested.id;$('account-result').textContent='Запрос отправлен в клуб'}catch(error){$('account-result').textContent=clubText(error.message)}finally{btn.disabled=false}};
  $('request-password').onclick=async()=>{if(!confirm('Запросить смену пароля у администратора? В клубе потребуется подтвердить личность.'))return;try{await command('password_request',{});$('password-result').textContent='Администратор получил запрос. Обратитесь к нему в клубе.'}catch(error){$('account-result').textContent=clubText(error.message)}};
  refreshAccount();
 }
 async function command(kind,payload){return call('command',{kind,payload,request_id:crypto.randomUUID()})}
 async function refreshAccount(){
  if(document.hidden||state.protocol<2||accountPending||!profile||!tg?.initData)return;accountPending=true;
  try{
   const res=await call('account');state.account=res.account?.data||null;state.accountTime=res.account?.updated_at;
   const data=state.account;
   if(data){
    const stats=$('profile-stats');if(stats){stats.replaceChildren();const stat=document.createElement('p');stat.textContent='Игровое время';const value=document.createElement('strong');value.textContent=Number.isFinite(data.statistics?.hours)?data.statistics.hours.toLocaleString('ru-RU',{maximumFractionDigits:1})+' ч':'Нет данных';stat.append(value);stats.append(stat);$('stats-period').textContent=data.statistics?.from&&data.statistics?.to?'Период · '+new Date(data.statistics.from).toLocaleDateString('ru-RU')+' — '+new Date(data.statistics.to).toLocaleDateString('ru-RU'):'Ожидаем статистику клуба';}

    profile.username=data.username||profile.username;profile.first_name=data.firstName||res.telegram?.first_name||profile.first_name;profile.last_name=data.lastName||'';
    profile.balance=accountFresh()&&typeof data.balance==='number'?data.balance:null;fillProfile();
    if(accountFresh())$('balance-note').textContent='Баланс клуба · обновлён '+fmt(state.accountTime)+' МСК';
    const form=$('edit-account');if(form&&!form.contains(document.activeElement)&&!form.dataset.dirty){for(const key of ['username','firstName','lastName','email','mobilePhone'])form.elements[key].value=data[key]||'';$('account-birthday').value=data.birthDate?String(data.birthDate).slice(0,10):'Нет данных'}
    if(form&&!form.dataset.listening){form.dataset.listening='1';form.addEventListener('input',()=>form.dataset.dirty='1')}
   }
   const photo=res.telegram?.photo_url,avatar=document.querySelector('.prof-ava');
   if(photo&&avatar&&avatar.dataset.photo!==photo){const img=document.createElement('img');img.src=photo;img.alt='Аватар Telegram';img.referrerPolicy='no-referrer';img.onerror=()=>{avatar.textContent=(profile.first_name||profile.username||'?')[0].toUpperCase()};avatar.replaceChildren(img);avatar.dataset.photo=photo}
   else if(avatar&&!photo)avatar.textContent=(profile.first_name||profile.username||'?')[0].toUpperCase();
   const passwordRequest=res.password_request||res.commands?.find(c=>c.kind==='password_request');if($('password-result')){$('password-result').textContent=passwordRequest?(clubText(passwordRequest.message)||({awaiting_admin:'Заявка ожидает администратора',done:'Услуга предоставлена',rejected:'Заявка закрыта без выполнения'}[passwordRequest.status]||'Заявка обрабатывается')):'';$('password-result').dataset.status=passwordRequest?.status||'';}
   renderSessionBanner();
   const latest=res.commands?.find(c=>!['logout','password_request'].includes(c.kind));if($('account-result'))$('account-result').textContent=!latest||latest.status==='done'?'':clubText(latest.message)||({queued:'Запрос ожидает обработки',running:'Выполняется',awaiting_admin:'Ожидает администратора',done:'Выполнено',attention:'Нужна проверка администратора'}[latest.status]||latest.status);
   if(latest?.kind==='profile_edit'&&latest.status==='done'&&latest.id===$('edit-account')?.dataset.pendingId){delete $('edit-account').dataset.dirty;delete $('edit-account').dataset.pendingId;}
   if(sheet.open&&!$('club-mine').hidden&&!state.busy)mine();
  }catch{if(profile){profile.balance=null;fillProfile()}renderSessionBanner()}
  finally{accountPending=false}
 }
 let fetching=false;
 async function refresh(){
  if(document.hidden||fetching||!window.clubV2||!profile||!tg?.initData)return;fetching=true;
  try{const res=await call('list');const changed=JSON.stringify(state.rows)!==JSON.stringify(res.bookings||[]);state.rows=res.bookings||[];window.instantHostIds=new Set(state.rows.filter(b=>b.instant&&['requested','holding','checkin_pending'].includes(b.status)).map(b=>b.host_id));window.ownBookingIds=new Set(state.rows.filter(b=>!terminal.has(b.status)).map(b=>b.host_id));if(changed){renderHall()}if(changed&&sheet.open&&!$('club-mine').hidden)mine()}
  catch{/* A failed refresh never frees an owned PC in the UI. */}
  finally{fetching=false}
 }
 async function init(){try{const c=await call('capabilities');window.clubV2=!!c.enabled;state.protocol=c.protocol||1;$('instant-mode').hidden=state.protocol<2;if(state.protocol>=2)setupAccount();if(window.clubV2){renderHall();refresh()}}catch{/* Keep the UI usable while the club reconnects. */}}
 init();setInterval(refresh,5000);setInterval(refreshAccount,10000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){init();refresh()}});
})();
