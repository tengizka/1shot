/* Trusted local staff UI. A checkbox is confirmation, not an authorization mechanism. */
(()=>{
 const tab=document.createElement('button');tab.className='tab';tab.dataset.panel='registrations';tab.textContent='Анкеты';tab.onclick=()=>panel('registrations');document.querySelector('nav').insertBefore(tab,document.querySelector('nav .exit'));
 const section=document.createElement('section');section.id='panel-registrations';section.hidden=true;const title=document.createElement('h2');title.textContent='Очная регистрация';const note=document.createElement('p');note.className='note';const list=document.createElement('div');list.className='registration-list';section.append(title,note,list);document.querySelector('main').append(section);
 const states={awaiting_admin:'Ожидает проверки личности',processing:'Создаём аккаунт. Не повторяйте действие',attention:'Нужна ручная сверка. Повторное создание заблокировано'};
 function create(){
  const card=document.createElement('article');card.className='card';const name=document.createElement('h3'),info=document.createElement('p'),state=document.createElement('p'),label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';label.className='check';label.append(check,document.createTextNode('Личность проверена очно, данные анкеты сверены'));
  const approve=document.createElement('button'),reject=document.createElement('button'),message=document.createElement('p'),actions=document.createElement('div');actions.className='actions';approve.textContent='Подтвердить и создать';reject.textContent='Отклонить';message.setAttribute('role','status');actions.append(approve,reject);card.append(name,info,state,label,actions,message);
  const sync=()=>{const available=card.ready&&card.row.status==='awaiting_admin'&&!card.busy&&!card.blocked;approve.disabled=!available||!check.checked;reject.disabled=!available;check.disabled=!available};check.onchange=sync;
  async function send(method){
   if(card.busy||card.blocked||!card.ready||card.row.status!=='awaiting_admin'||(method==='approve_registration'&&!check.checked))return;
   if(!confirm(method==='approve_registration'?'Создать аккаунт '+card.row.public_data.username+' после очной проверки личности?':'Отклонить анкету без создания аккаунта?'))return;
   card.busy=true;sync();
   try{const result=await invoke(method,card.row.id,true);card.blocked=method==='approve_registration'||result?.ok===true;setDeskText(message,result?.error||(result?.ok?(result.synced===false?'Аккаунт проверен. Ожидаем синхронизацию; не повторяйте создание':'Готово'):result?.status==='rejected'?'Найден дубль. Используйте существующий аккаунт':'Нужна ручная сверка. Не повторяйте создание'));}
   finally{card.busy=false;sync()}
  }
  approve.onclick=()=>send('approve_registration');reject.onclick=()=>send('reject_registration');
  card.update=(r,ready)=>{card.row=r;card.ready=ready;card.dataset.registrationId=r.id;const d=r.public_data||{};setDeskText(name,d.username||'Анкета');setDeskText(info,[d.first_name,d.last_name,d.mobile_phone,d.birth_date,d.sex===1?'Мужской':d.sex===2?'Женский':''].filter(Boolean).join(' · '));setDeskText(state,(states[r.status]||r.status)+(r.gizmo_user_id?' · Созданный ID: '+r.gizmo_user_id:''));sync()};return card;
 }
 window.renderRegistrations=s=>{
  setDeskText(note,s.registration_ready?'Проверьте личность гостя и отсутствие существующего аккаунта. Пароль задаёт гость; администратор его не видит.':'Очная регистрация недоступна: требуется обновлённый сервер и связь с Desk.');
  const existing=new Map([...list.children].map(c=>[c.dataset.registrationId,c]));const nodes=(s.registrations||[]).map(r=>{const card=existing.get(r.id)||create();card.update(r,s.registration_ready);return card});reconcileDeskChildren(list,nodes);
 };if(current)window.renderRegistrations(current);
})();
