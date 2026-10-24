/* Trusted local staff UI. A checkbox is confirmation, not an authorization mechanism. */
(()=>{
 const tab=document.createElement('button');tab.className='tab';tab.dataset.panel='registrations';tab.textContent='Анкеты';tab.onclick=()=>panel('registrations');document.querySelector('nav').insertBefore(tab,document.querySelector('nav .exit'));
 const section=document.createElement('section');section.id='panel-registrations';section.hidden=true;const title=document.createElement('h2');title.textContent='Анкеты';const note=document.createElement('p');note.className='note';const list=document.createElement('div');list.className='registration-list';const tools=document.createElement('div');tools.className='registration-tools';tools.innerHTML='<input type="search" id="registration-search" placeholder="Поиск: имя, ник, телефон, промокод" autocomplete="off" maxlength="60"><select id="registration-sort" aria-label="Сортировка"><option value="new">Сначала новые</option><option value="old">Сначала старые</option><option value="name">По имени</option><option value="promo">Сначала с промокодом</option></select><span id="registration-count" class="note"></span>';section.append(title,tools,note,list);document.querySelector('main').append(section);
 const promoText=p=>!p?'':p.result==='granted'?' · Час Standart начислен (промокод '+p.code+')':p.result==='failed'?' · Час не начислен'+(p.error?': '+p.error:'')+'. Начислите вручную':' · Проверьте в Gizmo, начислен ли час Standart. Не начисляйте повторно не проверив';
 const states={awaiting_admin:'Ожидает проверки личности',processing:'Создаём аккаунт. Не повторяйте действие',attention:'Нужна ручная сверка. Повторное создание заблокировано'};
 function create(){
  const card=document.createElement('article');card.className='card';const name=document.createElement('h3'),when=document.createElement('p'),info=document.createElement('p'),state=document.createElement('p'),label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';label.className='check';label.append(check,document.createTextNode('Личность проверена очно, данные анкеты сверены'));
  const approve=document.createElement('button'),reject=document.createElement('button'),message=document.createElement('p'),actions=document.createElement('div');actions.className='actions';approve.textContent='Подтвердить и создать';reject.textContent='Отклонить';message.setAttribute('role','status');const review=document.createElement('button'),finish=document.createElement('button'),candidate=document.createElement('p');review.textContent='Проверить вход гостя';finish.textContent='Завершить сверку';const password=document.createElement('button');password.textContent='Разрешить владельцу задать пароль';actions.append(approve,reject,review,finish,password);when.className='registration-when';card.append(name,when,info,state,candidate,label,actions,message);
  const sync=()=>{const available=card.ready&&card.row.status==='awaiting_admin'&&!card.busy&&!card.blocked;approve.disabled=!available||!check.checked;reject.disabled=!available;const attention=card.ready&&card.row.status==='attention'&&!card.busy;review.hidden=finish.hidden=card.row.status!=='attention';review.disabled=!attention;finish.disabled=!attention||!card.proof||!check.checked;check.disabled=!available&&!attention;password.hidden=card.row.status!=='attention'||!card.row.gizmo_user_id;password.disabled=!attention||!check.checked||!current?.password_ready;approve.hidden=reject.hidden=card.row.status==='attention'};check.onchange=sync;
  async function send(method){
   if(card.busy||card.blocked||!card.ready||card.row.status!=='awaiting_admin'||(method==='approve_registration'&&!check.checked))return;
   card.busy=true;sync();
   try{const result=await invoke(method,card.row.id,true);card.blocked=method==='approve_registration'||result?.ok===true;setDeskText(message,(result?.error||(result?.ok?(result.synced===false?'Аккаунт проверен. Ожидаем синхронизацию; не повторяйте создание':'Готово'):result?.status==='rejected'?'Найден дубль. Используйте существующий аккаунт':'Нужна ручная сверка. Не повторяйте создание'))+promoText(result?.promo));}
   finally{card.busy=false;sync()}
  }
  password.onclick=async()=>{
   if(password.disabled||card.busy)return;
   card.busy=true;sync();try{const r=await invoke('authorize_guest_password','registration',card.row.id,card.row.gizmo_user_id,card.row.public_data.username,true,false);setDeskText(message,r?.ok?'Разрешение выдано. Гость задаёт пароль сам, затем входит с телефона для сверки.':r?.error||'Нет подтверждения')}finally{card.busy=false;sync()}
  };
  review.onclick=async()=>{
   if(card.busy||!card.ready)return;card.busy=true;card.proof=null;check.checked=false;sync();
   try{const result=await invoke('review_registration',card.row.id);if(result?.proof_id){card.proof=result;setDeskText(candidate,[result.username,result.first_name,result.last_name,result.mobile_phone,'ID '+result.gizmo_user_id].filter(Boolean).join(' · '));setDeskText(message,'Гость успешно вошёл сам. Сверьте личность и именно этот аккаунт. Пароль не меняется.')}else{setDeskText(candidate,'');setDeskText(message,result?.error||'Нет подтверждённого входа')}}finally{card.busy=false;sync()}
  };
  finish.onclick=async()=>{
   if(card.busy||!card.ready||!check.checked||!card.proof)return;
   const proof=card.proof;
   card.busy=true;sync();try{const result=await invoke('reconcile_registration',card.row.id,proof.proof_id,proof.gizmo_user_id,true);setDeskText(message,result?.ok?'Сверка завершена. Аккаунт и пароль не менялись':result?.error||'Нет подтверждения результата');if(result?.ok){card.proof=null;check.checked=false}}finally{card.busy=false;sync()}
  };
  approve.onclick=()=>send('approve_registration');reject.onclick=()=>send('reject_registration');
  card.update=(r,ready)=>{if(card.row&&card.row.status!==r.status){card.proof=null;check.checked=false;setDeskText(candidate,'')}card.row=r;card.ready=ready;card.dataset.registrationId=r.id;const d=r.public_data||{};setDeskText(name,d.username||'Анкета');setDeskText(when,applicationWhen(r));setDeskText(info,[d.first_name,d.last_name,d.mobile_phone,d.birth_date,d.sex===1?'Мужской':d.sex===2?'Женский':'',d.promo_code?'Промокод '+d.promo_code+': час Standart':''].filter(Boolean).join(' · '));setDeskText(state,(states[r.status]||r.status)+(r.gizmo_user_id?' · Созданный ID: '+r.gizmo_user_id:''));sync()};return card;
 }
 const MSK={timeZone:'Europe/Moscow'};
 function applicationWhen(r){
  const at=new Date(r.created_at);if(!Number.isFinite(at.getTime()))return '';
  const date=at.toLocaleDateString('ru-RU',{...MSK,day:'numeric',month:'long'})+', '+at.toLocaleTimeString('ru-RU',{...MSK,hour:'2-digit',minute:'2-digit'});
  const left=Math.ceil((Date.parse(r.expires_at)-Date.now())/86400000);
  return 'Подана '+date+(r.status==='awaiting_admin'&&Number.isFinite(left)?' · ждёт ещё '+Math.max(left,0)+' дн.':'');
 }
 const digits=v=>String(v||'').replace(/\D/g,'');
 function matches(r,q){
  if(!q)return true;const d=r.public_data||{},text=[d.username,d.first_name,d.last_name,d.promo_code].filter(Boolean).join(' ').toLowerCase();
  const qd=digits(q),phone=digits(d.mobile_phone);if(text.includes(q.toLowerCase()))return true;if(qd.length<3)return false;
  // 8 999… and +7 999… are the same Russian number: compare without the leading 8/7 too.
  return phone.includes(qd)||(/^[78]/.test(qd)&&qd.length>=4&&phone.slice(1).startsWith(qd.slice(1)));
 }
 const fullName=r=>{const d=r.public_data||{};return [d.first_name,d.last_name,d.username].filter(Boolean).join(' ').toLowerCase()};
 const SORT={new:(a,b)=>String(b.created_at).localeCompare(String(a.created_at)),old:(a,b)=>String(a.created_at).localeCompare(String(b.created_at)),name:(a,b)=>fullName(a).localeCompare(fullName(b),'ru'),promo:(a,b)=>(!!b.public_data?.promo_code-!!a.public_data?.promo_code)||SORT.new(a,b)};
 const search=document.getElementById('registration-search'),sort=document.getElementById('registration-sort'),count=document.getElementById('registration-count');
 search.oninput=sort.onchange=()=>current&&window.renderRegistrations(current);
 window.renderRegistrations=s=>{
  setDeskText(note,s.registration_ready?'':'Нет связи с сервером');
  const all=s.registrations||[],q=search.value.trim(),rows=all.filter(r=>matches(r,q)).sort(SORT[sort.value]||SORT.new);
  setDeskText(count,all.length?(q?'Найдено '+rows.length+' из '+all.length:'Всего '+all.length):'Анкет нет');
  const existing=new Map([...list.children].map(c=>[c.dataset.registrationId,c]));const nodes=rows.map(r=>{const card=existing.get(r.id)||create();card.update(r,s.registration_ready);return card});reconcileDeskChildren(list,nodes);
 };if(current)window.renderRegistrations(current);
})();
