/* Quick actions next to a PC on the hall plan.
   Free PC: Вход · Бронь · Блок · Аренда. Busy PC: who plays, balance and time left (tap a value to copy) + Аренда.
   No system dialogs and no confirmations for routine actions. */
(()=>{
 const ICON={login:'<path d="M10 17l5-5-5-5M15 12H3M14 3h7v18h-7"/>',book:'<rect x="3" y="5" width="18" height="16"/><path d="M3 10h18M8 2v5M16 2v5"/>',lock:'<rect x="5" y="11" width="14" height="10"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',unlock:'<rect x="5" y="11" width="14" height="10"/><path d="M8 11V7a4 4 0 0 1 7.6-1.8"/>',rent:'<rect x="7" y="2" width="10" height="20" rx="5"/><path d="M12 2v7M7 9h10"/>',back:'<path d="M19 12H5m6-6-6 6 6 6"/>',logout:'<path d="M14 3h7v18h-7M10 17l-5-5 5-5M5 12h12"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>'};
 const svg=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;
 const menu=document.createElement('div');menu.id='host-menu';menu.className='host-menu';menu.hidden=true;menu.setAttribute('role','dialog');document.body.append(menu);
 const flash=document.createElement('div');flash.id='desk-flash';flash.setAttribute('role','status');document.body.append(flash);
 let groupReq={},host=null,group=[],view='main',info=null,infoSeq=0,requestId=null,slot=null,working=false;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function say(text){flash.textContent=text;flash.classList.remove('show');void flash.offsetWidth;flash.classList.add('show');clearTimeout(say.t);say.t=setTimeout(()=>flash.classList.remove('show'),2600)}
 window.deskFlash=say;
 const fresh=()=>current?.last_sync&&Date.now()/1000-current.last_sync<30;
 const statusOf=id=>fresh()?(current.hosts||[]).find(h=>h.host_id===id)?.status||'unknown':'unknown';
 const activeBooking=id=>(current?.rows||[]).find(b=>b.host_id===id&&!['cancelled','expired','completed'].includes(b.status));
 const ownHold=id=>(current?.rows||[]).find(b=>b.admin_created&&!b.instant&&b.host_id===id&&b.status==='holding');
 const hostButton=id=>document.querySelector(`#desk-map [data-host-id="${CSS.escape(id)}"]`);
 const duration=sec=>{if(!Number.isFinite(sec)||sec<0)return '';const m=Math.round(sec/60);return m>=60?Math.floor(m/60)+' ч '+String(m%60).padStart(2,'0')+' мин':m+' мин'};

 function place(){
  const btn=hostButton(host);if(!btn||menu.hidden)return;
  const r=btn.getBoundingClientRect(),board=$('desk-map').getBoundingClientRect(),w=menu.offsetWidth,h=menu.offsetHeight;
  const right=r.left+r.width/2<board.left+board.width/2;
  let x=right?r.right+12:r.left-12-w;x=Math.max(8,Math.min(innerWidth-w-8,x));
  let y=r.top+r.height/2-h/2;y=Math.max(48,Math.min(innerHeight-h-8,y));
  menu.style.left=x+'px';menu.style.top=y+'px';menu.dataset.side=right?'right':'left';
 }
 function tile(action,label,extra=''){return `<button type="button" class="menu-tile ${extra}" data-action="${action}">${svg(action)}<span>${label}</span></button>`}
 function header(title,back){
  const st=statusOf(host),label=HOST_LABELS[st]||'';
  return `<div class="menu-head">${back?`<button type="button" class="icon-btn" data-action="back" aria-label="Назад">${svg('back')}</button>`:''}<strong>${esc(title||hostName(host))}</strong><span class="menu-state ${st}">${esc(label)}</span><button type="button" class="icon-btn" data-action="close" aria-label="Закрыть">${svg('close')}</button></div>`;
 }
 function infoRows(){
  if(!info)return '<p class="menu-loading">Загружаем данные гостя…</p>';
  if(info.error)return `<p class="menu-error">${esc(info.error)}</p>`;
  if(info.free)return '';
  const rows=[['Ник',info.username],['Имя',[info.first_name,info.last_name].filter(Boolean).join(' ')],['Телефон',info.phone],['Баланс',Number.isFinite(info.balance)?info.balance.toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽':''],['Осталось',duration(info.available_time)],['В игре',duration(info.span)],['Группа',info.group],['Gizmo ID',info.user_id]].filter(r=>r[1]!==''&&r[1]!=null);
  return `<div class="menu-info">${rows.map(([k,v])=>`<button type="button" class="info-row" data-copy="${esc(v)}"><small>${esc(k)}</small><b>${esc(v)}</b></button>`).join('')}</div>`;
 }
 function render(){
  if(!host)return;const st=statusOf(host),booking=activeBooking(host);let html='';
  if(view==='main'){
   html=header();
   if(st==='busy')html+=infoRows()+`<div class="menu-tiles">${tile('rent','Аренда')}${info&&info.user_id?tile('logout','Выйти','danger'):''}</div>`;
   else if(host==='1')html+='';
   else{
    const tiles=[];
    if(st==='free'){tiles.push(tile('login','Вход'),tile('book','Бронь'),tile('lock','Блок'))}
    else if(st==='reserved'){if(ownHold(host))tiles.push(tile('login','Вход'));if(!booking)tiles.push(tile('unlock','Разблок'))}
    tiles.push(tile('rent','Аренда'));
    html+=`<div class="menu-tiles">${tiles.join('')}</div>`;
   }
  }else if(view==='login'){
   html=header('Вход · '+hostName(host),true)+`<input id="menu-login-search" placeholder="Ник, телефон или имя" autocomplete="off" maxlength="80"><div id="menu-login-options" class="account-options menu-options"></div>`;
  }else if(view==='book'||view==='group'){
   const isGroup=view==='group',free=isGroup?group.filter(id=>statusOf(id)==='free'&&id!=='1'):[host];
   const times=slotTimes();if(!times.some(t=>t===slot))slot=times[0];let day='';
   const cells=times.map(t=>{const d=new Date(t+3*3600000),label=d.toISOString().slice(11,16),key=d.toISOString().slice(0,10);let head='';if(key!==day){head=`<span class="slot-day">${day?'Завтра':'Сегодня'}</span>`;day=key}return head+`<button type="button" data-at="${t}" aria-pressed="${t===slot}">${label}</button>`}).join('');
   html=header(isGroup?'Компания · '+free.length+' ПК':'Бронь · '+hostName(host),!isGroup)
    +(isGroup?`<p class="menu-group">${free.map(id=>`<span>${esc(id)}</span>`).join('')}${free.length<group.length?`<small>занятые ПК пропущены</small>`:''}</p>`:'')
    +`<div class="menu-slots">${cells}</div><input id="menu-book-name" maxlength="60" placeholder="${isGroup?'Название компании':'Имя гостя'}" autocomplete="off"><button type="button" class="menu-primary" data-action="book-go" ${free.length?'':'disabled'}>Забронировать${isGroup?' '+free.length+' ПК':''} · <span id="menu-book-at"></span></button>`;
  }else if(view==='rent'){
   const items=current?.rental_items||{};
   html=header('Аренда · '+hostName(host),true)+`<div class="menu-tiles rent-tiles">${Object.entries(items).map(([id,name])=>`<button type="button" class="menu-tile rent-item" data-item="${id}">${window.rentalIcon?.(id)||''}<span>${esc(name)}</span></button>`).join('')}</div>`;
  }
  menu.innerHTML=html;menu.dataset.view=view;
  if(view==='login')setupLogin();if(view==='book'||view==='group')updateBookTime();
  place();
 }
 async function loadInfo(){const seq=++infoSeq,id=host;info=null;const r=await invoke('host_info',id);if(seq!==infoSeq||host!==id)return;info=r||{error:'Нет связи с Desk'};if(view==='main')render()}
 window.openHostMenu=(id,start='main',hosts=[])=>{host=String(id);group=hosts.map(String);view=start;requestId=null;info=null;slot=null;menu.hidden=false;render();if(statusOf(host)==='busy')loadInfo();if(start==='login')$('menu-login-search')?.focus()};
 window.closeHostMenu=()=>{menu.hidden=true;host=null;infoSeq++};
 window.renderHostMenu=()=>{if(!host||menu.hidden||working)return;if(view==='main'){const key=statusOf(host)+!!activeBooking(host)+!!ownHold(host);if(menu.dataset.key!==key){menu.dataset.key=key;render();if(statusOf(host)==='busy'&&!info)loadInfo()}}};
 addEventListener('resize',place);

 function slotTimes(){const step=1800000,first=Math.ceil((Date.now()+5*60000)/step)*step,out=[];for(let t=first;t<Date.now()+86400000;t+=step)out.push(t);return out}
 function bookStart(){return slot?new Date(slot):null}
 function updateBookTime(){const at=bookStart();setDeskText($('menu-book-at'),at?clubArrivalLabel(at.toISOString()).replace(' МСК',''):'—');menu.querySelector('[data-action="book-go"]').disabled=!at}
 function setupLogin(){
  const input=$('menu-login-search'),box=$('menu-login-options');
  window.accountPicker(input,box,user=>{box.replaceChildren();const btn=document.createElement('button');btn.type='button';btn.className='menu-primary';btn.textContent=user.requires_privileged_confirmation?'Служебный аккаунт · войти':'Войти · '+user.username;
   const who=document.createElement('p');who.className='menu-who';who.textContent=[user.username,[user.firstName,user.lastName].filter(Boolean).join(' '),user.mobilePhone||user.phone].filter(Boolean).join(' · ');
   btn.onclick=async()=>{if(working)return;working=true;btn.disabled=true;requestId ||= crypto.randomUUID();const id=host;const r=await invoke('login_account',id,user.id,user.username,requestId,ownHold(id)?.id||null,true,!!user.requires_privileged_confirmation);working=false;btn.disabled=false;if(r?.ok){closeHostMenu();say('Вход на '+hostName(id)+' отправлен')}else say(r?.error||'Нет ответа от Desk')};
   box.append(who,btn);btn.focus()},()=>{requestId=null});
 }
 menu.addEventListener('click',async e=>{
  const t=e.target.closest('button,input');if(!t||working)return;
  const action=t.dataset.action;
  if(action==='close')return closeHostMenu();
  if(action==='back'){view='main';return render()}
  if(t.dataset.copy!==undefined){if(await deskCopy(t.dataset.copy)){t.classList.add('copied');setTimeout(()=>t.classList.remove('copied'),900);say('Скопировано: '+t.dataset.copy)}else say('Не удалось скопировать');return}
  if(action==='logout'){armTap(t.querySelector('span'),'Точно?',async()=>{working=true;const id=host;const r=await invoke('logout_host',id,info.user_id);working=false;say(r?.ok?'Гость вышел с '+hostName(id):r?.error||'Нет ответа');if(r?.ok)closeHostMenu()});return}
  if(['login','book','rent'].includes(action)){view=action;render();if(action==='login')$('menu-login-search')?.focus();return}
  if(action==='lock'||action==='unlock'){working=true;t.disabled=true;const id=host;const r=await invoke('lock_host',id,action==='lock');working=false;say(r?.ok?hostName(id)+(action==='lock'?' заблокирован':' разблокирован'):r?.error||'Нет ответа');if(r?.ok)closeHostMenu();else t.disabled=false;return}
  if(t.dataset.at){slot=Number(t.dataset.at);menu.querySelectorAll('[data-at]').forEach(b=>b.setAttribute('aria-pressed',String(b===t)));requestId=null;return updateBookTime()}
  if(action==='book-go'){
   const at=bookStart();if(!at)return;working=true;t.disabled=true;if(!requestId){requestId=crypto.randomUUID();groupReq={}}
   const iso=new Date(at.getTime()+3*3600000).toISOString().slice(0,16)+':00+03:00',name=$('menu-book-name').value.trim();
   const targets=view==='group'?group.filter(id=>statusOf(id)==='free'&&id!=='1'):[host];
   // A company booking is one booking per PC with the same time and name; each PC keeps its own request id.
   const failed=[];for(const id of targets){const r=await invoke('create_manual_booking',id,iso,view==='group'?(name||'Компания'):name,targets.length>1?(groupReq[id] ||= crypto.randomUUID()):requestId);if(!r?.ok)failed.push(id+': '+(r?.error||'нет ответа'))}
   working=false;t.disabled=false;
   if(!failed.length){closeHostMenu();say(targets.length>1?'Бронь компании · '+targets.length+' ПК':'Бронь '+hostName(targets[0])+' создана')}else say(failed.join(' · '));
   return;
  }
  if(t.dataset.item){working=true;const id=host;const r=await invoke('add_rental',t.dataset.item,id,info?.username||'');working=false;if(r?.ok){closeHostMenu();say((current?.rental_items?.[t.dataset.item]||'Вещь')+' · '+hostName(id))}else say(r?.error||'Нет ответа')}
 });
 menu.addEventListener('input',e=>{if(e.target.id==='menu-book-name')requestId=null});
 document.addEventListener('mousedown',e=>{if(menu.hidden||menu.contains(e.target)||e.target.closest('#desk-map [data-host-id]'))return;closeHostMenu()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden)closeHostMenu()});
})();
