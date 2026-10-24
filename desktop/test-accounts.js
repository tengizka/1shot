/* Settings → «Тесты»: test accounts from the testers' Telegram; delete takes two taps. */
(()=>{
 const $=id=>document.getElementById(id),list=$('test-list'),msg=$('test-message');
 const day=v=>v?new Date(v).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
 async function load(){
  if(!window.pywebview?.api)return;setDeskText(msg,'Загружаем…');
  const r=await window.pywebview.api.test_accounts();
  if(r?.error){setDeskText(msg,r.error);return}
  const rows=r.accounts||[];setDeskText(msg,rows.length?'':'Тестовых аккаунтов нет');
  list.replaceChildren(...rows.map(a=>{
   const row=document.createElement('div');row.className='test-row';
   const info=document.createElement('div');const b=document.createElement('b');b.textContent=(a.username||'без ника')+' · ID '+a.gizmo_user_id;
   const small=document.createElement('small');small.textContent=[day(a.created_at),a.code?'промокод '+a.code:'',a.gone?'в Gizmo уже удалён':''].filter(Boolean).join(' · ');
   info.append(b,small);
   const del=document.createElement('button');del.type='button';del.className='danger';del.textContent='Удалить';
   del.onclick=()=>armTap(del,'Точно удалить?',async()=>{del.disabled=true;setDeskText(msg,'Удаляем '+a.gizmo_user_id+'…');
    const res=await window.pywebview.api.delete_test_account(a.gizmo_user_id);del.disabled=false;
    if(res?.ok){setDeskText(msg,'Аккаунт '+a.gizmo_user_id+' удалён');load()}else setDeskText(msg,res?.error||'Не удалось удалить')});
   row.append(info,del);return row}));
 }
 $('test-refresh').onclick=load;
 document.querySelector('.settings-tabs [data-settings="tests"]')?.addEventListener('click',load);
})();
