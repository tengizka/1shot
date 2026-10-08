/* Trusted local staff UI. A checkbox is confirmation, not an authorization mechanism. */
(()=>{
 const tab=document.createElement('button');tab.className='tab';tab.dataset.panel='registrations';tab.textContent='Анкеты';tab.onclick=()=>panel('registrations');document.querySelector('nav').insertBefore(tab,document.querySelector('nav .exit'));
 const section=document.createElement('section');section.id='panel-registrations';section.hidden=true;const title=document.createElement('h2');title.textContent='Очная регистрация';const note=document.createElement('p');note.className='note';const list=document.createElement('div');list.className='registration-list';section.append(title,note,list);document.querySelector('main').append(section);
 const states={awaiting_admin:'Ожидает проверки личности',processing:'Создаём аккаунт. Не повторяйте действие',attention:'Нужна ручная сверка. Повторное создание заблокировано'};
 function create(){
  const card=document.createElement('article');card.className='card';const name=document.createElement('h3'),info=document.createElement('p'),state=document.createElement('p'),label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';label.className='check';label.append(check,document.createTextNode('Личность проверена очно, данные анкеты сверены'));
  const approve=document.createElement('button'),reject=document.createElement('button'),message=document.createElement('p'),actions=document.createElement('div');actions.className='actions';approve.textContent='Подтвердить и создать';reject.textContent='Отклонить';message.setAttribute('role','status');const review=document.createElement('button'),finish=document.createElement('button'),candidate=document.createElement('p');review.textContent='Проверить вход гостя';finish.textContent='Завершить сверку';const password=document.createElement('button');password.textContent='Разрешить владельцу задать пароль';actions.append(approve,reject,review,finish,password);card.append(name,info,state,candidate,label,actions,message);
  const sync=()=>{const available=card.ready&&card.row.status==='awaiting_admin'&&!card.busy&&!card.blocked;approve.disabled=!available||!check.checked;reject.disabled=!available;const attention=card.ready&&card.row.status==='attention'&&!card.busy;review.hidden=finish.hidden=card.row.status!=='attention';review.disabled=!attention;finish.disabled=!attention||!card.proof||!check.checked;check.disabled=!available&&!attention;password.hidden=card.row.status!=='attention'||!card.row.gizmo_user_id;password.disabled=!attention||!check.checked||!current?.password_ready;approve.hidden=reject.hidden=card.row.status==='attention'};check.onchange=sync;
  async function send(method){
   if(card.busy||card.blocked||!card.ready||card.row.status!=='awaiting_admin'||(method==='approve_registration'&&!check.checked))return;
   if(!confirm(method==='approve_registration'?'Создать аккаунт '+card.row.public_data.username+' после очной проверки личности?':'Отклонить анкету без создания аккаунта?'))return;
   card.busy=true;sync();
   try{const result=await invoke(method,card.row.id,true);card.blocked=method==='approve_registration'||result?.ok===true;setDeskText(message,result?.error||(result?.ok?(result.synced===false?'Аккаунт проверен. Ожидаем синхронизацию; не повторяйте создание':'Готово'):result?.status==='rejected'?'Найден дубль. Используйте существующий аккаунт':'Нужна ручная сверка. Не повторяйте создание'));}
   finally{card.busy=false;sync()}
  }
  password.onclick=async()=>{
   if(password.disabled||card.busy)return;if(!confirm('Разрешить гостю задать пароль для проверенного аккаунта ID '+card.row.gizmo_user_id+' с телефона?'))return;
   card.busy=true;sync();try{const r=await invoke('authorize_guest_password','registration',card.row.id,card.row.gizmo_user_id,card.row.public_data.username,true,false);setDeskText(message,r?.ok?'Разрешение выдано. Гость задаёт пароль сам, затем входит с телефона для сверки.':r?.error||'Нет подтверждения')}finally{card.busy=false;sync()}
  };
  review.onclick=async()=>{
   if(card.busy||!card.ready)return;card.busy=true;card.proof=null;check.checked=false;sync();
   try{const result=await invoke('review_registration',card.row.id);if(result?.proof_id){card.proof=result;setDeskText(candidate,[result.username,result.first_name,result.last_name,result.mobile_phone,'ID '+result.gizmo_user_id].filter(Boolean).join(' · '));setDeskText(message,'Гость успешно вошёл сам. Сверьте личность и именно этот аккаунт. Пароль не меняется.')}else{setDeskText(candidate,'');setDeskText(message,result?.error||'Нет подтверждённого входа')}}finally{card.busy=false;sync()}
  };
  finish.onclick=async()=>{
   if(card.busy||!card.ready||!check.checked||!card.proof)return;
   const proof=card.proof;if(!confirm('Завершить сверку аккаунта '+proof.username+' (ID '+proof.gizmo_user_id+')? Создания аккаунта и смены пароля не будет.'))return;
   card.busy=true;sync();try{const result=await invoke('reconcile_registration',card.row.id,proof.proof_id,proof.gizmo_user_id,true);setDeskText(message,result?.ok?'Сверка завершена. Аккаунт и пароль не менялись':result?.error||'Нет подтверждения результата');if(result?.ok){card.proof=null;check.checked=false}}finally{card.busy=false;sync()}
  };
  approve.onclick=()=>send('approve_registration');reject.onclick=()=>send('reject_registration');
  card.update=(r,ready)=>{if(card.row&&card.row.status!==r.status){card.proof=null;check.checked=false;setDeskText(candidate,'')}card.row=r;card.ready=ready;card.dataset.registrationId=r.id;const d=r.public_data||{};setDeskText(name,d.username||'Анкета');setDeskText(info,[d.first_name,d.last_name,d.mobile_phone,d.birth_date,d.sex===1?'Мужской':d.sex===2?'Женский':''].filter(Boolean).join(' · '));setDeskText(state,(states[r.status]||r.status)+(r.gizmo_user_id?' · Созданный ID: '+r.gizmo_user_id:''));sync()};return card;
 }
 window.renderRegistrations=s=>{
  setDeskText(note,s.registration_ready?'Проверьте личность гостя и отсутствие существующего аккаунта. Пароль задаёт гость; администратор его не видит.':'Очная регистрация недоступна: требуется обновлённый сервер и связь с Desk.');
  const existing=new Map([...list.children].map(c=>[c.dataset.registrationId,c]));const nodes=(s.registrations||[]).map(r=>{const card=existing.get(r.id)||create();card.update(r,s.registration_ready);return card});reconcileDeskChildren(list,nodes);
 };if(current)window.renderRegistrations(current);
})();
