/* Registration as an application: the admin confirms the guest in person in Desk. Loads before club-booking.js. No timer. */
(()=>{
 const form=document.getElementById('form-register'),password=document.getElementById('r-pass'),button=document.getElementById('btn-reg');
 password.minLength=1;password.maxLength=64;button.textContent='Отправить анкету';
 const box=document.createElement('section');box.id='registration-wait';box.hidden=true;box.setAttribute('aria-live','polite');
 const loaderHost=document.createElement('div');loaderHost.className='rw-status';loaderHost.innerHTML='<i></i><span>Анкета у администратора</span>';
 const title=document.createElement('h2'),message=document.createElement('p');
 const cancel=document.createElement('button');cancel.type='button';cancel.className='rw-cancel';cancel.textContent='Отменить анкету';
 const retry=document.createElement('button');retry.type='button';retry.className='btn-main';retry.textContent='Заполнить новую анкету';
 box.append(loaderHost,title,message,retry,cancel);document.querySelector('#auth .auth-tabs').before(box);
 let ready=false,busy=false,dismissed=null,current=null,armed=0;
 // While the admin works on it the guest sees one calm screen with a quiet status line, no technical states.
 const WAIT=['Подойди к администратору','Возьми документ: администратор сверит данные, подтвердит анкету — и аккаунт откроется здесь сам.'];
 const messages={awaiting_admin:WAIT,processing:WAIT,attention:WAIT,rejected:['Анкета отменена','Можно заполнить новую.'],expired:['Анкета устарела','Заполни новую — это минута.']};
 const visible=value=>{box.hidden=!value;form.hidden=value;document.querySelector('#auth .auth-tabs').hidden=value;document.getElementById('form-login').hidden=value};
 const waiting=()=>['awaiting_admin','processing','attention'].includes(current?.status);
 const spin=on=>{loaderHost.hidden=!on};
 retry.onclick=()=>{dismissed=current?.id;visible(false);switchAuthTab('register',document.querySelectorAll('.auth-tab')[1])};
 cancel.onclick=async()=>{
  if(busy)return;
  // Second tap confirms; no system dialogs.
  if(Date.now()-armed>4000){armed=Date.now();cancel.textContent='Точно отменить? Нажми ещё раз';cancel.classList.add('armed');setTimeout(()=>{if(Date.now()-armed>=4000){cancel.textContent='Отменить анкету';cancel.classList.remove('armed')}},4100);return}
  busy=true;cancel.disabled=true;cancel.textContent='Отменяем…';
  try{
   await apiFetch(`${SUPA}/club-auth`,{method:'POST',body:JSON.stringify({action:'registration_cancel',initData:tg?.initData||''})});
   dismissed=current?.id;current=null;spin(false);visible(false);switchAuthTab('register',document.querySelectorAll('.auth-tab')[1]);
  }catch(error){message.textContent=String(error.message||'Не получилось отменить').replace(/^HTTP \d+: /,'')}
  finally{busy=false;cancel.disabled=false;armed=0;cancel.textContent='Отменить анкету';cancel.classList.remove('armed')}
 };
 function accept(r){
  if(!r||profile)return;current=r;
  if(r.status==='done'){
   if(r.profile&&typeof r.profile.gizmo_user_id==='number'&&r.profile.gizmo_user_id>0){password.value='';profile=r.profile;saveProfile(profile);spin(false);visible(false);showApp()}
   else{title.textContent='Анкета подтверждена';message.textContent='Войди в свой аккаунт с ником и паролем из анкеты.';retry.hidden=true;cancel.hidden=true;spin(false);visible(true)}
   return;
  }
  if(!messages[r.status]||dismissed===r.id)return;
  const [heading,text]=messages[r.status];if(title.textContent!==heading)title.textContent=heading;if(message.textContent!==text)message.textContent=text;
  retry.hidden=waiting();cancel.hidden=!waiting();spin(waiting());visible(true);
 }
 // Extend the existing guest capabilities request, never add a polling loop.
 const originalFetch=apiFetch;
 apiFetch=async function(url,options={}){
  let body;try{body=JSON.parse(options.body||'{}')}catch{}
  const capabilities=String(url).endsWith('/club-bookings')&&body?.action==='capabilities';
  if(capabilities&&!profile&&tg?.initData)options={...options,body:JSON.stringify({...body,registration_pending:true})};
  const result=await originalFetch(url,options);
  if(capabilities){ready=result.registration_approval===1;accept(result.registration)}
  return result;
 };
 doRegister=async function(event){
  event.preventDefault();if(busy)return;clearAuthErr();
  if(!ready){showAuthErr('form-register','Регистрация пока недоступна. Обратитесь к администратору');return}
  const value=id=>document.getElementById(id).value.trim();
  const data={action:'register_application',initData:tg?.initData||'',username:value('r-user'),password:password.value,first_name:value('r-name'),last_name:value('r-last'),mobile_phone:(window.normPhone||String)(value('r-phone')),birth_date:value('r-birth'),sex:Number(document.querySelector('[name=sex]:checked')?.value)};
  const promo=document.getElementById('r-promo')?.value.trim().toUpperCase();if(promo)data.promo_code=promo;
  if(!data.password.trim()||!data.username||!data.first_name||!data.last_name||!data.mobile_phone||!data.birth_date||!data.sex){showAuthErr('form-register','Заполните все поля анкеты');return}
  busy=true;setAuthLoading('form-register',true);
  try{
   const result=await apiFetch(`${SUPA}/club-auth`,{method:'POST',body:JSON.stringify(data)});if(!result.request_id)throw Error('Нет подтверждения приёма анкеты');
   password.value='';dismissed=null;accept({id:result.request_id,status:'awaiting_admin'});
  }catch(error){showAuthErr('form-register',error.message||'Нет подтверждения. Проверьте связь с клубом')}
  finally{busy=false;setAuthLoading('form-register',false);button.textContent='Отправить анкету'}
 };
 window.registrationFlow={accept};
})();
