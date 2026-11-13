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
 // «Тестовый заказ»: two taps, then the result says what Gizmo got and from whose account.
 const user=$('test-order-user'),go=$('test-order-go'),orderMsg=$('test-order-message');
 user.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();user.blur()}});
 go.onclick=()=>armTap(go,'Точно заказать?',async()=>{
  go.disabled=true;setDeskText(orderMsg,'Заказываем…');
  const r=await window.pywebview.api.test_order(user.value);go.disabled=false;
  setDeskText(orderMsg,r?.ok?`Готово: ${r.item} · ${r.price} ₽ для ${r.user}, оплата с депозита (способ ${r.method}). `+(r.owner_account?'От аккаунта владельца.':'⚠ MONEY_GIZMO_LOGIN не задан — заказ от основного логина Desk.')+' Проверьте его в Gizmo и отмените.':r?.error||'Не получилось');
 });
 // «Тестовый бесплатный час»: two taps, then every step Desk did in Gizmo, the failing one in pink.
 const hourUser=$('test-hour-user'),hourGo=$('test-hour-go'),hourSteps=$('test-hour-steps');
 hourUser.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();hourUser.blur()}});
 hourGo.onclick=()=>armTap(hourGo,'Точно выдать?',async()=>{
  hourGo.disabled=true;hourSteps.replaceChildren(Object.assign(document.createElement('p'),{className:'note',textContent:'Выдаём час…'}));
  const r=await window.pywebview.api.test_free_hour(hourUser.value);hourGo.disabled=false;
  const rows=(r?.steps||['Нет ответа от Desk']).map((t,i,a)=>Object.assign(document.createElement('p'),{className:i===a.length-1&&!r?.ok?'bad':'',textContent:t}));
  rows.push(Object.assign(document.createElement('p'),{className:r?.ok?'good':'bad',textContent:r?.ok?'Готово: час выдан и подписан':'Час не выдан. Скиньте этот список Claude'}));
  hourSteps.replaceChildren(...rows);
 });
 document.querySelector('.settings-tabs [data-settings="tests"]')?.addEventListener('click',load);
})();
