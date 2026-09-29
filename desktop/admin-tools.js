/* Trusted local Desk tools. Nothing here grants permissions to Telegram clients. */
(()=>{
 const api=(method,...args)=>invoke(method,...args);
 let resetting=false;
 function picker(input,box,onSelect,onClear){
  let generation=0,timer=null;
  const clear=()=>{generation++;clearTimeout(timer);box.replaceChildren()};
  async function search(){
   clearTimeout(timer);const seq=++generation,q=input.value.trim();box.replaceChildren();
   if(q.length<2){box.textContent='Введите хотя бы 2 символа';return}
   box.textContent='Ищем…';const r=await api('search_accounts',q);if(seq!==generation)return;box.replaceChildren();
   if(!r?.users){box.textContent=r?.error||'Поиск недоступен';return}
   if(!r.users.length){box.textContent='Ничего не найдено';return}
   for(const user of r.users){
    const btn=document.createElement('button');btn.type='button';btn.className='account-option';
    const title=document.createElement('strong');title.textContent=user.username||'Без никнейма';
    const detail=document.createElement('span');detail.textContent=[[user.firstName,user.lastName].filter(Boolean).join(' ')||'Имя не указано',user.mobilePhone||user.phone||'Телефон не указан',user.group_name||'Группа не определена','ID '+user.id,user.isDisabled?'Отключён':''].filter(Boolean).join(' · ');
    btn.append(title,detail);btn.onclick=async()=>{const selected=++generation;box.textContent='Проверяем аккаунт…';const result=await api('select_account',user.id);if(selected!==generation)return;if(result?.user){clear();onSelect(result.user)}else box.textContent=result?.error||'Аккаунт недоступен'};box.append(btn);
   }
   if(r.more){const note=document.createElement('p');note.textContent='Первые 20 совпадений. Уточните запрос';box.append(note)}
  }
  input.oninput=()=>{clear();onClear();timer=setTimeout(search,350)};
  input.onkeydown=e=>{if(e.key==='Escape'){clear();e.preventDefault()}if(e.key==='ArrowDown'){const btn=box.querySelector('button');if(btn){e.preventDefault();btn.focus()}}};
  return {clear,search};
 }
 const oldChoose=chooseAccount;
 const resetPicker=picker($('account-search'),$('account-options'),user=>chooseAccount(user),()=>{foundAccount=null;selectedResetRequest=null;$('new-password').value='';$('reset-user').hidden=true;$('account-result').textContent='';$('account-message').textContent=''});
 chooseAccount=(user,requestId=null)=>{if(resetting)return;resetPicker.clear();oldChoose(user,requestId);$('privileged-wrap').hidden=!user.requires_privileged_confirmation;$('privileged-checked').checked=false;$('privileged-checked').required=!!user.requires_privileged_confirmation;$('account-result').textContent+=' · '+(user.group_name||'Группа не определена')};
 $('find-user').onsubmit=e=>{e.preventDefault();if(!resetting)resetPicker.search()};
 $('reset-user').onsubmit=async e=>{
  e.preventDefault();if(resetting||!foundAccount||!$('identity-checked').checked)return;
  const user=foundAccount,req=selectedResetRequest,privileged=$('privileged-checked').checked;
  if(user.requires_privileged_confirmation&&!privileged)return;
  if(!confirm('Сменить пароль '+user.username+' (ID '+user.id+')?'))return;
  resetting=true;resetPicker.clear();$('account-search').disabled=true;const btn=e.target.querySelector('button');btn.disabled=true;
  const password=$('new-password').value;$('new-password').value='';
  try{const r=req?await api('reset_password_request',req,user.username,password,true,privileged):await api('reset_password',user.id,user.username,password,true,privileged);
   $('account-message').textContent=r?.ok?(r.synced===false?'Пароль проверен. Ожидаем синхронизацию — не повторяйте смену.':'Пароль изменён и проверен. Сообщите его владельцу лично.'):r?.error||'Результат неизвестен. Проверьте аккаунт вручную';
   if(r?.ok){foundAccount=null;selectedResetRequest=null;$('reset-user').hidden=true}
  }finally{resetting=false;btn.disabled=false;$('account-search').disabled=false}
 };
 const dialog=document.createElement('dialog');dialog.id='admin-pc-dialog';dialog.innerHTML=`<div class="section-heading"><h2 id="admin-pc-title">Новая бронь</h2><button id="admin-close" aria-label="Закрыть">×</button></div><div id="admin-hosts"></div><div id="admin-forms" hidden><button id="admin-back">Выбрать другой ПК</button><form id="manual-booking"><label>Время прихода · Москва<input type="datetime-local" id="manual-start" step="300" required></label><div class="actions" id="arrival-shortcuts"></div><p id="arrival-preview" class="note"></p><label>Имя гостя · необязательно<input id="manual-guest" maxlength="60" autocomplete="off"></label><p class="note">Ждём 30 минут после времени прихода. Начатая игра не прерывается.</p><button id="manual-submit">Создать бронь</button></form><form id="manual-login" hidden><label>Никнейм, телефон, имя или фамилия<input id="login-search" maxlength="80" autocomplete="off"></label><div id="login-options" class="account-options"></div><p id="login-selected"></p><label id="login-privileged-wrap" class="check" hidden><input type="checkbox" id="login-privileged"> Подтверждаю вход в служебный аккаунт или аккаунт неподтверждённой гостевой группы</label><button id="login-submit" disabled>Войти на ПК</button></form></div><p id="admin-message" role="status"></p>`;document.body.append(dialog);
 let mode='reserve',host=null,loginUser=null,requestId=null,working=false;
 const loginPicker=picker($('login-search'),$('login-options'),u=>{loginUser=u;$('login-selected').textContent=[u.username,u.firstName,u.lastName,u.mobilePhone||u.phone,u.group_name,'ID '+u.id].filter(Boolean).join(' · ');$('login-privileged-wrap').hidden=!u.requires_privileged_confirmation;$('login-privileged').checked=false;$('login-submit').disabled=!!u.isDisabled;requestId=null},()=>{loginUser=null;requestId=null;$('login-selected').textContent='';$('login-submit').disabled=true});
 function preview(){const value=$('manual-start').value;$('arrival-preview').textContent=value?clubArrivalLabel(value+':00+03:00'):'';requestId=null}
 function quick(minutes){$('manual-start').min=clubDateInput(new Date(Math.ceil((Date.now()+1)/300000)*300000).toISOString());$('manual-start').max=clubDateInput(new Date(Date.now()+86400000).toISOString()).slice(0,10)+'T23:55';$('manual-start').value=clubDateInput(new Date(Math.ceil((Date.now()+minutes*60000)/300000)*300000).toISOString());preview()}
 for(const [minutes,label] of [[15,'+15 мин'],[30,'+30 мин'],[60,'+1 час'],[120,'+2 часа']]){const btn=document.createElement('button');btn.type='button';btn.textContent=label;btn.onclick=()=>quick(minutes);$('arrival-shortcuts').append(btn)}
 $('manual-start').oninput=preview;$('manual-guest').oninput=()=>requestId=null;
 function chooseHost(id){host=id;requestId=null;loginUser=null;loginPicker.clear();$('login-search').value='';$('login-selected').textContent='';$('login-submit').disabled=true;$('login-privileged-wrap').hidden=true;$('admin-hosts').hidden=true;$('admin-forms').hidden=false;$('manual-booking').hidden=mode!=='reserve';$('manual-login').hidden=mode!=='login';$('admin-pc-title').textContent=(mode==='reserve'?'Бронь · ПК ':'Вход · ПК ')+id;$('admin-message').textContent='';quick(15)}
 function hosts(){
  $('admin-hosts').hidden=false;$('admin-forms').hidden=true;$('admin-hosts').replaceChildren();$('admin-pc-title').textContent=mode==='reserve'?'Новая бронь · выберите ПК':'Вход · выберите ПК';
  const fresh=current?.last_sync&&Date.now()/1000-current.last_sync<30;
  for(const zone of ['vip','standard']){const group=document.createElement('section');const title=document.createElement('h3');title.textContent=zone.toUpperCase();group.append(title);const grid=document.createElement('div');grid.className='admin-host-grid';
   for(const pc of getZoneSeats(zone)){const h=current?.hosts?.find(h=>h.host_id===pc.id),status=fresh?h?.status:'unknown';const own=current?.rows?.some(b=>b.admin_created&&!b.instant&&b.host_id===pc.id&&b.status==='holding');const btn=document.createElement('button');btn.type='button';btn.textContent=pc.id;btn.className='desk-pc '+(status||'unknown');btn.disabled=status!=='free'&&!(mode==='login'&&status==='reserved'&&own);btn.onclick=()=>chooseHost(pc.id);grid.append(btn)}group.append(grid);$('admin-hosts').append(group)}
 }
 window.openAdminPC=(kind='reserve',id=null)=>{if(working)return;if(id&&kind==='login'&&!canLogin(String(id))){$('error').textContent='ПК недоступен для входа: нужен свободный ПК или собственная ручная бронь';return;}mode=kind;requestId=null;$('admin-message').textContent='';$('manual-guest').value='';loginPicker.clear();if(id)chooseHost(String(id));else hosts();dialog.showModal()};
 $('admin-back').onclick=()=>{if(!working){loginPicker.clear();hosts()}};
 $('admin-close').onclick=()=>{if(!working){loginPicker.clear();dialog.close()}};dialog.addEventListener('cancel',e=>{if(working)e.preventDefault();else loginPicker.clear()});
 async function send(button,fn){if(working)return;working=true;dialog.querySelectorAll('input,button').forEach(e=>e.disabled=true);$('admin-message').textContent='Отправляем…';try{const r=await fn();if(r?.ok){dialog.close();selectHost(host)}else $('admin-message').textContent=r?.error||'Нет подтверждения. Повторите отправку без изменения данных: запрос сохранит прежний ID.'}finally{working=false;dialog.querySelectorAll('input,button').forEach(e=>e.disabled=false);$('login-submit').disabled=!loginUser||!!loginUser.isDisabled}}
 $('manual-booking').onsubmit=e=>{e.preventDefault();const start=$('manual-start').value+':00+03:00';if(!Number.isFinite(Date.parse(start))||Date.parse(start)<=Date.now()){$('admin-message').textContent='Выберите будущее время';return}requestId ||= crypto.randomUUID();send($('manual-submit'),()=>api('create_manual_booking',host,start,$('manual-guest').value.trim(),requestId))};
 $('manual-login').onsubmit=e=>{e.preventDefault();if(!loginUser)return;const privileged=$('login-privileged').checked;if(loginUser.requires_privileged_confirmation&&!privileged){$('admin-message').textContent='Подтвердите работу со служебной группой';return}if(!confirm('Войти на ПК '+host+' в аккаунт '+loginUser.username+'? Чужая сессия не будет завершена.'))return;const booking=current?.rows?.find(b=>b.admin_created&&!b.instant&&b.host_id===host&&b.status==='holding');requestId ||= crypto.randomUUID();const u=loginUser;send($('login-submit'),()=>api('login_account',host,u.id,u.username,requestId,booking?.id||null,true,privileged))};
 $('add-booking').onclick=()=>openAdminPC('reserve');$('host-login').onclick=()=>{if(selectedHost)openAdminPC('login',selectedHost)};
 function canLogin(id){const fresh=current?.last_sync&&Date.now()/1000-current.last_sync<30,status=fresh?current?.hosts?.find(h=>h.host_id===id)?.status:'unknown';return status==='free'||(status==='reserved'&&current?.rows?.some(b=>b.admin_created&&!b.instant&&b.host_id===id&&b.status==='holding'))}
 window.updateAdminActions=()=>{$('host-login').hidden=!selectedHost;$('host-login').disabled=!canLogin(selectedHost)};
 const oldSelect=selectHost;selectHost=id=>{oldSelect(id);updateAdminActions()};
})();
