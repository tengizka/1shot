const $=id=>document.getElementById(id);
document.title=DESK_BUILD.title;$('window-title').textContent='1SHOT / CLUB DESK';$('build-author').textContent=DESK_BUILD.author;$('build-version').textContent='CLUB DESK / v'+DESK_BUILD.version;
const labels={requested:'Ожидает обработки',waiting:'ПК занят · ждём',holding:'Ждёт гостя',checkin_pending:'Подтверждаем вход',in_session:'Гость играет',attention:'Требует проверки',cancel_requested:'Снимаем бронь',release_requested:'Разблокируем для друга'};
const fmt=v=>new Date(v).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'});
const hostName=id=>String(id)==='1'?'PS5':'ПК '+id;
let current=null,selectedHost=null,foundAccount=null,inFlight=false,soundLoaded=false,selectedResetRequest=null,view='hall';

function panel(name){
 view=name;window.closeHostMenu?.();
 document.querySelectorAll('main>section[id^=panel-]').forEach(e=>e.hidden=e.id!=='panel-'+name);
 document.body.dataset.view=name;
 document.querySelectorAll('[data-panel]').forEach(e=>e.classList.toggle('active',e.dataset.panel===name));
}
document.querySelectorAll('[data-panel]').forEach(e=>e.onclick=()=>panel(e.dataset.panel));
async function invoke(method,...args){try{const result=await window.pywebview.api[method](...args);if(!['booking_guest','find_account','search_accounts','select_account','check_update','download_update'].includes(method))await refresh();return result}catch{$('error').textContent='Не удалось выполнить команду. Проверьте связь с агентом';return null}}
/* The list always shows every booking; a picked PC only highlights its own and owns the «+». */
let picked=new Set();
// Left click picks a PC, Ctrl+click or a drag frame picks several (company booking); right click opens actions.
function selectHosts(ids,scroll=true){
 picked=new Set(ids.map(String));selectedHost=picked.size?[...picked].at(-1):null;if(view!=='hall')panel('hall');
 document.querySelectorAll('#desk-map [data-host-id]').forEach(b=>b.classList.toggle('selected',picked.has(b.dataset.hostId)));
 markSelected(scroll);
}
function selectHost(id){selectHosts(id==null?[]:[id])}
function markSelected(scroll=false){
 setDeskText($('add-booking-label'),picked.size>1?'Бронь · '+picked.size+' ПК':selectedHost?'Бронь · '+hostName(selectedHost):'Бронь');
 let first=null;for(const card of $('grid').querySelectorAll('.card[data-booking-id]')){const on=picked.has(card.booking?.host_id);card.classList.toggle('focus',on);if(on&&!first)first=card}
 if(scroll&&first)first.scrollIntoView({block:'nearest',behavior:'smooth'});
}
// Second tap confirms: no system dialogs anywhere in Desk.
function armTap(btn,armed,action){
 if(btn.dataset.armed){clearTimeout(btn.armTimer);delete btn.dataset.armed;btn.textContent=btn.dataset.label;action();return}
 btn.dataset.label=btn.textContent;btn.dataset.armed='1';btn.textContent=armed;
 btn.armTimer=setTimeout(()=>{if(btn.dataset.armed){delete btn.dataset.armed;btn.textContent=btn.dataset.label}},3000);
}
// Keep stable nodes: polling must not collapse details, steal focus or reset selection.
function setDeskText(node,value){const text=String(value??'');if(node.textContent!==text)node.textContent=text}
function reconcileDeskChildren(parent,nodes){
 const wanted=new Set(nodes);for(const child of [...parent.children])if(!wanted.has(child))child.remove();
 nodes.forEach((node,i)=>{if(parent.children[i]!==node)parent.insertBefore(node,parent.children[i]||null)});
}
// Clipboard: browser API, then the old execCommand path, then Windows clip.exe through Desk.
async function deskCopy(value){
 const text=String(value);
 try{await navigator.clipboard.writeText(text);return true}catch{}
 try{const area=document.createElement('textarea');area.value=text;area.style.cssText='position:fixed;opacity:0;left:-999px';document.body.append(area);area.select();const ok=document.execCommand('copy');area.remove();if(ok)return true}catch{}
 try{const r=await window.pywebview?.api?.copy_text?.(text);return !!r?.ok}catch{return false}
}
async function copyDeskText(value,status){
 setDeskText(status,await deskCopy(value)?'Скопировано':'Не удалось скопировать. Выделите текст и нажмите Ctrl+C');
}

/* Compact booking row: PC, guest, time and status on two lines; guest data folds out. */
function makeBookingCard(){
 const card=document.createElement('article'),fields={};
 const el=(parent,key,tag,cl)=>{const node=document.createElement(tag);if(cl)node.className=cl;if(key)fields[key]=node;parent.append(node);return node};
 const top=el(card,null,'div','card-top');el(top,'host','h2');el(top,'tag','span','tag');el(top,'time','p','time');
 const mid=el(card,null,'div','card-mid');el(mid,'guest','p','guest');el(mid,'status','p','status-pill');
 el(card,'codeLabel','small','code-label');setDeskText(fields.codeLabel,'Код старой брони');el(card,'code','strong','code');el(card,'message','p','dim');
 const details=el(card,'details','details','guest-details'),heading=document.createElement('summary');heading.textContent='Гость';details.append(heading);
 const info=document.createElement('div');info.className='guest-info';details.append(info);
 const detailRows=['Имя','Никнейм','Телефон','Gizmo ID','Telegram ID'].map(label=>{const p=document.createElement('p');info.append(p);return {p,label}});
 const phone=document.createElement('button');phone.type='button';phone.textContent='Копировать телефон';details.append(phone);
 const detailStatus=document.createElement('p');detailStatus.setAttribute('role','status');details.append(detailStatus);
 el(details,'id','small','booking-id');
 function guestInfo(values){values.forEach((value,i)=>setDeskText(detailRows[i].p,detailRows[i].label+': '+(value||'Нет данных')));card.phone=values[2]||'';phone.disabled=!card.phone}
 phone.onclick=()=>copyDeskText(card.phone,detailStatus);
 details.addEventListener('toggle',async()=>{
  if(!details.open||details.dataset.loaded||details.dataset.loading)return;
  details.dataset.loading='1';const identity=card.identity;const r=await invoke('booking_guest',card.booking.id);delete details.dataset.loading;
  if(!card.isConnected||identity!==card.identity)return;
  if(r?.user){details.dataset.loaded='1';guestInfo([[r.user.firstName,r.user.lastName].filter(Boolean).join(' '),r.user.username,r.user.mobilePhone||r.user.phone,r.gizmo_user_id,r.telegram_id]);setDeskText(detailStatus,'')}
  else setDeskText(detailStatus,r?.error||'Нет связи с Gizmo');
 });
 const actions=el(card,'actions','div','actions');actions.append(details);
 const seat=document.createElement('button');seat.type='button';seat.className='btn-seat';seat.textContent='Посадить';seat.setAttribute('aria-label','Гость пришёл / Посадить за ПК');seat.title='Гость пришёл — посадить за ПК';actions.append(seat);
 seat.onclick=async()=>{
  const b=card.booking;
  if(b.gizmo_user_id&&b.gizmo_user_id>0){
   setDeskText(copyStatus,'Выполняем посадку за ПК…');
   const res=await invoke('seat_guest',b.id,b.host_id,b.gizmo_user_id);
   setDeskText(copyStatus,res?.ok?'Гость посажен за ПК '+b.host_id:res?.error||'Ошибка посадки');
  }else if(window.openHostMenu){selectHost(b.host_id);window.openHostMenu(b.host_id,'login')}
  else{panel('accounts');$('account-search').focus();setDeskText(copyStatus,'Бронь без аккаунта. Выберите аккаунт гостя для посадки за ПК '+b.host_id)}
 };
 fields.seat=seat;
 const copy=document.createElement('button');copy.type='button';copy.className='icon-btn';copy.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="8" y="8" width="13" height="13"/><path d="M16 8V3H3v13h5"/></svg>';copy.setAttribute('aria-label','Копировать номер брони');copy.title='Копировать номер брони';actions.append(copy);
 const cancel=document.createElement('button');cancel.type='button';cancel.className='btn-cancel';cancel.textContent='Отменить';cancel.setAttribute('aria-label','Отменить бронь');actions.append(cancel);
 const copyStatus=el(card,'copyStatus','p','note');copyStatus.setAttribute('role','status');copy.onclick=()=>copyDeskText(card.booking.id,copyStatus);
 cancel.onclick=()=>armTap(cancel,'Точно?',async()=>{const b=card.booking;cancel.disabled=true;try{const r=await invoke('cancel_booking',b.id);if(r?.error)setDeskText($('error'),r.error)}finally{cancel.disabled=false}});
 card.update=b=>{
  card.booking=b;card.dataset.bookingId=b.id;const cl='card '+b.status;if(card.className!==cl)card.className=cl;
  const identity=JSON.stringify([b.gizmo_user_id,b.telegram_id]);if(identity!==card.identity){card.identity=identity;delete details.dataset.loaded;setDeskText(detailStatus,'')}
  setDeskText(fields.tag,b.instant?'ВХОД СЕЙЧАС':b.admin_created?'ОТ АДМИНА':b.mode==='arrival'?'В ТЕЧЕНИЕ ЧАСА':'КО ВРЕМЕНИ');setDeskText(fields.host,hostName(b.host_id));
  setDeskText(fields.guest,(b.guest_name||b.username||'Гость')+(b.for_friend?' · для друга':''));setDeskText(fields.status,labels[b.status]||b.status);
  setDeskText(fields.time,clubArrivalLabel(b.starts_at)+' → '+(b.duration_kind==='open'?'как пойдёт':fmt(b.ends_at)));
  if(!details.dataset.loaded)guestInfo([[b.first_name,b.last_name].filter(Boolean).join(' '),b.username,b.mobile_phone,b.gizmo_user_id,b.telegram_id]);
  fields.codeLabel.hidden=fields.code.hidden=!b.code;setDeskText(fields.code,b.code);setDeskText(fields.message,b.message||'');setDeskText(fields.id,'Бронь '+b.id);
  fields.seat.hidden=!['holding','requested','waiting','checkin_pending'].includes(b.status)||b.host_id==='1';
  cancel.hidden=!['requested','waiting','holding','attention','checkin_pending','release_requested','in_session'].includes(b.status);
 };
 return card;
}
// Company bookings: admin bookings with the same start and name are shown as one block.
const groupKey=b=>b.admin_created&&b.guest_name?b.starts_at+'|'+b.guest_name:null;
function makeGroup(key){
 const box=document.createElement('section');box.className='booking-group';box.dataset.key=key;
 box.innerHTML='<div class="group-head"><span class="tag">Компания</span><h3></h3><p class="time"></p></div><p class="group-pcs"></p><div class="group-body"></div><div class="actions"><button type="button" class="btn-cancel group-cancel" aria-label="Отменить бронь компании">Отменить всех</button></div>';
 box.querySelector('.group-cancel').onclick=e=>armTap(e.currentTarget,'Точно всех?',async()=>{for(const card of box.querySelectorAll('.card[data-booking-id]'))await invoke('cancel_booking',card.booking.id)});
 return box;
}
function bookings(s){
 const grid=$('grid');
 const rows=s.rows.filter(b=>!b.instant||b.status==='attention').sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at)||Number(a.host_id)-Number(b.host_id));
 setDeskText($('booking-total'),rows.length||'');
 const existing=new Map([...grid.querySelectorAll('.card[data-booking-id]')].map(card=>[card.dataset.bookingId,card]));
 const groups=new Map([...grid.querySelectorAll('.booking-group')].map(g=>[g.dataset.key,g]));
 const count={};rows.forEach(b=>{const k=groupKey(b);if(k)count[k]=(count[k]||0)+1});
 const nodes=[],members=new Map();
 for(const b of rows){
  const card=existing.get(String(b.id))||makeBookingCard();card.update(b);
  const k=groupKey(b);
  if(k&&count[k]>1){let g=groups.get(k);if(!g){g=makeGroup(k);groups.set(k,g)}if(!members.has(k)){members.set(k,[]);nodes.push(g)}members.get(k).push(card)}
  else nodes.push(card);
 }
 for(const [k,cards] of members){const g=groups.get(k),b=cards[0].booking;setDeskText(g.querySelector('h3'),b.guest_name);setDeskText(g.querySelector('.time'),clubArrivalLabel(b.starts_at));setDeskText(g.querySelector('.group-pcs'),cards.length+' ПК · '+cards.map(c=>c.booking.host_id).join(' · '));reconcileDeskChildren(g.querySelector('.group-body'),cards)}
 if(!nodes.length){const empty=grid.querySelector('.empty')||document.createElement('div');empty.className='empty';setDeskText(empty,'Броней пока нет');nodes.push(empty)}
 reconcileDeskChildren(grid,nodes);markSelected();
}

/* Hall plan: the same schematic as the mini-app (360×416 units), scaled to fit the board. */
const PLAN_SEATS={11:[140,40],12:[180,40],13:[220,40],14:[260,40],15:[300,40],21:[140,128],22:[180,128],23:[220,128],24:[260,128],25:[300,128],
 402:[24,32],401:[64,32],304:[24,96],303:[64,96],302:[24,136],301:[64,136],
 204:[24,208],205:[24,248],206:[24,288],207:[24,328],208:[24,368],201:[64,288],202:[64,328],203:[64,368],
 104:[184,208],105:[184,248],106:[184,288],101:[256,208],102:[256,248],103:[256,288]};
const PLAN_ZONES=[['Зона 400',8,8,104,56,''],['Зона 300',8,72,104,104,''],['VIP 1',120,8,232,80,'vip1'],['VIP 2',120,96,232,80,'vip2'],['Зона 200',8,184,104,224,''],['Зона 100',120,184,232,152,'']];
const planRoom=id=>{const n=Number(id);return n<20?'vip1':n<30?'vip2':'std'};
function buildPlan(container,{picker=false,onPick,onMenu}={}){
 const layer=document.createElement('div');layer.className='plan-layer';
 for(const [title,x,y,w,h,room] of PLAN_ZONES){const z=document.createElement('div');z.className='plan-zone'+(room?' '+room:'');z.style.cssText=`left:${x}px;top:${y}px;width:${w}px;height:${h}px`;const t=document.createElement('span');t.textContent=title;z.append(t);layer.append(z)}
 const buttons=new Map();
 for(const [id,[x,y]] of Object.entries(PLAN_SEATS)){
  const btn=document.createElement('button');btn.type='button';btn.className='desk-pc unknown';btn.style.left=x+'px';btn.style.top=y+'px';btn.dataset.room=planRoom(id);
  if(picker){btn.textContent=id}
  else{btn.dataset.hostId=id;const number=document.createElement('b');number.textContent=id;const state=document.createElement('span');state.className='pc-state';const phone=document.createElement('i');phone.className='miniapp-booking';phone.hidden=true;phone.setAttribute('aria-hidden','true');btn.append(number,state,phone)}
  btn.onclick=e=>onPick?.(id,btn,e);btn.oncontextmenu=e=>{e.preventDefault();(onMenu||onPick)?.(id,btn,e)};layer.append(btn);buttons.set(id,btn);
 }
 if(!picker){const ps5=document.createElement('button');ps5.type='button';ps5.className='desk-ps5 unknown';ps5.dataset.hostId='1';ps5.innerHTML='<svg viewBox="0 0 32 24" aria-hidden="true"><path d="M10 5h12c3 0 4 3 5 6l2 7c1 4-3 5-5 2l-3-3H11l-3 3c-2 3-6 2-5-2l2-7c1-3 2-6 5-6Z"/><path d="M9 9v6m-3-3h6"/></svg><span><strong>TV-зона PS5</strong><small class="pc-state"></small></span><i class="miniapp-booking" hidden aria-hidden="true"></i>';ps5.onclick=e=>onPick?.('1',ps5,e);ps5.oncontextmenu=e=>{e.preventDefault();(onMenu||onPick)?.('1',ps5,e)};layer.append(ps5);buttons.set('1',ps5)}
 container.replaceChildren(layer);
 const fit=()=>{const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;const s=Math.min(w/360,h/416);layer.style.transform=`translate(${Math.max(0,(w-360*s)/2)}px,${Math.max(0,(h-416*s)/2)}px) scale(${s})`};
 new ResizeObserver(fit).observe(container);fit();
 return buttons;
}
window.buildDeskPlan=buildPlan;
const STATE_SHORT={free:'',busy:'',reserved:'бронь',broken:'ремонт',unknown:'',connecting:'вход'};
function hall(s){
 const map=$('desk-map'),fresh=s.last_sync&&Date.now()/1000-s.last_sync<30;
 if(!map.children.length){buildPlan(map,{
  onPick:(id,btn,e)=>{
   if(pickMode){selectHosts([id]);setPickMode(false);window.openHostMenu?.(id,'book');return}
   window.closeHostMenu?.();
   if(e?.ctrlKey||e?.metaKey){const next=new Set(picked);next.has(id)?next.delete(id):next.add(id);selectHosts([...next],false)}
   else selectHosts(picked.size===1&&picked.has(id)?[]:[id]);
  },
  onMenu:id=>{if(picked.has(id)&&picked.size>1)window.openHostMenu?.(id,'group',[...picked]);else{selectHosts([id],false);window.openHostMenu?.(id,'main')}}
 });setupFrameSelect(map)}
 const hosts=new Map((s.hosts||[]).map(h=>[h.host_id,h]));let free=0,busy=0,booked=0;
 for(const btn of map.querySelectorAll('[data-host-id]')){
  const id=btn.dataset.hostId,connecting=s.rows.some(b=>b.instant&&b.host_id===id&&['requested','holding','checkin_pending'].includes(b.status));
  const status=connecting?'connecting':fresh?(hosts.get(id)?.status||'unknown'):'unknown';
  if(status==='free')free++;else if(status==='busy')busy++;else if(status==='reserved')booked++;
  const reservation=s.rows.find(b=>b.host_id===id&&!b.instant&&!b.admin_created&&['requested','waiting','holding','attention','checkin_pending','cancel_requested'].includes(b.status));
  const phone=btn.querySelector('.miniapp-booking');if(phone.hidden===!!reservation)phone.hidden=!reservation;
  const title=hostName(id)+': '+HOST_LABELS[status]+(reservation?' · Бронь из мини-приложения · '+(reservation.username||reservation.guest_name||'Гость'):'');
  if(btn.title!==title){btn.title=title;btn.setAttribute('aria-label',title)}
  const attention=s.rows.some(b=>b.host_id===id&&b.status==='attention');btn.classList.toggle('attention',attention);
  btn.classList.toggle('has-rental',(s.rentals||[]).some(r=>r.host===id));
  btn.classList.toggle('selected',picked.has(id));
  if(btn.dataset.status===status)continue;
  btn.dataset.status=status;btn.classList.remove('free','busy','reserved','broken','unknown','connecting');btn.classList.add(status);
  setDeskText(btn.querySelector('.pc-state'),id==='1'?HOST_LABELS[status]:STATE_SHORT[status]??'');
 }
 setDeskText($('hall-summary'),fresh?`Свободно ${free} · занято ${busy} · бронь ${booked}`:'Нет свежих данных от Gizmo');
}
async function refresh(){
 if(document.hidden||inFlight||!window.pywebview?.api)return;inFlight=true;
 try{
  const s=await window.pywebview.api.snapshot();current=s;window.renderRentals?.(s);window.renderHostMenu?.(s);window.renderRegistrations?.(s);window.renderUpdate?.(s);
  setDeskText($('connection'),(s.backend_label||'Сервер').toUpperCase()+(s.online?' · НА СВЯЗИ':' · НЕТ СВЯЗИ'));$('connection').className=s.online?'online':'offline';
  const gizmoOk=!!s.last_sync&&Date.now()/1000-s.last_sync<30;
  setDeskText($('gizmo-connection'),gizmoOk?'GIZMO · НА СВЯЗИ':'GIZMO · НЕТ СВЯЗИ');$('gizmo-connection').className=gizmoOk?'online':'offline';
  setDeskText($('error'),[s.error,s.sync_error,s.password_sync_error,!s.protocol_ready?'Сервис аккаунтов пока недоступен. Проверьте сообщение об ошибке выше.':''].filter(Boolean).join('\n'));
  const bookingKey=JSON.stringify(s.rows)+selectedHost;if(refresh.bookingKey!==bookingKey){bookings(s);refresh.bookingKey=bookingKey}
  const hallKey=JSON.stringify(s.hosts)+gizmoOk+[...picked]+JSON.stringify((s.rentals||[]).map(r=>r.host))+JSON.stringify(s.rows.map(b=>[b.host_id,b.status,b.instant,b.admin_created,b.username,b.guest_name]));if(refresh.hallKey!==hallKey){hall(s);refresh.hallKey=hallKey}
  const requests=s.password_requests||[];setDeskText($('requests-count'),requests.length);$('requests-count').toggleAttribute('data-zero',!requests.length);
  const resetKey=JSON.stringify(requests);if(refresh.resetKey!==resetKey){renderResetRequests(requests);refresh.resetKey=resetKey}
  window.renderGuestPasswords?.(s);
  if(!soundLoaded&&s.sound){soundLoaded=true;soundState=s.sound;$('sound-volume').value=s.sound.volume;$('sound-enabled').checked=s.sound.enabled;$('volume-label').value=s.sound.volume+'%';renderSoundPresets()}
 }catch{$('connection').textContent='ПАНЕЛЬ НЕДОСТУПНА'}finally{inFlight=false}
}
// Guest profile card: every field copies on click, like the PC menu.
function renderGuestProfile(user){
 const box=$('account-result');box.replaceChildren();box.className='guest-profile';
 const rows=[['Ник',user.username],['Имя',[user.firstName,user.lastName].filter(Boolean).join(' ')],['Телефон',user.mobilePhone||user.phone],['Группа',user.group_name],['ID',user.id]];
 for(const [label,value] of rows){
  if(value===undefined||value===null||value==='')continue;
  const b=document.createElement('button'),small=document.createElement('small'),strong=document.createElement('b');
  b.type='button';b.className='info-row';b.dataset.copy=String(value);small.textContent=label;strong.textContent=String(value);b.append(small,strong);box.append(b);
 }
}
$('account-result').addEventListener('click',async e=>{
 const b=e.target.closest('[data-copy]');if(!b)return;
 if(await deskCopy(b.dataset.copy)){b.classList.add('copied');setTimeout(()=>b.classList.remove('copied'),900);window.deskFlash?.('Скопировано: '+b.dataset.copy)}
 else window.deskFlash?.('Не удалось скопировать. Выделите текст и нажмите Ctrl+C');
});
function chooseAccount(user,requestId=null,focusPassword=true){
 foundAccount=user;selectedResetRequest=requestId;$('new-password').value='';$('identity-checked').checked=false;
 renderGuestProfile(user);
 $('account-message').textContent=requestId?'Аккаунт выбран по заявке. Проверьте личность гостя.':'';$('reset-user').hidden=false;
 if(focusPassword){$('reset-user').scrollIntoView({behavior:'smooth',block:'nearest'});$('new-password').focus({preventScroll:true})}
 else $('account-result').scrollIntoView({behavior:'smooth',block:'nearest'});
}
// Open a guest's profile from elsewhere (rental history): by Gizmo ID, or by search text for older records.
window.openGuestProfile=async({userId,query})=>{
 panel('accounts');
 if(userId){$('account-message').textContent='Открываем профиль…';const r=await invoke('select_account',userId);if(r?.user)chooseAccount(r.user,null,false);else $('account-message').textContent=r?.error||'Аккаунт недоступен';return}
 const input=$('account-search');input.value=query||'';input.focus();input.dispatchEvent(new Event('input'));
};
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
   action(label,async status=>{const result=await invoke('resolve_password_request',r.id,outcome,true);status.textContent=result?.ok?(result.synced?'Заявка закрыта':'Результат сохранён. Ожидаем синхронизацию с мини-аппом.'):result?.error||'Нет связи';if(result?.ok&&selectedResetRequest===r.id){selectedResetRequest=null;foundAccount=null;$('new-password').value='';$('reset-user').hidden=true}});
  }
  nodes.push(card);
 }
 if(!nodes.length){const empty=box.querySelector('.empty-requests')||document.createElement('p');empty.className='empty-requests';setDeskText(empty,'Ожидающих запросов нет');nodes.push(empty)}
 reconcileDeskChildren(box,nodes);
}
/* Sound: on/off, volume and one melody; every change saves at once, a tap on a melody plays it. */
const SOUNDS=[['soft','Лайм','две ноты вверх'],['bell','Колокол','чистый звон'],['drop','Капля','мягко вниз'],['chord','Аккорд','тёплый'],['tick','Тик-тик','тихо и коротко']];
let soundState={preset:'soft',volume:60,enabled:true};
function renderSoundPresets(){
 const box=$('sound-presets');
 if(!box.children.length)for(const [id,name,hint] of SOUNDS){const b=document.createElement('button');b.type='button';b.dataset.preset=id;b.setAttribute('role','radio');b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9Z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg><strong></strong><small></small>';b.querySelector('strong').textContent=name;b.querySelector('small').textContent=hint;b.onclick=async()=>{soundState.preset=id;renderSoundPresets();await saveSound();invoke('preview_sound',id)};box.append(b)}
 for(const b of box.children)b.setAttribute('aria-checked',String(b.dataset.preset===soundState.preset));
}
async function saveSound(){soundState={preset:soundState.preset,volume:Number($('sound-volume').value),enabled:$('sound-enabled').checked};const r=await invoke('sound_settings',soundState);setDeskText($('sound-result'),r?'':'Не удалось сохранить')}
$('sound-volume').oninput=e=>$('volume-label').value=e.target.value+'%';
$('sound-volume').onchange=async()=>{await saveSound();invoke('preview_sound',soundState.preset)};
$('sound-enabled').onchange=()=>saveSound();
renderSoundPresets();
$('find-user').onsubmit=async e=>{e.preventDefault();foundAccount=null;selectedResetRequest=null;$('reset-user').hidden=true;$('account-message').textContent='Поиск…';const result=await invoke('find_account',$('account-search').value.trim());if(!result?.user){$('account-message').textContent=result?.error||'Нет ответа';return}chooseAccount(result.user)};
$('account-search').oninput=()=>{foundAccount=null;selectedResetRequest=null;$('new-password').value='';$('reset-user').hidden=true;$('account-result').textContent=''};
$('reset-user').onsubmit=async e=>{e.preventDefault();if(!foundAccount||!$('identity-checked').checked)return;const btn=e.target.querySelector('button');btn.disabled=true;const password=$('new-password').value;$('new-password').value='';const result=selectedResetRequest?await invoke('reset_password_request',selectedResetRequest,foundAccount.username,password,true):await invoke('reset_password',foundAccount.id,foundAccount.username,password);$('account-message').textContent=result?.ok?(result.synced===false?'Пароль изменён и проверен. Заявка ожидает синхронизации — повторять смену не нужно.':'Пароль изменён и проверен. Услуга предоставлена. Сообщите пароль гостю лично.'):result?.error||'Результат неизвестен. Проверьте аккаунт';if(result?.ok){foundAccount=null;selectedResetRequest=null;$('reset-user').hidden=true}btn.disabled=false;};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
window.addEventListener('pywebviewready',()=>{refresh();window.initClubManagement?.();setInterval(refresh,2000)});
panel('hall');

// Splash: the 1SHOT logo fills, then the desk fades in. No club requests are made for it.
(()=>{const loader=window.oneshotLoader?.build($('splash-loader'),{caption:'Запускаем Desk'});if(loader&&!matchMedia('(prefers-reduced-motion: reduce)').matches)loader.run(2200);else loader?.set(1)})();
setTimeout(()=>$('desk-splash').classList.add('done'),2500);setTimeout(()=>$('desk-splash').remove(),3200);

// Moscow clock in the status bar.
(()=>{const tick=()=>setDeskText($('clock-chip'),new Date().toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'})+' МСК');tick();setInterval(tick,10000)})();

(()=>{const c=$('matrix-rain'),ctx=c.getContext('2d'),reduced=matchMedia('(prefers-reduced-motion: reduce)');let columns=[],w,h,raf=0,last=0;function resize(){w=innerWidth;h=innerHeight;c.width=w;c.height=h;columns=Array.from({length:Math.ceil(w/24)},()=>Math.random()*h/20)}function draw(t){if(document.hidden||reduced.matches){raf=0;return}raf=requestAnimationFrame(draw);if(t-last<90)return;last=t;ctx.fillStyle='#0002';ctx.fillRect(0,0,w,h);ctx.font='14px monospace';ctx.fillStyle='#ffffff55';const glyphs='⌁×+⟋⟍⋮⊞◇▱⊥⌜⌟≋';columns.forEach((y,i)=>{ctx.fillText(glyphs[Math.random()*glyphs.length|0],i*24,y*20);columns[i]=y*20>h&&Math.random()>.97?0:y+.4})}function start(){if(!raf&&!document.hidden&&!reduced.matches)raf=requestAnimationFrame(draw)}addEventListener('resize',resize);document.addEventListener('visibilitychange',start);reduced.addEventListener('change',start);resize();start()})();


let pickMode=false;
function setPickMode(on){pickMode=on;$('pick-hint').hidden=!on;document.body.classList.toggle('pick-mode',on)}
$('add-booking').onclick=()=>{if(picked.size>1){window.openHostMenu?.(selectedHost,'group',[...picked]);return}if(selectedHost){window.openHostMenu?.(selectedHost,'book');return}setPickMode(!pickMode)};
// Drag on empty floor draws a frame; every PC it touches is picked (Ctrl adds to the current pick).
function setupFrameSelect(map){
 let start=null,frame=null;
 map.addEventListener('mousedown',e=>{if(e.button!==0||e.target.closest('[data-host-id]'))return;start={x:e.clientX,y:e.clientY,add:e.ctrlKey||e.metaKey};e.preventDefault()});
 addEventListener('mousemove',e=>{
  if(!start)return;const w=Math.abs(e.clientX-start.x),h=Math.abs(e.clientY-start.y);if(!frame&&w+h<6)return;
  if(!frame){frame=document.createElement('div');frame.className='sel-frame';document.body.append(frame)}
  Object.assign(frame.style,{left:Math.min(e.clientX,start.x)+'px',top:Math.min(e.clientY,start.y)+'px',width:w+'px',height:h+'px'});
 });
 addEventListener('mouseup',e=>{
  if(!start)return;const s0=start;start=null;
  if(!frame){if(!s0.add){window.closeHostMenu?.();selectHosts([],false)}return}
  const r=frame.getBoundingClientRect();frame.remove();frame=null;
  const hit=[...map.querySelectorAll('[data-host-id]')].filter(b=>{const q=b.getBoundingClientRect();return q.right>r.left&&q.left<r.right&&q.bottom>r.top&&q.top<r.bottom}).map(b=>b.dataset.hostId);
  selectHosts(s0.add?[...new Set([...picked,...hit])]:hit,false);
 });
}
document.querySelector('nav .exit').onclick=e=>armTap(e.currentTarget.querySelector('span'),'Точно выйти?',()=>invoke('quit'));
