/* STAGED: load before club-booking.js only after migration/functions/Desk cutover. No timer. */
(()=>{
 const form=document.getElementById('form-register'),password=document.getElementById('r-pass'),button=document.getElementById('btn-reg');
 password.minLength=1;password.maxLength=64;button.textContent='Отправить анкету';
 const box=document.createElement('section');box.id='registration-wait';box.hidden=true;box.setAttribute('aria-live','polite');
 const title=document.createElement('h2'),message=document.createElement('p'),login=document.createElement('button');login.type='button';login.className='btn-main';login.textContent='У меня уже есть аккаунт';
 const retry=document.createElement('button');retry.type='button';retry.className='btn-main';retry.textContent='Заполнить новую анкету';box.append(title,message,login,retry);document.querySelector('#auth .auth-tabs').before(box);
 let ready=false,busy=false,dismissed=null,current=null;
 const messages={awaiting_admin:['Анкета отправлена','Подойдите к администратору клуба с документом. Аккаунт появится только после очной проверки.'],processing:['Администратор проверяет анкету','Не отправляйте её повторно.'],attention:['Нужна дополнительная проверка','Обратитесь к администратору. Новое создание аккаунта заблокировано до сверки.'],rejected:['Анкета отклонена','Уточните причину у администратора. Если аккаунт уже существует — используйте вход.'],expired:['Срок анкеты истёк','Можно заполнить новую анкету.']};
 const visible=value=>{box.hidden=!value;form.hidden=value;document.querySelector('#auth .auth-tabs').hidden=value;document.getElementById('form-login').hidden=value};
 login.onclick=()=>{dismissed=current?.id;visible(false);switchAuthTab('login',document.querySelector('.auth-tab'))};
 retry.onclick=()=>{dismissed=current?.id;visible(false);switchAuthTab('register',document.querySelectorAll('.auth-tab')[1])};
 function accept(r){
  if(!r||profile)return;current=r;
  if(r.status==='done'){
   if(r.profile&&typeof r.profile.gizmo_user_id==='number'&&r.profile.gizmo_user_id>0){password.value='';profile=r.profile;saveProfile(profile);visible(false);showApp()}
   else{title.textContent='Проверьте вход';message.textContent='Анкета обработана. Войдите в свой аккаунт';retry.hidden=true;visible(true)}
   return;
  }
  if(!messages[r.status]||dismissed===r.id)return;
  const [heading,text]=messages[r.status];if(title.textContent!==heading)title.textContent=heading;if(message.textContent!==text)message.textContent=text;
  retry.hidden=!['rejected','expired'].includes(r.status);visible(true);
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
  const data={action:'register_application',initData:tg?.initData||'',username:value('r-user'),password:password.value,first_name:value('r-name'),last_name:value('r-last'),mobile_phone:value('r-phone'),birth_date:value('r-birth'),sex:Number(document.querySelector('[name=sex]:checked')?.value)};
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
