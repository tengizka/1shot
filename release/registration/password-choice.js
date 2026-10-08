/* STAGED. Only signed owner status from the existing capabilities/state poll. */
(()=>{
 const panel=document.createElement('section');panel.id='guest-password-panel';panel.hidden=true;
 const title=document.createElement('h3'),note=document.createElement('p'),form=document.createElement('form'),label=document.createElement('label'),input=document.createElement('input'),button=document.createElement('button');
 label.textContent='Новый пароль';input.type='password';input.autocomplete='new-password';input.required=true;input.maxLength=64;label.append(input);button.type='submit';button.className='btn-main';button.textContent='Установить мой пароль';form.append(label,button);panel.append(title,note,form);document.getElementById('auth').prepend(panel);
 let grant=null,busy=false;const attempted=new Set(),rank={authorized:0,queued:1,processing:2,attention:3,done:4,expired:4,resolved:4};
 const key=id=>'1shot-password-attempt:'+id;
 const hasAttempt=id=>{try{return attempted.has(id)||sessionStorage.getItem(key(id))==='1'}catch{return attempted.has(id)}};
 function accept(next){
  if(!next)return;if(grant?.id===next.id&&(rank[next.status]??0)<(rank[grant.status]??0))return;
  grant=next;const parent=profile?document.getElementById('ov-profile'):document.getElementById('auth');if(panel.parentElement!==parent)parent.prepend(panel);panel.hidden=false;
  title.textContent=next.username?'Пароль для '+next.username:'Восстановление доступа';input.minLength=next.minimum_length||1;
  form.hidden=next.status!=='authorized'||hasAttempt(next.id);button.disabled=busy;
  const messages={authorized:'Администратор разрешил смену. Введите пароль самостоятельно в течение 10 минут.',queued:'Пароль принят. Дождитесь проверки.',processing:'Проверяем установку пароля. Не отправляйте его повторно.',done:'Пароль установлен и проверен. Теперь можно войти в аккаунт.',attention:'Результат неизвестен. Не повторяйте смену; обратитесь к администратору.',expired:'Разрешение истекло. Попросите администратора выдать новое.',resolved:'Доступ проверен администратором.'};
  note.textContent=next.status==='authorized'&&hasAttempt(next.id)?'Отправка уже была предпринята. Дождитесь результата или окончания разрешения; повтор заблокирован.':messages[next.status]||'Проверьте состояние у администратора';
 }
 const original=apiFetch;
 apiFetch=async function(url,options={}){
  let body;try{body=JSON.parse(options.body||'{}')}catch{}
  const ownPoll=String(url).endsWith('/club-bookings')&&['capabilities','state'].includes(body?.action);
  if(ownPoll&&body.action==='capabilities'&&tg?.initData)options={...options,body:JSON.stringify({...body,recovery_pending:true})};
  const result=await original(url,options);if(ownPoll)accept(result.password_grant);return result;
 };
 form.onsubmit=async event=>{
  event.preventDefault();if(busy||grant?.status!=='authorized'||hasAttempt(grant.id))return;
  const password=input.value;if(!password.trim()||Array.from(password).length<grant.minimum_length||Array.from(password).length>64){note.textContent='Проверьте длину пароля';return}
  const selected={...grant};if(!confirm('Установить этот пароль для '+selected.username+'?'))return;
  attempted.add(selected.id);try{sessionStorage.setItem(key(selected.id),'1')}catch{}
  busy=true;button.disabled=true;input.value='';form.hidden=true;
  try{const result=await apiFetch(`${SUPA}/club-auth`,{method:'POST',body:JSON.stringify({action:'password_submit',initData:tg?.initData||'',grant_id:selected.id,request_id:crypto.randomUUID(),password})});accept({...selected,status:result.status})}
  catch{note.textContent='Нет подтверждения отправки. Не повторяйте: дождитесь статуса или окончания разрешения.'}
  finally{busy=false;button.disabled=false}
 };
 const help=document.createElement('button'),helpNote=document.createElement('p');help.type='button';help.className='btn-main';help.textContent='Забыли пароль?';document.getElementById('form-login').append(help,helpNote);let helpId=null;
 help.onclick=async()=>{help.disabled=true;helpId ||= crypto.randomUUID();try{await apiFetch(`${SUPA}/club-auth`,{method:'POST',body:JSON.stringify({action:'password_help',request_id:helpId,initData:tg?.initData||''})});helpNote.textContent='Заявка отправлена. Подойдите к администратору с документом.'}catch(error){helpNote.textContent=error.message||'Не удалось отправить заявку'}finally{help.disabled=false}};
})();
