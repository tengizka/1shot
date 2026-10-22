/* Trusted local Desk tools: account search and staff password reset. Nothing here grants permissions to Telegram clients. */
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
  resetting=true;resetPicker.clear();$('account-search').disabled=true;const btn=e.target.querySelector('button');btn.disabled=true;
  const password=$('new-password').value;$('new-password').value='';
  try{const r=req?await api('reset_password_request',req,user.username,password,true,privileged):await api('reset_password',user.id,user.username,password,true,privileged);
   $('account-message').textContent=r?.ok?(r.synced===false?'Пароль проверен. Ожидаем синхронизацию — не повторяйте смену.':'Пароль изменён и проверен. Сообщите его владельцу лично.'):r?.error||'Результат неизвестен. Проверьте аккаунт вручную';
   if(r?.ok){foundAccount=null;selectedResetRequest=null;$('reset-user').hidden=true}
  }finally{resetting=false;btn.disabled=false;$('account-search').disabled=false}
 };
 window.accountPicker=picker;
})();
