const $=id=>document.getElementById(id);
document.title=DESK_BUILD.title;$('window-title').textContent=DESK_BUILD.title;$('build-author').textContent=DESK_BUILD.author;$('build-version').textContent='CLUB DESK / v'+DESK_BUILD.version;
const labels={requested:'Ожидает обработки',waiting:'ПК занят · ждём освобождения',holding:'ПК ждёт гостя',checkin_pending:'Подтверждаем вход',in_session:'Гость играет',attention:'Требует проверки',cancel_requested:'Снимаем бронь',release_requested:'Разблокируем для друга'};
const fmt=v=>new Date(v).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'});
let current=null,selectedHost=null,foundAccount=null,inFlight=false,soundLoaded=false,selectedResetRequest=null;
function panel(name){document.querySelectorAll('[id^=panel-]').forEach(e=>e.hidden=e.id!=='panel-'+name);document.querySelectorAll('[data-panel]').forEach(e=>e.classList.toggle('active',e.dataset.panel===name))}
document.querySelectorAll('[data-panel]').forEach(e=>e.onclick=()=>panel(e.dataset.panel));
async function invoke(method,...args){try{const result=await window.pywebview.api[method](...args);if(!['booking_guest','find_account','search_accounts','select_account'].includes(method))await refresh();return result}catch{$('error').textContent='Не удалось выполнить команду. Проверьте связь с агентом';return null}}
function selectHost(id){selectedHost=id;panel('bookings');if(current){bookings(current);refresh.bookingKey=JSON.stringify(current.rows)+selectedHost}}
// Keep stable nodes: polling must not collapse details, steal focus or reset selection.
function setDeskText(node,value){const text=String(value??'');if(node.textContent!==text)node.textContent=text}
function reconcileDeskChildren(parent,nodes){
 const wanted=new Set(nodes);for(const child of [...parent.children])if(!wanted.has(child))child.remove();
 nodes.forEach((node,i)=>{if(parent.children[i]!==node)parent.insertBefore(node,parent.children[i]||null)});
}
async function copyDeskText(value,status){
 try{await navigator.clipboard.writeText(String(value));setDeskText(status,'Скопировано')}
 catch{setDeskText(status,'Не удалось скопировать. Выделите текст и нажмите Ctrl+C')}
}
function makeBookingCard(){
 const card=document.createElement('article'),fields={};
 const add=(key,tag,cl)=>{const node=document.createElement(tag);if(cl)node.className=cl;fields[key]=node;card.append(node);return node};
 add('tag','span','tag');add('host','h2');add('guest','p');add('status','p');add('time','p');
 const details=add('details','details','guest-details'),heading=document.createElement('summary');heading.textContent='Информация о госте';details.append(heading);
 const info=document.createElement('div');details.append(info);
 const detailRows=['Имя','Никнейм','Телефон','Gizmo ID','Telegram ID'].map(label=>{const p=document.createElement('p');info.append(p);return {p,label}});
 const phone=document.createElement('button');phone.type='button';phone.textContent='Копировать телефон';details.append(phone);
 const detailStatus=document.createElement('p');detailStatus.setAttribute('role','status');details.append(detailStatus);
 function guestInfo(values){values.forEach((value,i)=>setDeskText(detailRows[i].p,detailRows[i].label+': '+(value||'Нет данных')));card.phone=values[2]||'';phone.disabled=!card.phone}
 phone.onclick=()=>copyDeskText(card.phone,detailStatus);
 details.addEventListener('toggle',async()=>{
  if(!details.open||details.dataset.loaded||details.dataset.loading)return;
  details.dataset.loading='1';const identity=card.identity;const r=await invoke('booking_guest',card.booking.id);delete details.dataset.loading;
  if(!card.isConnected||identity!==card.identity)return;
  if(r?.user){details.dataset.loaded='1';guestInfo([[r.user.firstName,r.user.lastName].filter(Boolean).join(' '),r.user.username,r.user.mobilePhone||r.user.phone,r.gizmo_user_id,r.telegram_id]);setDeskText(detailStatus,'')}
  else setDeskText(detailStatus,r?.error||'Нет связи с Gizmo');
 });
 add('codeLabel','small');setDeskText(fields.codeLabel,'Код старой брони');add('code','strong','code');add('message','p','dim');add('id','small');
 const actions=add('actions','div','actions');const copy=document.createElement('button');copy.type='button';copy.textContent='Копировать номер брони';actions.append(copy);
 const copyStatus=add('copyStatus','p','note');copyStatus.setAttribute('role','status');copy.onclick=()=>copyDeskText(card.booking.id,copyStatus);
 const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Отменить бронь';actions.append(cancel);
 cancel.onclick=async()=>{const b=card.booking;if(!confirm('Отменить бронь ПК '+b.host_id+'? Сессия игрока не будет завершена.'))return;cancel.disabled=true;try{const r=await invoke('cancel_booking',b.id);if(r?.error)setDeskText($('error'),r.error)}finally{cancel.disabled=false}};
 card.update=b=>{
  card.booking=b;card.dataset.bookingId=b.id;const cl='card '+b.status;if(card.className!==cl)card.className=cl;
  const identity=JSON.stringify([b.gizmo_user_id,b.telegram_id]);if(identity!==card.identity){card.identity=identity;delete details.dataset.loaded;setDeskText(detailStatus,'')}
  setDeskText(fields.tag,b.instant?'ВХОД СЕЙЧАС':b.mode==='arrival'?'В ТЕЧЕНИЕ ЧАСА':'КО ВРЕМЕНИ');setDeskText(fields.host,'ПК '+b.host_id);
  setDeskText(fields.guest,(b.guest_name||b.username||'Гость')+(b.for_friend?' · для друга':''));setDeskText(fields.status,labels[b.status]||b.status);
  setDeskText(fields.time,clubArrivalLabel(b.starts_at)+' → '+(b.duration_kind==='open'?'Как пойдёт':clubArrivalLabel(b.ends_at)));
  if(!details.dataset.loaded)guestInfo([[b.first_name,b.last_name].filter(Boolean).join(' '),b.username,b.mobile_phone,b.gizmo_user_id,b.telegram_id]);
  fields.codeLabel.hidden=fields.code.hidden=!b.code;setDeskText(fields.code,b.code);setDeskText(fields.message,b.message||'Без прерывания активных сессий');setDeskText(fields.id,'Бронь '+b.id);
  cancel.hidden=!['requested','waiting','holding','attention','checkin_pending','release_requested','in_session'].includes(b.status);
 };
 return card;
}
function bookings(s){
 const grid=$('grid');setDeskText($('booking-title'),selectedHost?'Брони ПК '+selectedHost:'Все брони');
 const filter=$('booking-filter').value,sort=$('booking-sort').value;
 const rows=s.rows.filter(b=>(!b.instant||b.status==='attention')&&(!selectedHost||b.host_id===selectedHost)&&(filter==='all'||b.status===filter||b.mode===filter)).sort((a,b)=>sort==='host'?Number(a.host_id)-Number(b.host_id):sort==='name'?String(a.username||'').localeCompare(String(b.username||'')):Date.parse(a.starts_at)-Date.parse(b.starts_at));
 const existing=new Map([...grid.children].map(card=>[card.dataset.bookingId,card]));
 const nodes=rows.map(b=>{const card=existing.get(String(b.id))||makeBookingCard();card.update(b);return card});
 if(!nodes.length){const empty=grid.querySelector('.empty')||document.createElement('div');empty.className='empty';setDeskText(empty,selectedHost?'У этого ПК нет активных броней':'Активных броней пока нет');nodes.push(empty)}
 reconcileDeskChildren(grid,nodes);
}
for(const id of ['booking-filter','booking-sort'])$(id).onchange=()=>{if(current)bookings(current)};
function hall(s){
 const map=$('desk-map'),fresh=s.last_sync&&Date.now()/1000-s.last_sync<30;
 if(!map.children.length){
  for(const group of ['vip','standard']){
   const section=document.createElement('section');section.className='desk-zone';const heading=document.createElement('h3');heading.textContent=group==='vip'?'VIP · РЯДЫ 10 / 20':'STANDARD · ЗОНЫ 100 / 200 / 300 / 400';section.append(heading);
   const grid=document.createElement('div');grid.className='desk-zone-grid physical-grid '+group;
   for(const pc of getZoneSeats(group)){const layouts=getPhysicalZones(group),zi=layouts.findIndex(z=>z.zone===pc.zone);const row=pc.row+layouts.slice(0,zi).reduce((n,z)=>n+z.rows.length+1,0);
    const btn=document.createElement('button');btn.style.gridRow=row;btn.style.gridColumn=pc.column;btn.dataset.hostId=pc.id;
    const number=document.createElement('b');number.textContent=pc.id;const state=document.createElement('span');btn.append(number,state);const phone=document.createElement('i');phone.className='miniapp-booking';phone.hidden=true;phone.setAttribute('aria-hidden','true');phone.innerHTML='<svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/></svg>';btn.append(phone);btn.onclick=()=>selectHost(pc.id);grid.append(btn);
   }
   section.append(grid);map.append(section);
  }
 }
 const hosts=new Map((s.hosts||[]).map(h=>[h.host_id,h]));
 for(const btn of map.querySelectorAll('[data-host-id]')){
  const id=btn.dataset.hostId,connecting=s.rows.some(b=>b.instant&&b.host_id===id&&['requested','holding','checkin_pending'].includes(b.status));
  const status=connecting?'connecting':fresh?(hosts.get(id)?.status||'unknown'):'unknown';
  const reservation=s.rows.find(b=>b.host_id===id&&!b.instant&&!b.admin_created&&['requested','waiting','holding','attention','checkin_pending','cancel_requested'].includes(b.status));
  const phone=btn.querySelector('.miniapp-booking');if(phone.hidden===!!reservation)phone.hidden=!reservation;
  const title='ПК '+id+': '+HOST_LABELS[status]+(reservation?' · Бронь из мини-приложения · '+(reservation.username||reservation.guest_name||'Гость'):'');
  if(btn.title!==title){btn.title=title;btn.setAttribute('aria-label',title)}
  if(btn.dataset.status===status)continue;
  btn.dataset.status=status;btn.className='desk-pc '+status;const state=btn.querySelector('span');
  if(status==='reserved')state.innerHTML='<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Бронь';
  else if(status==='broken')state.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3a6 6 0 0 0-7 8L2 16a3 3 0 0 0 4 4l5-5a6 6 0 0 0 8-7l-4 4-3-3 4-4Z"/></svg>';
  else setDeskText(state,HOST_LABELS[status]);
 }
}
async function refresh(){
 if(document.hidden||inFlight||!window.pywebview?.api)return;inFlight=true;
 try{
  const s=await window.pywebview.api.snapshot();current=s;window.renderReminders?.(s);window.updateAdminActions?.();window.renderRegistrations?.(s);
  setDeskText($('connection'),(s.backend_label||'Сервер').toUpperCase()+(s.online?' · НА СВЯЗИ':' · НЕТ СВЯЗИ'));$('connection').className=s.online?'online':'offline';
  const gizmoOk=!!s.last_sync&&Date.now()/1000-s.last_sync<30;
  setDeskText($('gizmo-connection'),gizmoOk?'GIZMO · НА СВЯЗИ':'GIZMO · НЕТ СВЯЗИ');$('gizmo-connection').className=gizmoOk?'online':'offline';
  setDeskText($('error'),[s.error,s.sync_error,s.password_sync_error,!s.protocol_ready?'Сервис аккаунтов пока недоступен. Проверьте сообщение об ошибке выше.':''].filter(Boolean).join('\n'));
  setDeskText($('count'),s.rows.filter(b=>!b.instant||b.status==='attention').length);$('alert').hidden=!s.alerts;setDeskText($('alert-text'),'Последние события · без подтверждения прочтения');renderNotices(s.notifications||[]);
  const bookingKey=JSON.stringify(s.rows)+selectedHost;if(refresh.bookingKey!==bookingKey){bookings(s);refresh.bookingKey=bookingKey}
  const hallKey=JSON.stringify(s.hosts)+gizmoOk+JSON.stringify(s.rows.map(b=>[b.host_id,b.status,b.instant,b.admin_created,b.username,b.guest_name]));if(refresh.hallKey!==hallKey){hall(s);refresh.hallKey=hallKey}
  const requests=s.password_requests||[];setDeskText($('requests-count'),requests.length);
  const resetKey=JSON.stringify(requests);if(refresh.resetKey!==resetKey){renderResetRequests(requests);refresh.resetKey=resetKey}
  window.renderGuestPasswords?.(s);
  if(!soundLoaded&&s.sound){soundLoaded=true;$('sound-preset').value=s.sound.preset;$('sound-volume').value=s.sound.volume;for(const kind of ['created','waiting','attention'])$('sound-'+kind).value=s.sound.events?.[kind]||s.sound.preset;$('sound-enabled').checked=s.sound.enabled;$('volume-label').value=s.sound.volume+'%'}
 }catch{$('connection').textContent='ПАНЕЛЬ НЕДОСТУПНА'}finally{inFlight=false}
}
function chooseAccount(user,requestId=null){
 foundAccount=user;selectedResetRequest=requestId;$('new-password').value='';$('identity-checked').checked=false;
 $('account-result').textContent=[user.username,user.firstName,user.lastName,user.mobilePhone||user.phone,'ID '+user.id].filter(Boolean).join(' · ');
 $('account-message').textContent=requestId?'Аккаунт выбран по заявке. Проверьте личность гостя.':'';$('reset-user').hidden=false;
 $('reset-user').scrollIntoView({behavior:'smooth',block:'nearest'});$('new-password').focus({preventScroll:true});
}
function renderResetRequests(requests){
 const box=$('password-requests'),existing=new Map([...$('password-requests').children].map(card=>[card.dataset.requestId,card])),nodes=[];
 for(const r of requests){
  const previous=existing.get(String(r.id));if(previous){setDeskText(previous.firstChild,'Gizmo ID '+r.gizmo_user_id+' · Telegram '+r.telegram_id);nodes.push(previous);continue}
  const card=document.createElement('section');card.className='reset-request';card.dataset.requestId=r.id;const title=document.createElement('p');title.textContent='Gizmo ID '+r.gizmo_user_id+' · Telegram '+r.telegram_id;card.append(title);
  const status=document.createElement('p');status.className='note';status.setAttribute('role','status');card.append(status);
  const actions=document.createElement('div');actions.className='request-actions';card.append(actions);
  const action=(label,callback)=>{const btn=document.createElement('button');btn.textContent=label;btn.onclick=async()=>{if(card.dataset.busy)return;card.dataset.busy='1';actions.querySelectorAll('button').forEach(e=>e.disabled=true);try{await callback(status)}finally{delete card.dataset.busy;actions.querySelectorAll('button').forEach(e=>e.disabled=false)}};actions.append(btn)};
  action('Сменить пароль',async status=>{status.textContent='Получаем аккаунт…';const result=await invoke('prepare_password_request',r.id);if(!result?.user){status.textContent=result?.error||'Нет связи';return}chooseAccount(result.user,r.id);status.textContent='Заполните форму смены пароля'});
  for(const [outcome,label,question] of [['done','Услуга предоставлена','Подтверждаете, что услуга по этой заявке уже предоставлена? Пароль этой кнопкой не меняется.'],['rejected','Закрыть без выполнения','Закрыть заявку без смены пароля? Гость увидит, что услуга не выполнена.']]){
   action(label,async status=>{if(!confirm(question))return;const result=await invoke('resolve_password_request',r.id,outcome,true);status.textContent=result?.ok?(result.synced?'Заявка закрыта':'Результат сохранён. Ожидаем синхронизацию с мини-аппом.'):result?.error||'Нет связи';if(result?.ok&&selectedResetRequest===r.id){selectedResetRequest=null;foundAccount=null;$('new-password').value='';$('reset-user').hidden=true}});
  }
  nodes.push(card);
 }
 if(!nodes.length){const empty=box.querySelector('.empty-requests')||document.createElement('p');empty.className='empty-requests';setDeskText(empty,'Ожидающих запросов нет');nodes.push(empty)}
 reconcileDeskChildren(box,nodes);
}
$('sound-volume').oninput=e=>$('volume-label').value=e.target.value+'%';
async function saveSound(test=false,kind=null){const result=await invoke('sound_settings',{preset:$('sound-preset').value,volume:Number($('sound-volume').value),events:Object.fromEntries(['created','waiting','attention'].map(kind=>[kind,$('sound-'+kind).value])),enabled:$('sound-enabled').checked});$('sound-result').textContent=result?'Настройки сохранены':'Не удалось сохранить';if(test&&result)await invoke('test_sound',kind)}
$('find-user').onsubmit=async e=>{e.preventDefault();foundAccount=null;selectedResetRequest=null;$('reset-user').hidden=true;$('account-message').textContent='Поиск…';const result=await invoke('find_account',$('account-search').value.trim());if(!result?.user){$('account-message').textContent=result?.error||'Нет ответа';return}chooseAccount(result.user)};
$('account-search').oninput=()=>{foundAccount=null;selectedResetRequest=null;$('new-password').value='';$('reset-user').hidden=true;$('account-result').textContent=''};
$('reset-user').onsubmit=async e=>{e.preventDefault();if(!foundAccount||!$('identity-checked').checked)return;if(!confirm('Сменить пароль аккаунта '+foundAccount.username+'?'))return;const btn=e.target.querySelector('button');btn.disabled=true;const password=$('new-password').value;$('new-password').value='';const result=selectedResetRequest?await invoke('reset_password_request',selectedResetRequest,foundAccount.username,password,true):await invoke('reset_password',foundAccount.id,foundAccount.username,password);$('account-message').textContent=result?.ok?(result.synced===false?'Пароль изменён и проверен. Заявка ожидает синхронизации — повторять смену не нужно.':'Пароль изменён и проверен. Услуга предоставлена. Сообщите пароль гостю лично.'):result?.error||'Результат неизвестен. Проверьте аккаунт';if(result?.ok){foundAccount=null;selectedResetRequest=null;$('reset-user').hidden=true}btn.disabled=false;};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
window.addEventListener('pywebviewready',()=>{refresh();setInterval(refresh,2000)});
// Original logo assembled in flight; no club API requests are made for the splash.
for(let i=0;i<9;i++){const piece=document.createElementNS('http://www.w3.org/2000/svg','svg');piece.setAttribute('viewBox','0 0 522 138');piece.style.cssText=`--delay:${i*.06}s;--x:${(i%2?1:-1)*(90+i*14)}px;--y:${(i%3?1:-1)*80}px;--r:${i%2?30:-30}deg`;piece.innerHTML=`<defs><clipPath id="piece-${i}"><rect x="${i*58}" width="58" height="138"/></clipPath></defs><image href="assets/logo.svg" width="522" height="138" clip-path="url(#piece-${i})"/>`;$('assembly').append(piece)}
setTimeout(()=>$('desk-splash').remove(),3200);
(()=>{const c=$('matrix-rain'),ctx=c.getContext('2d'),reduced=matchMedia('(prefers-reduced-motion: reduce)');let columns=[],w,h,raf=0,last=0;function resize(){w=innerWidth;h=innerHeight;c.width=w;c.height=h;columns=Array.from({length:Math.ceil(w/24)},()=>Math.random()*h/20)}function draw(t){if(document.hidden||reduced.matches){raf=0;return}raf=requestAnimationFrame(draw);if(t-last<90)return;last=t;ctx.fillStyle='#0002';ctx.fillRect(0,0,w,h);ctx.font='14px monospace';ctx.fillStyle='#ffffff88';const glyphs='⌁×+⟋⟍⋮⊞◇▱⊥⌜⌟≋';columns.forEach((y,i)=>{ctx.fillText(glyphs[Math.random()*glyphs.length|0],i*24,y*20);columns[i]=y*20>h&&Math.random()>.97?0:y+.4})}function start(){if(!raf&&!document.hidden&&!reduced.matches)raf=requestAnimationFrame(draw)}addEventListener('resize',resize);document.addEventListener('visibilitychange',start);reduced.addEventListener('change',start);resize();start()})();

for(const kind of ['created','waiting','attention']){const select=$('sound-'+kind);select.innerHTML=$('sound-preset').innerHTML;const preview=document.createElement('button');preview.type='button';preview.textContent='Прослушать';preview.onclick=()=>saveSound(true,kind);select.after(preview)}
$('sound-enabled').onchange=()=>saveSound(false);
function renderNotices(rows){
 const container=$('notice-cards'),key=JSON.stringify(rows);if(container.dataset.key===key)return;container.dataset.key=key;
 const cards=rows.slice(-5).reverse().map(event=>{const card=document.createElement('div');card.className='notice-card';const title=document.createElement('strong');title.textContent=({created:'Новая бронь',waiting:'Ожидание компьютера',attention:'Нужна проверка'}[event.kind]||'Событие клуба');card.append(title);if(event.created_at){const time=document.createElement('small');const date=new Date(event.created_at);if(Number.isFinite(date.getTime()))time.textContent=date.toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК';card.append(time)}return card});container.replaceChildren(...cards);
}
