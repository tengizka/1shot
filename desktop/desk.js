const $=id=>document.getElementById(id);
document.title=DESK_BUILD.title;$('window-title').textContent=DESK_BUILD.title;$('build-author').textContent=DESK_BUILD.author;$('build-version').textContent='CLUB DESK / v'+DESK_BUILD.version;
const labels={requested:'Ожидает обработки',waiting:'ПК занят · ждём освобождения',holding:'ПК ждёт гостя',checkin_pending:'Подтверждаем вход',in_session:'Гость играет',attention:'Требует проверки',cancel_requested:'Снимаем бронь',release_requested:'Разблокируем для друга'};
const fmt=v=>new Date(v).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'});
let current=null,selectedHost=null,foundAccount=null,inFlight=false,soundLoaded=false,selectedResetRequest=null;
function panel(name){document.querySelectorAll('[id^=panel-]').forEach(e=>e.hidden=e.id!=='panel-'+name);document.querySelectorAll('[data-panel]').forEach(e=>e.classList.toggle('active',e.dataset.panel===name))}
document.querySelectorAll('[data-panel]').forEach(e=>e.onclick=()=>panel(e.dataset.panel));
async function invoke(method,...args){try{const result=await window.pywebview.api[method](...args);if(!['booking_guest','find_account'].includes(method))await refresh();return result}catch{$('error').textContent='Не удалось выполнить команду. Проверьте связь с агентом';return null}}
function selectHost(id){selectedHost=id;panel('bookings');if(current){bookings(current);refresh.bookingKey=JSON.stringify(current.rows)+selectedHost}}
function bookings(s){
 const grid=$('grid');grid.replaceChildren();$('booking-title').textContent=selectedHost?'Брони ПК '+selectedHost:'Все брони';
 const filter=$('booking-filter').value,sort=$('booking-sort').value;
 const rows=s.rows.filter(b=>(!b.instant||b.status==='attention')&&(!selectedHost||b.host_id===selectedHost)&&(filter==='all'||b.status===filter||b.mode===filter)).sort((a,b)=>sort==='host'?Number(a.host_id)-Number(b.host_id):sort==='name'?String(a.username||'').localeCompare(String(b.username||'')):Date.parse(a.starts_at)-Date.parse(b.starts_at));
 for(const b of rows){
  const card=document.createElement('article');card.className='card '+b.status;
  const add=(tag,text,cl)=>{const e=document.createElement(tag);e.textContent=text;if(cl)e.className=cl;card.append(e);return e};
  add('span',b.instant?'ВХОД СЕЙЧАС':b.mode==='arrival'?'В ТЕЧЕНИЕ ЧАСА':'СЕГОДНЯ К…','tag');add('h2','ПК '+b.host_id);add('p',b.username+(b.for_friend?' · для друга':''));add('p',labels[b.status]||b.status);add('p',fmt(b.starts_at)+' → '+(b.duration_kind==='open'?'Как пойдёт':fmt(b.ends_at))+' МСК');
  const details=document.createElement('details');details.className='guest-details';const heading=document.createElement('summary');heading.textContent='Информация о госте';details.append(heading);for(const [label,value] of [['Имя',[b.first_name,b.last_name].filter(Boolean).join(' ')],['Никнейм',b.username],['Телефон',b.mobile_phone],['Gizmo ID',b.gizmo_user_id],['Telegram ID',b.telegram_id]]){const p=document.createElement('p');p.textContent=label+': '+(value||'Нет данных');details.append(p)}details.addEventListener('toggle',async()=>{if(!details.open||details.dataset.loaded)return;details.dataset.loaded='1';const r=await invoke('booking_guest',b.id);if(!details.isConnected)return;if(r?.user){for(const p of [...details.querySelectorAll('p')])p.remove();for(const [label,value] of [['Имя',[r.user.firstName,r.user.lastName].filter(Boolean).join(' ')],['Никнейм',r.user.username],['Телефон',r.user.mobilePhone||r.user.phone],['Gizmo ID',r.gizmo_user_id],['Telegram ID',r.telegram_id]]){const p=document.createElement('p');p.textContent=label+': '+(value||'Нет данных');details.append(p)}}else{delete details.dataset.loaded;const p=document.createElement('p');p.textContent=r?.error||'Нет связи с Gizmo';details.append(p)}});card.append(details);
  if(b.code){add('small','Код старой брони');add('strong',b.code,'code')}
  add('p',b.message||'Без прерывания активных сессий','dim');add('small','Бронь '+b.id);
  if(['requested','waiting','holding','attention','checkin_pending','release_requested','in_session'].includes(b.status)){
   const btn=add('button','Отменить бронь');btn.onclick=async()=>{if(!confirm('Отменить бронь ПК '+b.host_id+'? Сессия игрока не будет завершена.'))return;btn.disabled=true;const r=await invoke('cancel_booking',b.id);if(r?.error)$('error').textContent=r.error;btn.disabled=false};
  }
  grid.append(card);
 }
 if(!grid.children.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=selectedHost?'У этого ПК нет активных броней':'Активных броней пока нет';grid.append(empty)}
}
for(const id of ['booking-filter','booking-sort'])$(id).onchange=()=>{if(current)bookings(current)};
function hall(s){
 const map=$('desk-map');map.replaceChildren();const fresh=s.last_sync&&Date.now()/1000-s.last_sync<30;
 const hosts=new Map((s.hosts||[]).map(h=>[h.host_id,h]));
 for(const group of ['vip','standard']){
  const section=document.createElement('section');section.className='desk-zone';const heading=document.createElement('h3');heading.textContent=group==='vip'?'VIP · РЯДЫ 10 / 20':'STANDARD · ЗОНЫ 100 / 200 / 300 / 400';section.append(heading);
  const grid=document.createElement('div');grid.className='desk-zone-grid';
  for(const pc of getZoneSeats(group)){
   const connecting=s.rows.some(b=>b.instant&&b.host_id===pc.id&&['requested','holding','checkin_pending'].includes(b.status));const status=connecting?'connecting':fresh?(hosts.get(pc.id)?.status||'unknown'):'unknown';const btn=document.createElement('button');btn.className='desk-pc '+status;
   const number=document.createElement('b');number.textContent=pc.id;const state=document.createElement('span');state.textContent=HOST_LABELS[status];if(status==='reserved')state.innerHTML='<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Бронь';btn.append(number,state);btn.onclick=()=>selectHost(pc.id);grid.append(btn);
  }
  section.append(grid);map.append(section);
 }
}
async function refresh(){
 if(document.hidden||inFlight||!window.pywebview?.api)return;inFlight=true;
 try{
  const s=await window.pywebview.api.snapshot();current=s;
  $('connection').textContent=s.online?'SUPABASE · НА СВЯЗИ':'SUPABASE · НЕТ СВЯЗИ';$('connection').className=s.online?'online':'offline';
  const gizmoOk=!!s.last_sync&&Date.now()/1000-s.last_sync<30;
  $('gizmo-connection').textContent=gizmoOk?'GIZMO · НА СВЯЗИ':'GIZMO · НЕТ СВЯЗИ';$('gizmo-connection').className=gizmoOk?'online':'offline';
  $('error').textContent=[s.error,s.sync_error,s.password_sync_error,!s.protocol_ready?'Сервис аккаунтов пока недоступен. Проверьте сообщение об ошибке выше.':''].filter(Boolean).join('\n');
  $('count').textContent=s.rows.filter(b=>!b.instant||b.status==='attention').length;$('alert').hidden=!s.alerts;$('alert-text').textContent=s.alerts+' непрочитанных уведомлений';$('mute').textContent=s.muted?'Включить звук':'Тишина на 5 минут';
  const bookingKey=JSON.stringify(s.rows)+selectedHost;if(refresh.bookingKey!==bookingKey){bookings(s);refresh.bookingKey=bookingKey}
  const hallKey=JSON.stringify(s.hosts)+gizmoOk+JSON.stringify(s.rows.filter(b=>b.instant).map(b=>[b.host_id,b.status]));if(refresh.hallKey!==hallKey){hall(s);refresh.hallKey=hallKey}
  const requests=s.password_requests||[];$('requests-count').textContent=requests.length;
  const resetKey=JSON.stringify(requests);if(refresh.resetKey!==resetKey){renderResetRequests(requests);refresh.resetKey=resetKey}
  if(!soundLoaded&&s.sound){soundLoaded=true;$('sound-preset').value=s.sound.preset;$('sound-volume').value=s.sound.volume;$('sound-repeat').value=s.sound.repeat;$('sound-enabled').checked=s.sound.enabled;$('volume-label').value=s.sound.volume+'%'}
 }catch{$('connection').textContent='ПАНЕЛЬ НЕДОСТУПНА'}finally{inFlight=false}
}
function chooseAccount(user,requestId=null){
 foundAccount=user;selectedResetRequest=requestId;$('new-password').value='';$('identity-checked').checked=false;
 $('account-result').textContent=[user.username,user.firstName,user.lastName,user.mobilePhone||user.phone,'ID '+user.id].filter(Boolean).join(' · ');
 $('account-message').textContent=requestId?'Аккаунт выбран по заявке. Проверьте личность гостя.':'';$('reset-user').hidden=false;
 $('reset-user').scrollIntoView({behavior:'smooth',block:'nearest'});$('new-password').focus({preventScroll:true});
}
function renderResetRequests(requests){
 const box=$('password-requests');box.replaceChildren();
 for(const r of requests){
  const card=document.createElement('section');card.className='reset-request';const title=document.createElement('p');title.textContent='Gizmo ID '+r.gizmo_user_id+' · Telegram '+r.telegram_id;card.append(title);
  const status=document.createElement('p');status.className='note';status.setAttribute('role','status');card.append(status);
  const actions=document.createElement('div');actions.className='request-actions';card.append(actions);
  const action=(label,callback)=>{const btn=document.createElement('button');btn.textContent=label;btn.onclick=async()=>{if(card.dataset.busy)return;card.dataset.busy='1';actions.querySelectorAll('button').forEach(e=>e.disabled=true);try{await callback(status)}finally{delete card.dataset.busy;actions.querySelectorAll('button').forEach(e=>e.disabled=false)}};actions.append(btn)};
  action('Сменить пароль',async status=>{status.textContent='Получаем аккаунт…';const result=await invoke('prepare_password_request',r.id);if(!result?.user){status.textContent=result?.error||'Нет связи';return}chooseAccount(result.user,r.id);status.textContent='Заполните форму смены пароля'});
  for(const [outcome,label,question] of [['done','Услуга предоставлена','Подтверждаете, что услуга по этой заявке уже предоставлена? Пароль этой кнопкой не меняется.'],['rejected','Закрыть без выполнения','Закрыть заявку без смены пароля? Гость увидит, что услуга не выполнена.']]){
   action(label,async status=>{if(!confirm(question))return;const result=await invoke('resolve_password_request',r.id,outcome,true);status.textContent=result?.ok?(result.synced?'Заявка закрыта':'Результат сохранён. Ожидаем синхронизацию с мини-аппом.'):result?.error||'Нет связи';if(result?.ok&&selectedResetRequest===r.id){selectedResetRequest=null;foundAccount=null;$('new-password').value='';$('reset-user').hidden=true}});
  }
  box.append(card);
 }
 if(!requests.length)box.textContent='Ожидающих запросов нет';
}
$('sound-volume').oninput=e=>$('volume-label').value=e.target.value+'%';
async function saveSound(test=false){const result=await invoke('sound_settings',{preset:$('sound-preset').value,volume:Number($('sound-volume').value),repeat:Number($('sound-repeat').value),enabled:$('sound-enabled').checked});$('sound-result').textContent=result?'Настройки сохранены':'Не удалось сохранить';if(test&&result)await invoke('test_sound')}
$('find-user').onsubmit=async e=>{e.preventDefault();foundAccount=null;selectedResetRequest=null;$('reset-user').hidden=true;$('account-message').textContent='Поиск…';const result=await invoke('find_account',$('account-search').value.trim());if(!result?.user){$('account-message').textContent=result?.error||'Нет ответа';return}chooseAccount(result.user)};
$('account-search').oninput=()=>{foundAccount=null;selectedResetRequest=null;$('new-password').value='';$('reset-user').hidden=true;$('account-result').textContent=''};
$('reset-user').onsubmit=async e=>{e.preventDefault();if(!foundAccount||!$('identity-checked').checked)return;if(!confirm('Сменить пароль аккаунта '+foundAccount.username+'?'))return;const btn=e.target.querySelector('button');btn.disabled=true;const password=$('new-password').value;$('new-password').value='';const result=selectedResetRequest?await invoke('reset_password_request',selectedResetRequest,foundAccount.username,password,true):await invoke('reset_password',foundAccount.id,foundAccount.username,password);$('account-message').textContent=result?.ok?(result.synced===false?'Пароль изменён и проверен. Заявка ожидает синхронизации — повторять смену не нужно.':'Пароль изменён и проверен. Услуга предоставлена. Сообщите пароль гостю лично.'):result?.error||'Результат неизвестен. Проверьте аккаунт';if(result?.ok){foundAccount=null;selectedResetRequest=null;$('reset-user').hidden=true}btn.disabled=false;};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
window.addEventListener('pywebviewready',()=>{refresh();setInterval(refresh,2000)});
// Original logo assembled in flight; no club API requests are made for the splash.
for(let i=0;i<9;i++){const piece=document.createElementNS('http://www.w3.org/2000/svg','svg');piece.setAttribute('viewBox','0 0 522 138');piece.style.cssText=`--delay:${i*.06}s;--x:${(i%2?1:-1)*(90+i*14)}px;--y:${(i%3?1:-1)*80}px;--r:${i%2?30:-30}deg`;piece.innerHTML=`<defs><clipPath id="piece-${i}"><rect x="${i*58}" width="58" height="138"/></clipPath></defs><image href="assets/logo.svg" width="522" height="138" clip-path="url(#piece-${i})"/>`;$('assembly').append(piece)}
setTimeout(()=>$('desk-splash').remove(),3200);
(()=>{const c=$('matrix-rain'),ctx=c.getContext('2d'),reduced=matchMedia('(prefers-reduced-motion: reduce)');let columns=[],w,h,raf=0,last=0;function resize(){w=innerWidth;h=innerHeight;c.width=w;c.height=h;columns=Array.from({length:Math.ceil(w/24)},()=>Math.random()*h/20)}function draw(t){if(document.hidden||reduced.matches){raf=0;return}raf=requestAnimationFrame(draw);if(t-last<90)return;last=t;ctx.fillStyle='#0002';ctx.fillRect(0,0,w,h);ctx.font='14px monospace';ctx.fillStyle='#ffffff88';const glyphs='⌁×+⟋⟍⋮⊞◇▱⊥⌜⌟≋';columns.forEach((y,i)=>{ctx.fillText(glyphs[Math.random()*glyphs.length|0],i*24,y*20);columns[i]=y*20>h&&Math.random()>.97?0:y+.4})}function start(){if(!raf&&!document.hidden&&!reduced.matches)raf=requestAnimationFrame(draw)}addEventListener('resize',resize);document.addEventListener('visibilitychange',start);reduced.addEventListener('change',start);resize();start()})();
