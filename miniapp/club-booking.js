/* App-owned booking UI. Disabled until the backend is explicitly enabled. */
window.clubV2=false;
(() => {
 const state={host:null,mode:'arrival',kind:'range',part:'start',start:[18,0],end:[19,0],request:null,rows:[],busy:false,protocol:1,forFriend:false,account:null,accountTime:null};
 const statusNames={requested:'Ждём тебя',waiting:'ПК пока занят · освободим к приходу',holding:'ПК ждёт тебя',checkin_pending:'Входим в аккаунт…',in_session:'Ты в игре',attention:'Подойди к администратору',cancel_requested:'Снимаем бронь',cancelled:'Отменена',expired:'Время ожидания истекло',completed:'Завершена'};
 const terminal=new Set(['cancelled','expired','completed']);
 const sheet=document.createElement('dialog');sheet.id='club-booking';sheet.className='club-booking-dialog';
 sheet.innerHTML=`<div class="club-sheet-head"><span id="club-pc">БРОНЬ</span><button type="button" id="club-close" aria-label="Закрыть"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div><div id="club-create"><div class="bk-hero"><span class="bk-room" id="bk-room"></span><h2 id="bk-title"></h2><p class="bk-specs" id="bk-specs"></p></div><button type="button" class="bk-now" data-mode="instant" id="instant-mode" hidden><span><b>Войти сейчас</b><small>Уже в клубе? Садись, аккаунт откроется сам</small></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button><div class="bk-later"><div class="bk-label-row"><p class="bk-label" id="bk-label">Забронировать</p><button type="button" class="bk-all-open" id="bk-all-open" aria-label="Все время" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button></div><div class="bk-slots" id="bk-slots" role="listbox" aria-label="Когда придёшь"></div><div class="bk-all" id="bk-all" hidden></div></div><p id="club-rules" class="club-note"></p><button id="club-submit" class="btn-main">Забронировать</button></div><div id="club-mine" hidden></div><p id="club-error" role="alert"></p><a class="club-help" href="tel:+74955837811">Если нужна помощь: +7 (495) 583-78-11</a>`;
 document.body.append(sheet);
 const $=id=>document.getElementById(id);
 const time=a=>a.map(n=>String(n).padStart(2,'0')).join(':');
 const fmt=v=>new Date(v).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'});
 const date=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'});
 async function rawCall(action,data={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000),started=performance.now();
  try{
   const result=await apiFetch(`${SUPA}/club-bookings`,{method:'POST',signal:controller.signal,body:JSON.stringify({action,initData:tg?.initData||'',...data})});
   if(['capabilities','state'].includes(action))window.deskAvailability?.accept(result.desk,started);
   return result;
  }catch(e){if(['capabilities','state'].includes(action))window.deskAvailability?.failure();throw e}
  finally{clearTimeout(timer)}
 }
 let bundlePromise=null,bundleCache=null,bundleTime=0,pollFailures=0;
 window.getClubState=async()=>{
  if(bundlePromise)return bundlePromise;
  if(bundleCache&&Date.now()-bundleTime<1000)return bundleCache;
  bundlePromise=rawCall('state').then(data=>{if(!Array.isArray(data.hosts)||!Array.isArray(data.bookings))throw Error('Обновите сервис клуба');bundleCache=data;bundleTime=Date.now();pollFailures=0;return data}).catch(e=>{pollFailures=Math.min(pollFailures+1,3);throw e}).finally(()=>bundlePromise=null);
  return bundlePromise;
 };
 async function call(action,data={}){
  if(window.pollBundleReady&&['list','account'].includes(action))return window.getClubState();
  const result=await rawCall(action,data);
  if(!['capabilities','list','account'].includes(action)){bundleCache=null;clearTimeout(pollTimer);if(!document.hidden)pollTimer=setTimeout(poll,5000);}
  return result;
 }
 function open(from){
  window.hallMotion?.cancel();sheet.classList.remove('closing');
  const r=from?.getBoundingClientRect?.();
  sheet.style.setProperty('--fx',r?Math.round(r.left+r.width/2-innerWidth/2)+'px':'0px');sheet.style.setProperty('--fy',r?Math.round(r.top+r.height/2-innerHeight/2)+'px':'40px');
  if(!sheet.open){sheet.showModal();openedAt=performance.now()}
 }
 function close(){
  if(state.busy||!sheet.open)return;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){sheet.close();return}
  sheet.classList.add('closing');setTimeout(()=>{if(sheet.classList.contains('closing')){sheet.classList.remove('closing');sheet.close()}},220);
 }
 sheet.addEventListener('close',()=>{sheet.classList.remove('closing');window.pickSeat?.(null)});
 sheet.addEventListener('click',e=>{if(e.target===sheet)close()});
 const handle=sheet.querySelector('.club-sheet-head');let drag=null;
 handle.addEventListener('pointerdown',e=>{if(e.target.closest('button')||state.busy||!e.isPrimary||(e.pointerType==='mouse'&&e.button!==0))return;e.preventDefault();drag={id:e.pointerId,x:e.clientX,y:e.clientY,t:performance.now()};handle.setPointerCapture(e.pointerId)});
 handle.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;const dy=e.clientY-drag.y;sheet.style.transform=`translateY(${Math.max(0,Math.min(100,dy*.45))}px)`});
 const finishDrag=e=>{if(!drag||e.pointerId!==drag.id)return;const dy=e.clientY-drag.y,dx=e.clientX-drag.x,elapsed=performance.now()-drag.t;sheet.style.transform='';if(e.type==='pointerup'&&dy>100&&dy>Math.abs(dx)*1.5&&elapsed>100&&elapsed<1800)close();drag=null};
 handle.addEventListener('pointerup',finishDrag);handle.addEventListener('pointercancel',finishDrag);
 $('club-close').onclick=close;sheet.addEventListener('cancel',e=>{e.preventDefault();close()});
 /* Booking window: "Войти сейчас" is one tap; otherwise pick a time (MSK, every 30 minutes); the clock opens all times. */
 const ROOMS={vip1:['VIP 1','RTX 4070 · i7-13700F · 27" 2K 240 Hz'],vip2:['VIP 2','RTX 4070 · i7-13700F · 24,5" 390 Hz'],std:['STANDART','RTX 4060 · i5-13400F · 24,5" 240 Hz'],tv:['TV-ЗОНА','PlayStation 5 · Samsung 65" 4K · до 2 человек']};
 const roomOf=id=>String(id)==='1'?'tv':window.planRoom?planRoom(id):'std';
 window.hostName=id=>String(id)==='1'?'PS5':'ПК '+id;
 /* Slots every 30 minutes for the next 24 hours (MSK); after midnight they belong to tomorrow. */
 function slotTimes(now=Date.now()){
  const msk=new Date(now+3*3600000),min=msk.getUTCHours()*60+msk.getUTCMinutes(),out=[];
  for(let m=Math.ceil((min+10)/30)*30;m<min+24*60;m+=30){const t=m%(24*60);out.push({key:time([Math.floor(t/60),t%60]),tomorrow:m>=24*60})}
  return out;
 }
 // Booking a busy PC: only times from the moment it frees up, the first one exactly then.
 function afterSlots(){
  const from=Date.parse(state.after),key=time(new Date(from+3*3600000).toISOString().slice(11,16).split(':').map(Number));
  const today=new Date(Date.now()+3*3600000).toISOString().slice(0,10),first={key,tomorrow:new Date(from+3*3600000).toISOString().slice(0,10)!==today};
  return [first,...slotTimes().filter(t=>Date.parse(nextClubArrival(...t.key.split(':').map(Number)))>from&&t.key!==key)];
 }
 function renderSlots(){
  const box=$('bk-slots'),slots=state.after?afterSlots():slotTimes();
  if(!slots.some(t=>t.key===state.slot))state.slot=slots[0]?.key;
  box.innerHTML=slots.map((t,i)=>`<button type="button" role="option" data-slot="${t.key}" data-tomorrow="${t.tomorrow}" aria-selected="${state.slot===t.key}"><b>${t.key}</b><small>${t.tomorrow?'завтра':'сегодня'}</small></button>`).join('');
  box.querySelectorAll('[data-slot]').forEach(b=>b.onclick=()=>{state.slot=b.dataset.slot;window.haptic?.('select');render()});
  // The clock shows every time at once, split into today and tomorrow.
  const all=$('bk-all'),groups=[['Сегодня',slots.filter(t=>!t.tomorrow)],['Завтра',slots.filter(t=>t.tomorrow)]].filter(g=>g[1].length);
  all.innerHTML=groups.map(([name,list])=>`<p class="bk-all-day">${name}</p><div class="bk-all-grid">${list.map(t=>`<button type="button" data-pick="${t.key}" aria-selected="${state.slot===t.key}">${t.key}</button>`).join('')}</div>`).join('');
  all.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{state.slot=b.dataset.pick;window.haptic?.('select');toggleAll(false);render();box.querySelector(`[data-slot="${CSS.escape(state.slot)}"]`)?.scrollIntoView({block:'nearest',inline:'center'})});
 }
 function toggleAll(open){const all=$('bk-all'),btn=$('bk-all-open');all.hidden=!open;$('bk-slots').hidden=open;btn.setAttribute('aria-expanded',String(open));btn.classList.toggle('on',open)}
 $('bk-all-open').onclick=()=>{toggleAll($('bk-all').hidden);window.haptic?.('select')};
 function render(){
  const room=ROOMS[roomOf(state.host)]||ROOMS.std;
  $('instant-mode').hidden=state.protocol<2||state.host==='1'||!!state.after;
  $('club-pc').textContent='БРОНЬ';$('club-error').textContent='';
  $('bk-title').textContent=hostName(state.host);$('bk-room').textContent=room[0];$('bk-room').dataset.room=roomOf(state.host);$('bk-specs').textContent=room[1];
  $('bk-label').textContent=$('instant-mode').hidden?'Когда придёшь?':'Или забронируй на время';
  state.mode='scheduled';state.arrival=state.slot?nextClubArrival(...state.slot.split(':').map(Number)):null;
  $('bk-slots').querySelectorAll('[data-slot]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.slot===state.slot)));
  $('club-submit').hidden=!state.arrival;
  $('club-submit').textContent='Забронировать · '+(state.slot||'');
  $('club-rules').textContent=state.replace?'Прошлая бронь снимется':'';
  $('bk-all').querySelectorAll('[data-pick]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.pick===state.slot)));
 }
 /* One PC per guest: picking another one swaps the booking; the old one is cancelled after the new one is accepted. */
 const SWAPPABLE=['requested','waiting','holding'];
 window.openClubBooking=async(id,after)=>{
  if(!after&&liveHostStatus(hostsData[String(id)])!=='free'){window.showOccupied?.(id);return}
  const others=state.rows.filter(b=>!terminal.has(b.status)&&b.status!=='in_session'&&b.host_id!==String(id));
  if(others.some(b=>!SWAPPABLE.includes(b.status))){window.pickSeat?.(null);toast('Прошлая бронь ещё оформляется. Подожди пару секунд','inf');return}
  state.replace=null;
  if(others.length){
   const prev=others[0];
   if(!await uiConfirm(`Снять бронь ${hostName(prev.host_id)}? Держать можно только один ПК.`,{ok:'Выбрать '+hostName(id)})){window.pickSeat?.(null);return}
   state.replace=others.map(b=>b.id);
  }
  state.host=String(id);state.forFriend=false;state.kind='range';state.request=null;state.slot=null;state.after=after||null;
  $('club-create').hidden=false;$('club-mine').hidden=true;renderSlots();toggleAll(false);render();open(state.host==='1'?$('ps5-seat'):document.querySelector(`#floor-map [data-hid="${CSS.escape(state.host)}"]`));$('bk-slots').scrollLeft=0;
 };
 let openedAt=0;
 $('instant-mode').onclick=()=>{if(performance.now()-openedAt<350)return;state.mode='instant';submit()};
 $('club-submit').onclick=()=>{render();submit()};
 async function submit(){
  if(state.busy)return;if(!tg?.initData){$('club-error').textContent='Откройте приложение через Telegram';return}
  if(!state.after&&liveHostStatus(hostsData[state.host])!=='free'){$('club-error').textContent='ПК сейчас недоступен. Выберите свободный компьютер';return}
  if(state.mode==='scheduled'&&Date.parse(state.arrival)<=Date.now()+60000){renderSlots();render();$('club-error').textContent='Это время уже прошло. Выбери другое';return}
  state.busy=true;$('club-submit').disabled=true;$('club-error').textContent='';
  state.request ||= crypto.randomUUID();
  const start=state.mode==='scheduled'?state.arrival:null;
  const end=start?new Date(Date.parse(start)+30*60000).toISOString():null;
  try{await call(state.protocol>=2?'create_v2':'create',{for_friend:state.forFriend,host_id:state.host,mode:state.mode,duration_kind:state.kind,starts_at:start,ends_at:end,client_request_id:state.request});state.request=null;if(state.replace){const old=state.replace;state.replace=null;for(const bid of old){try{await call('cancel',{id:bid})}catch(e){toast('Новая бронь есть, но прошлую снять не вышло. Отмени её в «Моих бронях»','err')}}}if(state.mode==='instant'){await refresh();startConnecting(state.host)}else await booked(state.host,start);fetchHosts()}
  catch(e){$('club-error').textContent=clubText(e.message)||'Не удалось отправить бронь'}
  finally{state.busy=false;$('club-submit').disabled=false}
 }
 function mine(){
  const box=$('club-mine');box.replaceChildren();
  if(state.protocol>=2&&state.account?.session&&(!state.host||state.account.session.host_id===state.host))renderSession(box);
  const rows=state.rows.filter(b=>!terminal.has(b.status)&&(!state.host||b.host_id===state.host)&&!(b.status==='in_session'&&state.account?.session?.host_id===b.host_id));
  if(!rows.length&&!state.account?.session){const p=document.createElement('p');p.textContent='Активных броней пока нет';box.append(p)}
  rows.forEach(b=>{
   const card=document.createElement('section');card.className='club-reservation';
   const add=(tag,text,cl)=>{const e=document.createElement(tag);e.textContent=text;if(cl)e.className=cl;card.append(e);return e};
   add('h2',hostName(b.host_id));if(b.instant&&!['attention','cancelled','expired'].includes(b.status)){add('strong','Подключаем ваш аккаунт…');box.append(card);return}add('strong',statusNames[b.status]||b.status);
   add('p',b.mode==='arrival'?`Ждём до ${fmt(b.hold_until)} МСК`:`${clubArrivalLabel(b.starts_at)} → ${b.duration_kind==='open'?'Как пойдёт':clubArrivalLabel(b.ends_at)}`,'club-note');
   if(b.for_friend)add('p','Бронь старой версии · доступна отмена','club-note');
   if(b.status==='release_requested')add('p','Снимаем блокировку. Друг войдёт сам.','club-note');
   if(b.status==='holding'&&!b.for_friend&&b.protocol>=2&&b.host_id!=='1'&&['free','reserved'].includes(liveHostStatus(hostsData[b.host_id]))){
    const btn=add('button',b.for_friend?'Разблокировать для друга':'Войти в свой аккаунт','btn-main');btn.onclick=async()=>{if(await uiConfirm(b.for_friend?'Друг уже у компьютера? Снять блокировку для его входа?':'Начать игровую сессию на ПК '+b.host_id+'?',{ok:'Войти'}))action(btn,b.for_friend?'release':'enter',{id:b.id})};
   }
   if(b.status==='holding'&&!(b.protocol>=2)&&['free','reserved'].includes(liveHostStatus(hostsData[b.host_id]))){
    add('p','Вы уже в клубе? Узнайте код в панели администратора.','club-note');
    const input=add('input','');input.inputMode='numeric';input.autocomplete='one-time-code';input.maxLength=6;input.placeholder='Код из клуба';input.setAttribute('aria-label','Шестизначный код присутствия');
    const btn=add('button','Я пришёл → Войти','btn-main');btn.onclick=()=>action(btn,'checkin',{id:b.id,code:input.value});
   }
   if(['requested','waiting','holding','attention','checkin_pending','release_requested','in_session'].includes(b.status)){const btn=add('button','Отменить бронь','club-cancel');btn.onclick=async()=>{if(await uiConfirm('Отменить бронь '+hostName(b.host_id)+'?',{ok:'Отменить бронь',danger:true}))action(btn,'cancel',{id:b.id})}}

   box.append(card);
  });

 }
 async function action(btn,name,data){if(state.busy)return;state.busy=true;btn.disabled=true;$('club-error').textContent='';try{await call(name,data);await refresh();mine()}catch(e){$('club-error').textContent=clubText(e.message)}finally{state.busy=false;btn.disabled=false}}
 /* Instant entry: dim the app, fill the 1SHOT logo until the club confirms the session, then reveal the session screen. */
 let connecting=null;
 function startConnecting(host){connecting={host:String(host),since:Date.now()};if(sheet.open)sheet.close();window.oneshotLoader?.show('Подключаем ПК '+host,'Входим в твой аккаунт. Не закрывай приложение');if(!window.oneshotLoader)showMine()}
 function checkConnecting(){if(!connecting)return;const c=connecting,session=accountFresh()&&state.account?.session;
  if(session&&String(session.host_id)===c.host){connecting=null;window.oneshotLoader?.hide(true);return}
  const row=state.rows.find(b=>b.host_id===c.host&&b.instant);
  if((row&&['attention','cancelled','expired'].includes(row.status))||Date.now()-c.since>120000){connecting=null;window.oneshotLoader?.hide(false);state.host=c.host;showMine()}}
 window.clubConnecting=()=>!!connecting;
 /* After a booking: the 1SHOT loader while the club takes it, then «Ждём вас». No "waiting for confirmation" wording. */
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 async function booked(host,start){
  if(sheet.open)sheet.close();
  window.oneshotLoader?.show('Бронируем '+hostName(host),'');
  const until=Date.now()+12000;let row=null;
  do{await refresh();row=state.rows.find(b=>b.host_id===host&&!terminal.has(b.status));if(row&&row.status!=='requested')break;await sleep(1200)}while(Date.now()<until);
  if(!row||['attention','cancelled','expired'].includes(row.status)){window.oneshotLoader?.hide(false);state.host=host;showMine();return}
  window.oneshotLoader?.hide(true);setTimeout(()=>welcome(host,row.starts_at||start),window.oneshotLoader?600:0);
 }
 const hello=document.createElement('dialog');hello.id='bk-welcome';hello.className='bk-welcome';
 hello.innerHTML='<p class="bkw-tag">Бронь оформлена</p><h2 class="bkw-title">Ждём<br>вас</h2><div class="bkw-pc"><b></b><span></span></div><p class="bkw-time"></p><p class="bkw-note">Садись за свой ПК, аккаунт откроется сам. Если планы поменяются, бронь можно снять в зелёной плашке внизу.</p><button type="button" class="btn-main">Отлично</button>';
 document.body.append(hello);
 hello.querySelector('button').onclick=()=>hello.close();hello.addEventListener('click',e=>{if(e.target===hello)hello.close()});
 function welcome(host,start){
  const room=ROOMS[roomOf(host)]||ROOMS.std;
  hello.querySelector('.bkw-pc b').textContent=hostName(host);hello.querySelector('.bkw-pc span').textContent=room[0];
  hello.querySelector('.bkw-time').textContent=start?clubArrivalLabel(start):'';
  window.haptic?.('ok');if(!hello.open)hello.showModal();renderBar();
 }
 /* Small green bar above the menu: the booking is always one tap away to manage or cancel. */
 const bar=document.createElement('button');bar.type='button';bar.id='booking-bar';bar.className='booking-bar';bar.hidden=true;
 bar.innerHTML='<span class="bb-dot"></span><span class="bb-text"></span><b>Управлять</b>';
 document.querySelector('.bottom-nav')?.before(bar);
 bar.onclick=()=>{const b=activeBooking();if(b){state.host=b.host_id;showMine()}};
 function activeBooking(){return state.rows.find(b=>!terminal.has(b.status)&&!['in_session','checkin_pending'].includes(b.status)&&!b.instant)}
 function renderBar(){
  const b=state.account?.session?null:activeBooking();bar.hidden=!b;document.getElementById('app')?.classList.toggle('has-booking-bar',!!b);if(!b)return;
  const when=b.starts_at?clubArrivalLabel(b.starts_at):(b.hold_until?'до '+fmt(b.hold_until):'');
  const text=hostName(b.host_id)+(when?' · '+when:'')+(b.status==='attention'?' · подойди к админу':'');
  const node=bar.querySelector('.bb-text');if(node.textContent!==text)node.textContent=text;
 }
 function showMine(){$('club-create').hidden=true;$('club-mine').hidden=false;$('club-pc').textContent='МОИ БРОНИ';$('club-error').textContent='';mine();open()}

 window.openOwnBooking=id=>{if(accountFresh()&&state.account?.session?.host_id===String(id)){state.host=String(id);showMine();return true}if(state.rows.some(b=>b.host_id===String(id)&&!terminal.has(b.status))){state.host=String(id);showMine();return true}return false};
 const sessionBanner=document.createElement('button');sessionBanner.id='my-session-banner';sessionBanner.className='my-session-banner';sessionBanner.type='button';sessionBanner.hidden=true;sessionBanner.innerHTML='<span><strong>Моя сессия</strong><small></small></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
 document.querySelector('.app-header').insertAdjacentElement('afterend',sessionBanner);
 sessionBanner.onclick=()=>{state.host=null;showMine();$('club-pc').textContent='МОЯ СЕССИЯ'};
 const sessionScreen=document.createElement('section');sessionScreen.id='session-screen';sessionScreen.hidden=true;
 sessionScreen.innerHTML=`<div class="session-screen-content"><svg class="session-scene" viewBox="0 0 200 124" aria-hidden="true"><defs><radialGradient id="ms-glow" cx="50%" cy="55%" r="50%"><stop offset="0" stop-color="#A3FF10" stop-opacity=".45"/><stop offset="1" stop-color="#A3FF10" stop-opacity="0"/></radialGradient><clipPath id="ms-screen"><rect x="34" y="46" width="132" height="60"/></clipPath></defs><ellipse class="ms-light" cx="100" cy="76" rx="92" ry="50" fill="url(#ms-glow)"/><g class="ms-head" transform="translate(61.75 0) scale(1.7)"><g class="ms-tilt"><g class="ms-ears"><polygon points="4.62219,10.7343 4.0874,16.197 9.32084,8.74788 9.32084,12.7971 12.0713,12.7971 12.0713,0 4.62219,10.7343"/><polygon points="0,17.4576 0,22.309 2.75043,22.309 2.82684,18.9474 6.26485,18.9474 6.26485,16.2352 4.08744,16.197 4.62223,10.7344 0,17.4576"/><polygon points="33.6545,16.197 37.0162,16.197 42.2497,8.74788 42.2497,12.8353 45,12.8353 45,0 33.6545,16.197"/></g><g class="ms-face"><polygon points="2.75043,33.3106 2.75043,22.309 0,22.309 0,42.1732 12.0713,24.6393 12.0713,12.7971 9.32088,12.7971 9.32088,23.7988 2.75043,33.3106"/><polygon points="35.6793,33.3107 35.6793,22.309 32.929,22.309 32.929,42.1733 44.962,24.6393 44.962,16.197 38.7353,16.197 38.7353,18.9474 42.2498,18.9474 42.2498,23.7988 35.6793,33.3107"/><polygon points="26.7404,28.3445 26.7404,18.1833 24.1045,18.1833 24.1045,28.3445 26.7404,28.3445"/><polygon points="24.1044,25.6707 20.0552,25.6707 20.0552,28.3446 24.1044,28.3446 24.1044,25.6707"/><polygon points="25.4032,32.9495 20.4105,32.9495 19.5,32.9495 18.0918,32.9495 18.0918,35.6616 22.7292,35.6616 25.4032,35.6616 25.4032,32.9495"/></g><g class="ms-eyes"><polygon points="23.3114,15 18.3187,15 17.4082,15 16,15 16,17.7122 20.6374,17.7122 23.3114,17.7122 23.3114,15"/><polygon points="35.3114,15 30.3187,15 29.4082,15 28,15 28,17.7122 32.6374,17.7122 35.3114,17.7122 35.3114,15"/></g></g></g><rect class="ms-monitor" x="32" y="44" width="136" height="64"/><g clip-path="url(#ms-screen)" class="ms-game"><line class="ms-ground" x1="34" y1="98" x2="166" y2="98"/><line class="ms-dust" x1="34" y1="101" x2="200" y2="101"/><g class="ms-runner"><g transform="translate(52 84) scale(.31)"><polygon points="4.62219,10.7343 4.0874,16.197 9.32084,8.74788 9.32084,12.7971 12.0713,12.7971 12.0713,0 4.62219,10.7343"/><polygon points="0,17.4576 0,22.309 2.75043,22.309 2.82684,18.9474 6.26485,18.9474 6.26485,16.2352 4.08744,16.197 4.62223,10.7344 0,17.4576"/><polygon points="33.6545,16.197 37.0162,16.197 42.2497,8.74788 42.2497,12.8353 45,12.8353 45,0 33.6545,16.197"/><polygon points="2.75043,33.3106 2.75043,22.309 0,22.309 0,42.1732 12.0713,24.6393 12.0713,12.7971 9.32088,12.7971 9.32088,23.7988 2.75043,33.3106"/><polygon points="35.6793,33.3107 35.6793,22.309 32.929,22.309 32.929,42.1733 44.962,24.6393 44.962,16.197 38.7353,16.197 38.7353,18.9474 42.2498,18.9474 42.2498,23.7988 35.6793,33.3107"/><polygon points="26.7404,28.3445 26.7404,18.1833 24.1045,18.1833 24.1045,28.3445 26.7404,28.3445"/><polygon points="24.1044,25.6707 20.0552,25.6707 20.0552,28.3446 24.1044,28.3446 24.1044,25.6707"/><polygon points="23.3114,15 18.3187,15 17.4082,15 16,15 16,17.7122 20.6374,17.7122 23.3114,17.7122 23.3114,15"/><polygon points="35.3114,15 30.3187,15 29.4082,15 28,15 28,17.7122 32.6374,17.7122 35.3114,17.7122 35.3114,15"/></g></g><g class="ms-cactus"><rect x="172" y="89" width="4" height="9"/><rect x="169" y="92" width="3" height="2"/><rect x="176" y="91" width="3" height="2"/></g><g class="ms-cloud"><rect x="150" y="56" width="12" height="3"/><rect x="153" y="53" width="6" height="3"/></g></g><rect class="ms-stand" x="94" y="108" width="12" height="6"/><rect class="ms-desk" x="8" y="118" width="184" height="3"/><g class="ms-keys"><rect x="24" y="113" width="52" height="5"/><rect x="124" y="113" width="52" height="5"/></g><g class="ms-paw ms-paw-l"><rect x="36" y="106" width="15" height="7"/></g><g class="ms-paw ms-paw-r"><rect x="149" y="106" width="15" height="7"/></g></svg><h1>Сессия активна</h1><div class="session-host"></div><p class="session-start"></p><dl><div class="session-time-box"><dt>Осталось времени</dt><dd class="session-time">—</dd></div><div><dt>Баланс</dt><dd class="session-balance">—</dd></div></dl><div class="session-quick"><p class="session-quick-title">Пока играешь</p><div class="session-quick-row"><button type="button" class="sq-food" data-market="food"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 13H6Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg><b>Еда к ПК</b><small>Принесут за стол</small></button><button type="button" class="sq-rent" data-market="rent"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 3v6"/></svg><b>Аренда</b><small>Мышки, коврик, повербанк</small></button></div></div><div class="session-actions"><button type="button" class="btn-lock-pc" id="btn-lock-own-pc"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span>Заблокировать</span></button><button type="button" class="btn-logout-pc" id="btn-logout-own-pc"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg><span>Завершить</span></button></div></div>`;
 sessionBanner.after(sessionScreen);
 // «Пока играешь»: straight into the market tab the guest needs at the PC.
 sessionScreen.querySelectorAll('[data-market]').forEach(b=>b.onclick=()=>{if(window.foodScreen)foodScreen.state.section=b.dataset.market;window.haptic?.('select');navTo('food')});
 /* Club actions on the own PC: the 1SHOT loader runs until Desk reports the result, then one short toast. */
 async function runOnPc(kind,payload,caption){
  window.oneshotLoader?.show(caption,'');let ok=false,text='';
  try{
   const {id}=await command(kind,payload);const until=Date.now()+25000;
   while(Date.now()<until){
    await sleep(1500);bundleCache=null;const res=await call('account');state.account=res.account?.data||null;state.accountTime=res.account?.updated_at;
    const c=res.commands?.find(x=>x.id===id);
    if(kind==='logout'&&!state.account?.session){ok=true;break}
    if(c&&c.status==='done'){ok=true;break}
    if(c&&['attention','rejected','failed'].includes(c.status)){text=clubText(c.message)||'Не получилось. Подойди к администратору';break}
   }
   if(!ok&&!text)text='Клуб не ответил. Попробуй ещё раз или подойди к администратору';
  }catch(e){text=clubText(e.message)||'Не получилось. Попробуй ещё раз'}
  window.oneshotLoader?.hide(ok);renderSessionBanner();
  toast(ok?(kind==='logout'?'Сеанс завершён':'Экран заблокирован'):text,ok?'ok':'err');
 }
 sessionScreen.querySelector('#btn-lock-own-pc').onclick=async()=>{
  const current=state.account?.session;if(!current||!accountFresh())return;
  if(!await uiConfirm('Заблокировать экран ПК '+current.host_id+'? Игры не закроются, для разблокировки введи пароль на ПК.',{ok:'Заблокировать'}))return;
  runOnPc('lock',{session_key:current.key},'Блокируем ПК '+current.host_id);
 };
 sessionScreen.querySelector('#btn-logout-own-pc').onclick=async()=>{
  const current=state.account?.session;if(!current||!accountFresh())return;
  if(!await uiConfirm('Завершить сеанс на ПК '+current.host_id+'? Сохрани игру перед выходом.',{ok:'Завершить',danger:true}))return;
  runOnPc('logout',{session_key:current.key},'Завершаем сеанс');
 };
 /* Time left counts down locally between account updates. */
 function timeLeft(){
  const sec=state.account?.available_time;if(!Number.isFinite(sec)||!state.accountTime)return null;
  return Math.max(0,sec-(Date.now()-Date.parse(state.accountTime))/1000);
 }
 const hm=sec=>{const m=Math.floor(sec/60);return m>=60?Math.floor(m/60)+' ч '+String(m%60).padStart(2,'0')+' мин':m+' мин'};
 function renderSessionBanner(){checkConnecting();
  const current=state.account?.session,fresh=accountFresh();sessionBanner.hidden=!current;sessionScreen.hidden=!current;
  if($('ps-now'))$('ps-now').textContent=current?'ПК '+current.host_id:'—';
  document.getElementById('app').classList.toggle('has-session',!!current);document.getElementById('app').classList.toggle('session-mode',!!current);
  if(current){
   sessionBanner.querySelector('small').textContent='ПК '+current.host_id;
   const set=(selector,value)=>{const node=sessionScreen.querySelector(selector);if(node.textContent!==value)node.textContent=value};
   set('.session-host','ПК '+current.host_id);
   set('.session-start',current.last_login?'В игре с '+fmt(current.last_login)+' МСК':'');
   set('.session-balance',Number.isFinite(state.account.balance)?state.account.balance.toLocaleString('ru-RU')+' ₽':'—');
   const left=timeLeft();set('.session-time',left===null?'—':hm(left));sessionScreen.querySelector('.session-time-box').classList.toggle('low',left!==null&&left<900);
  }
 }

 function renderSession(box){
  const current=state.account.session;const card=document.createElement('section');card.className='club-reservation current-session';
  const title=document.createElement('h2');title.textContent='Ты играешь · ПК '+current.host_id;card.append(title);
  const p=document.createElement('p');p.className='club-note';p.textContent=current.last_login?'В игре с '+fmt(current.last_login)+' МСК':'';card.append(p);
  const balance=document.createElement('p');balance.textContent=Number.isFinite(state.account.balance)?'Баланс: '+state.account.balance+' ₽':'';card.append(balance);
  const exit=document.createElement('button');exit.className='btn-main';exit.textContent='Завершить мою сессию';exit.disabled=!current.key||!accountFresh();
  exit.onclick=async()=>{if(!await uiConfirm('Завершить сеанс на ПК '+current.host_id+'? Сохрани игру перед выходом.',{ok:'Завершить',danger:true}))return;close();runOnPc('logout',{session_key:current.key},'Завершаем сеанс')};
  card.append(exit);box.append(card);
 }
 let accountSetup=false,accountPending=false,accountFeedback,passwordFeedback;
 function accountFresh(){return !!state.accountTime&&Date.now()-Date.parse(state.accountTime)<45000}
 function setupAccount(){
  if(accountSetup)return;accountSetup=true;
  const box=document.createElement('section');box.className='account-tools';
  box.innerHTML='<div id="profile-stats" class="profile-stat-grid" hidden></div><p id="stats-period" class="club-note" hidden></p><button type="button" id="account-toggle" aria-expanded="false" aria-controls="account-fields">Данные аккаунта<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><div id="account-fields" inert><div><form id="edit-account"><label>Никнейм<input name="username" minlength="3" maxlength="30" autocomplete="username" required></label><label>Имя<input name="firstName" maxlength="45"></label><label>Фамилия<input name="lastName" maxlength="45"></label><label>Email<input name="email" type="email" maxlength="254"></label><label>Телефон<input name="mobilePhone" maxlength="20"></label><label>Дата рождения<input id="account-birthday" readonly></label><button class="btn-main">Сохранить изменения</button></form></div></div><button id="request-password" class="btn-main">Сменить пароль через админа</button><p id="password-result" role="status"></p><p id="account-result" role="status"></p>';
  const slot=$('prof-account-slot');if(slot)slot.append(box);
  /* Password change is a quiet row near the bottom of the profile, not a big button. */
  const pass=$('prof-password-slot');if(pass){const btn=$('request-password');btn.className='prof-row';btn.innerHTML='<span>Пароль<small>Новый пароль подтвердит администратор</small></span><b>Сменить</b>';pass.append(btn,$('password-result'))}else{document.querySelector('#mini-build').before(box);document.querySelector('#mini-build').before(document.querySelector('#ov-profile .btn-danger'))}
  const owner=()=>String(profile?.telegram_id||'')+':'+String(profile?.gizmo_user_id||'');
  accountFeedback=new ProfileFeedback($('account-result'),owner);passwordFeedback=new ProfileFeedback($('password-result'),owner);
  $('account-toggle').onclick=()=>{const open=$('account-toggle').getAttribute('aria-expanded')!=='true';$('account-toggle').setAttribute('aria-expanded',String(open));$('account-fields').classList.toggle('expanded',open);$('account-fields').inert=!open};
  $('edit-account').addEventListener('input',()=>{const form=$('edit-account');form.dataset.dirty='1';form.dataset.revision=String(Number(form.dataset.revision||0)+1)});
  $('edit-account').onsubmit=async e=>{e.preventDefault();if(!await uiConfirm('Сохранить данные аккаунта в клубе? Новый никнейм будет использоваться для входа на ПК.',{ok:'Сохранить'}))return;const btn=e.target.querySelector('button'),revision=e.target.dataset.revision||'0';btn.disabled=true;try{const requested=await command('profile_edit',Object.fromEntries(new FormData(e.target)));e.target.dataset.pendingId=requested.id;e.target.dataset.sentRevision=revision;accountFeedback.show(null,'Запрос отправлен в клуб')}catch(error){accountFeedback.show(null,clubText(error.message))}finally{btn.disabled=false}};
  $('request-password').onclick=async()=>{if(!await uiConfirm('Запросить смену пароля у администратора? В клубе потребуется подтвердить личность.',{ok:'Запросить'}))return;try{await command('password_request',{});passwordFeedback.show(null,'Администратор получил запрос. Обратитесь к нему в клубе.')}catch(error){accountFeedback.show(null,clubText(error.message))}};
  refreshAccount();
 }
 async function command(kind,payload){return call('command',{kind,payload,request_id:crypto.randomUUID()})}
 async function refreshAccount(){
  if(document.hidden||state.protocol<2||accountPending||!profile||!tg?.initData)return;accountPending=true;
  try{
   const res=await call('account');state.account=res.account?.data||null;state.accountTime=res.account?.updated_at;
   const data=state.account;
   if(data){
    const stats=$('profile-stats');if(stats){stats.replaceChildren();const stat=document.createElement('p');stat.textContent='Игровое время';const value=document.createElement('strong');value.textContent=Number.isFinite(data.statistics?.hours)?data.statistics.hours.toLocaleString('ru-RU',{maximumFractionDigits:1})+' ч':'Нет данных';stat.append(value);stats.append(stat);if($('ps-hours'))$('ps-hours').textContent=Number.isFinite(data.statistics?.hours)?data.statistics.hours.toLocaleString('ru-RU',{maximumFractionDigits:1})+' ч':'—';$('stats-period').textContent=data.statistics?.from&&data.statistics?.to?'Период · '+new Date(data.statistics.from).toLocaleDateString('ru-RU')+' — '+new Date(data.statistics.to).toLocaleDateString('ru-RU'):'Ожидаем статистику клуба';}

    profile.username=data.username||profile.username;profile.first_name=data.firstName||res.telegram?.first_name||profile.first_name;profile.last_name=data.lastName||'';
    profile.balance=accountFresh()&&typeof data.balance==='number'?data.balance:null;fillProfile();
    if(accountFresh())$('balance-note').textContent='Баланс клуба · обновлён '+fmt(state.accountTime)+' МСК';
    const form=$('edit-account');if(form&&!form.contains(document.activeElement)&&!form.dataset.dirty){for(const key of ['username','firstName','lastName','email','mobilePhone'])form.elements[key].value=data[key]||'';$('account-birthday').value=data.birthDate?String(data.birthDate).slice(0,10):'Нет данных'}
    if(form&&!form.dataset.listening){form.dataset.listening='1';form.addEventListener('input',()=>form.dataset.dirty='1')}
   }
   const photo=res.telegram?.photo_url,avatar=document.querySelector('.prof-ava');
   if(photo&&avatar&&avatar.dataset.photo!==photo){const img=document.createElement('img');img.src=photo;img.alt='Аватар Telegram';img.referrerPolicy='no-referrer';img.onerror=()=>{avatar.textContent=(profile.first_name||profile.username||'?')[0].toUpperCase()};avatar.replaceChildren(img);avatar.dataset.photo=photo}
   else if(avatar&&!photo)avatar.textContent=(profile.first_name||profile.username||'?')[0].toUpperCase();
   const passwordRequest=res.password_request||res.commands?.find(c=>c.kind==='password_request');
   passwordFeedback?.show(passwordRequest,passwordRequest?(clubText(passwordRequest.message)||({awaiting_admin:'Заявка ожидает администратора',done:'Услуга предоставлена',rejected:'Заявка закрыта без выполнения'}[passwordRequest.status]||'Заявка обрабатывается')):'');
   renderSessionBanner();
   const form=$('edit-account'),pendingId=form?.dataset.pendingId;
   const latest=pendingId?res.commands?.find(c=>c.id===pendingId):res.commands?.find(c=>c.kind==='profile_edit');
   if(latest||!pendingId)accountFeedback?.show(latest,latest?(clubText(latest.message)||({queued:'Запрос ожидает обработки',running:'Выполняется',done:'Изменения сохранены',attention:'Нужна проверка администратора'}[latest.status]||'Запрос обрабатывается')):'');
   if(latest?.status==='done'&&latest.id===pendingId){if((form.dataset.revision||'0')===form.dataset.sentRevision)delete form.dataset.dirty;delete form.dataset.pendingId;}
   if(sheet.open&&!$('club-mine').hidden&&!state.busy)mine();
  }catch{if(profile){profile.balance=null;fillProfile()}renderSessionBanner()}
  finally{accountPending=false}
 }
 let fetching=false;
 async function refresh(){
  if(document.hidden||fetching||!window.clubV2||!profile||!tg?.initData)return;fetching=true;
  try{const res=await call('list');const changed=JSON.stringify(state.rows)!==JSON.stringify(res.bookings||[]);state.rows=res.bookings||[];window.instantHostIds=new Set(state.rows.filter(b=>b.instant&&['requested','holding','checkin_pending'].includes(b.status)).map(b=>b.host_id));window.ownBookingIds=new Set(state.rows.filter(b=>!terminal.has(b.status)).map(b=>b.host_id));if(changed){renderHall()}renderBar();if(changed&&sheet.open&&!$('club-mine').hidden)mine()}
  catch{/* A failed refresh never frees an owned PC in the UI. */}
  finally{fetching=false}
 }
 async function init(){try{const c=await call('capabilities');pollFailures=0;window.clubV2=!!c.enabled;state.protocol=c.protocol||1;window.pollBundleReady=c.poll_bundle===1&&state.protocol>=2;$('instant-mode').hidden=state.protocol<2;if(state.protocol>=2)setupAccount();if(window.clubV2){renderHall();refresh()}}catch{pollFailures=Math.min(pollFailures+1,3)}}
 let pollTimer=null,polling=false;
 async function poll(){
  clearTimeout(pollTimer);
  if(polling)return;
  if(document.hidden){pollTimer=null;return;}
  polling=true;
  try{if(!window.clubV2||!profile||!tg?.initData||!window.pollBundleReady)await init();await Promise.all([refresh(),refreshAccount(),profile?fetchHosts():Promise.resolve()])}finally{polling=false;}
  const seconds=pollFailures?Math.min(60,20*2**pollFailures):5;
  clearTimeout(pollTimer);if(!document.hidden)pollTimer=setTimeout(poll,seconds*1000);
 }
 init().then(()=>{if(!polling){clearTimeout(pollTimer);pollTimer=setTimeout(poll,5000)}});
 document.addEventListener('visibilitychange',()=>{clearTimeout(pollTimer);if(!document.hidden){bundleCache=null;poll()}});
 window.addEventListener('club:resume',()=>{bundleCache=null;poll()});
 // Expire cached availability locally, without another network request.
 setInterval(()=>{if(!document.hidden&&profile){renderHall();renderSessionBanner();renderBar()}},5000);
})();
