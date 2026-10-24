/* «Новый гость»: registration at the reception without Telegram. The promo code is picked with a button,
   the account and the free hour are created by Desk with the same checks as an approved application. */
(()=>{
 const section=document.getElementById('panel-registrations');if(!section)return;
 const open=document.createElement('button');open.type='button';open.id='desk-reg-open';open.textContent='+ Новый гость';
 const form=document.createElement('form');form.id='desk-reg';form.className='surface desk-reg';form.hidden=true;form.noValidate=true;
 form.innerHTML=`<h3>Регистрация на ресепшене</h3>
  <p class="note">Для гостей без Telegram. Данные — с документа, пароль гость вводит сам. Ник для входа подберётся сам.</p>
  <div class="desk-reg-grid">
   <label>Имя<input name="first_name" maxlength="45" autocomplete="off" required></label>
   <label>Фамилия<input name="last_name" maxlength="45" autocomplete="off" required></label>
   <label>Телефон<input name="mobile_phone" maxlength="20" inputmode="tel" placeholder="+7 999 123-45-67" autocomplete="off" required></label>
   <label>Дата рождения<input name="birth_date" type="date" required></label>
   <label>Пароль<input name="password" type="password" maxlength="64" autocomplete="new-password" required></label>
  </div>
  <div class="desk-reg-row"><span class="desk-reg-label">Пол</span><div class="chips" data-group="sex"><button type="button" data-value="1">Мужской</button><button type="button" data-value="2">Женский</button></div></div>
  <div class="desk-reg-row"><span class="desk-reg-label">Откуда пришёл</span><div class="chips" data-group="code"><span class="note">Загружаем промокоды…</span></div></div>
  <label class="check"><input type="checkbox" name="checked">Личность проверена по документу, данные сверены</label>
  <div class="actions"><button type="submit" id="desk-reg-submit" disabled>Создать аккаунт</button><button type="button" id="desk-reg-cancel">Отмена</button></div>
  <p class="note" id="desk-reg-message" role="status"></p>`;
 section.querySelector('h2').after(open,form);
 const $f=n=>form.elements[n],message=form.querySelector('#desk-reg-message'),submit=form.querySelector('#desk-reg-submit');
 let requestId=null,sex=null,code=undefined,busy=false;
 const NONE='';
 function chips(group,value){form.querySelectorAll(`[data-group="${group}"] button`).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.value===String(value))))}
 function sync(){
  const filled=['password','first_name','last_name','mobile_phone','birth_date'].every(n=>$f(n).value.trim());
  submit.disabled=busy||!filled||!sex||code===undefined||!$f('checked').checked;
 }
 function reset(){form.reset();sex=null;code=undefined;chips('sex',null);chips('code',null);requestId=crypto.randomUUID();busy=false;sync()}
 async function loadCodes(){
  const box=form.querySelector('[data-group="code"]');const r=await invoke('promo_codes');box.replaceChildren();
  const list=[...(r?.codes||[]).map(c=>[c.code,c.code+' · '+(c.channel||'')]),[NONE,'Без промокода (без бесплатного часа)']];
  if(!r?.codes){const p=document.createElement('span');p.className='note';p.textContent=(r?.error||'Промокоды недоступны')+'. Можно зарегистрировать без промокода';box.append(p)}
  for(const [value,label] of list){const b=document.createElement('button');b.type='button';b.dataset.value=value;b.textContent=label;box.append(b)}
  chips('code',code);
 }
 form.addEventListener('click',e=>{
  const b=e.target.closest('.chips button');if(!b||busy)return;
  if(b.parentElement.dataset.group==='sex'){sex=Number(b.dataset.value);chips('sex',sex)}else{code=b.dataset.value;chips('code',code)}
  sync();
 });
 form.addEventListener('input',sync);
 open.onclick=()=>{form.hidden=!form.hidden;if(!form.hidden){if(!requestId)reset();setDeskText(message,'');loadCodes();$f('first_name').focus()}};
 form.querySelector('#desk-reg-cancel').onclick=()=>{reset();form.hidden=true};
 form.onsubmit=async e=>{
  e.preventDefault();if(submit.disabled)return;busy=true;sync();setDeskText(message,'Создаём аккаунт…');
  const data={password:$f('password').value,first_name:$f('first_name').value.trim(),last_name:$f('last_name').value.trim(),mobile_phone:$f('mobile_phone').value.trim(),birth_date:$f('birth_date').value,sex};
  let r;try{r=await invoke('register_guest',requestId,data,code||null,true)}finally{busy=false}
  const p=r?.promo,hour=!p?'':p.result==='granted'?' Час STANDART начислен ('+p.code+').':p.result==='pending'?' '+p.error:p.result==='failed'?' Час не начислен: '+(p.error||'проверьте товар standart 1 h'):' Проверьте в Gizmo, начислен ли час. Не начисляйте повторно не проверив.';
  if(r?.ok&&(!p||p.result==='granted')){
   window.deskFlash?.('Гость зарегистрирован');reset();setDeskText(message,'Готово. Ник для входа: '+(r.username||'—')+' · ID '+r.gizmo_user_id+'.'+hour);
  }else if(r?.ok&&p?.result==='pending')setDeskText(message,'Аккаунт создан · ID '+r.gizmo_user_id+'.'+hour);
  else if(r?.ok){$f('password').value='';setDeskText(message,'Аккаунт создан · ID '+r.gizmo_user_id+'.'+hour)}
  else if(r?.status==='rejected'){requestId=crypto.randomUUID();setDeskText(message,'Гость с таким телефоном уже есть в Gizmo. Используйте существующий аккаунт.')}
  else setDeskText(message,r?.error||'Нужна ручная сверка в Gizmo. Не создавайте аккаунт повторно, пока не проверите.');
  sync();
 };
})();
