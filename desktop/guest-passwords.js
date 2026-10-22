/* The local API rejects admin-chosen passwords even when this UI is not available. */
(()=>{
 let installed=false,ready=false,busy=false;
 const grants=document.createElement('div');grants.id='guest-password-grants';document.getElementById('password-requests').after(grants);
 function grantCard(){
  const node=document.createElement('article');node.className='reset-request';const text=document.createElement('p'),message=document.createElement('p'),review=document.createElement('button'),finish=document.createElement('button');
  const identity=document.createElement('input'),privileged=document.createElement('input'),label=document.createElement('label'),extra=document.createElement('label');identity.type=privileged.type='checkbox';label.className=extra.className='check';label.append(identity,document.createTextNode('Личность и аккаунт сверены очно'));extra.append(privileged,document.createTextNode('Подтверждаю сверку служебного аккаунта'));review.textContent='Проверить доступ владельца';finish.textContent='Закрыть попытку после входа';message.setAttribute('role','status');node.append(text,review,label,extra,finish,message);
  const sync=()=>{const attention=node.grant.status==='attention';review.hidden=label.hidden=finish.hidden=!attention;extra.hidden=!attention||!node.proof?.requires_privileged_confirmation;review.disabled=!ready||node.busy||node.resolved;finish.disabled=!ready||node.busy||node.resolved||!node.proof||!identity.checked||(node.proof.requires_privileged_confirmation&&!privileged.checked)};identity.onchange=privileged.onchange=sync;
  review.onclick=async()=>{if(review.disabled)return;node.busy=true;node.proof=null;identity.checked=privileged.checked=false;sync();try{const r=await invoke('review_guest_password',node.grant.id);if(r?.proof_id){node.proof=r;setDeskText(message,'Владелец вошёл в '+r.username+' (ID '+r.gizmo_user_id+'). Это подтверждает доступ, но не результат смены пароля.')}else setDeskText(message,r?.error||'Нет подтверждения входа')}finally{node.busy=false;sync()}};
  finish.onclick=async()=>{if(finish.disabled)return;const p=node.proof;node.busy=true;sync();try{const r=await invoke('resolve_guest_password',node.grant.id,p.proof_id,p.gizmo_user_id,true,privileged.checked);node.resolved=r?.ok===true;setDeskText(message,r?.ok?'Доступ подтверждён. Попытка закрыта без повторной смены пароля.':r?.error||'Нет подтверждения результата')}finally{node.busy=false;sync()}};
  node.update=(g,names)=>{if(node.grant?.status!==g.status){node.proof=null;identity.checked=privileged.checked=false}node.grant=g;node.dataset.id=g.id;setDeskText(text,(g.username||'Аккаунт')+' · '+(names[g.status]||g.status));sync()};return node;
 }
 window.renderGuestPasswords=s=>{
  if(!Object.hasOwn(s,'password_ready'))return; // Old snapshot fixture/runtime: do not pretend grants exist.
  ready=s.password_ready;
  if(!installed){
   installed=true;const password=$('new-password');password.value='';password.required=false;password.disabled=true;password.closest('label').hidden=true;password.type='text';password.minLength=3;password.autocomplete='off';
   // With the guest's request: the owner types the password on the phone. Without it: the admin sets one here (3 random digits by default).
   const oldChoose=chooseAccount;chooseAccount=(user,id=null)=>{oldChoose(user,id);const direct=!id;password.disabled=!direct;password.closest('label').hidden=!direct;password.value=direct?String(Math.floor(Math.random()*1000)).padStart(3,'0'):'';setDeskText($('reset-user').querySelector('button'),direct?'Сменить пароль':'Разрешить ввод пароля на телефоне');$('identity-checked').focus({preventScroll:true});$('account-message').textContent=id?'Разрешение на 10 минут. Пароль владелец введёт сам.':'Новый пароль скажите гостю лично'};
   const heading=$('reset-user').closest('.surface').querySelector('h3');setDeskText(heading,'Пароль');
   $('reset-user').onsubmit=async event=>{
    event.preventDefault();if(busy||!foundAccount||!$('identity-checked').checked)return;
    if(!selectedResetRequest){
     const user=foundAccount,privileged=$('privileged-checked').checked,value=password.value.trim();
     if(user.requires_privileged_confirmation&&!privileged)return;
     if(value.length<3){setDeskText($('account-message'),'Пароль: минимум 3 символа');return}
     busy=true;
     try{const r=await invoke('reset_password',user.id,user.username,value,true,privileged);setDeskText($('account-message'),r?.ok?'Готово. Новый пароль '+user.username+': '+value:r?.error||'Результат неизвестен. Проверьте аккаунт вручную');if(r?.ok){$('reset-user').hidden=true;password.value=''}}finally{busy=false}
     return;
    }
    if(!ready)return;
    const user=foundAccount,id=selectedResetRequest,privileged=$('privileged-checked').checked;
    if(user.requires_privileged_confirmation&&!privileged)return;
    
    busy=true;
    try{const r=await invoke('authorize_guest_password','password_request',id,user.id,user.username,true,privileged);setDeskText($('account-message'),r?.ok?'Разрешение выдано. Пароль вводит владелец на телефоне.':r?.error||'Нет подтверждения');if(r?.ok)$('reset-user').hidden=true}finally{busy=false}
   };
  }
  if(!ready)setDeskText($('account-message'),'Восстановление пока недоступно: требуется обновлённый сервер и связь с Desk');
  const submit=$('reset-user').querySelector('button');if(selectedResetRequest)setDeskText(submit,'Разрешить ввод пароля на телефоне');submit.disabled=(!!selectedResetRequest&&!ready)||busy;
  for(const card of $('password-requests').querySelectorAll('.reset-request')){
   const active=(s.password_grants||[]).some(g=>g.source_id===card.dataset.requestId);
   const buttons=card.querySelectorAll('button');if(buttons[0])setDeskText(buttons[0],'Проверить аккаунт и разрешить');if(buttons[1])buttons[1].hidden=true;if(buttons[2])buttons[2].hidden=active;
  }
  const existing=new Map([...grants.children].map(n=>[n.dataset.id,n]));
  const names={authorized:'Владелец может задать пароль',queued:'Пароль принят. Ожидает обработки',processing:'Проверяем установку пароля',attention:'Результат неизвестен. Не повторяйте смену'};
  const nodes=(s.password_grants||[]).map(g=>{const node=existing.get(g.id)||grantCard();node.update(g,names);return node});reconcileDeskChildren(grants,nodes);
 };
})();
