/* «Еда»: the bar menu from Gizmo, an order goes to the reception as the usual «Сделать заказ» call.
   No money moves here: the admin rings it up in Gizmo. The guest sees sent → accepted → closed. */
(()=>{
 const body=document.querySelector('#ov-food .ov-body');if(!body)return;
 const PAY=[['card','Картой','при получении'],['cash','Наличными','при получении'],['deposit','С депозита','спишет администратор']];
 // Only deposit for now: the order lands in Gizmo, the admin rings it up there as usual.
 const STEPS=[['sent','Отправлен'],['accepted','Принят'],['closed','Закрыт']];
 const TITLES={new:'Отправлен',sent:'Отправлен',accepted:'Принят, несём',closed:'Закрыт'};
 const state={section:'food',menu:null,version:null,seat:null,account:true,desk:true,orders:[],cart:new Map(),group:null,payment:'deposit',view:'menu',busy:false,request:null,error:''};
 let timer=null,open=false,loading=false,shown='';
 const rub=n=>Number(n).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
 const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e};
 const tap=k=>{try{haptic(k)}catch{}};
 const total=()=>[...state.cart].reduce((s,[id,q])=>s+(item(id)?.price||0)*q,0);
 const count=()=>[...state.cart.values()].reduce((s,q)=>s+q,0);
 const item=id=>state.menu?.find(m=>m.id===id);

 async function call(action,data={}){
  return apiFetch(`${SUPA}/club-bookings`,{method:'POST',body:JSON.stringify({action,initData:tg?.initData||'',...data})});
 }
 async function load(){
  if(loading||!open)return;loading=true;
  try{
   if(!tg?.initData){state.error='Откройте приложение через Telegram';return}
   let s=await call('food_state',{menu:!state.menu});
   if(state.menu&&s.menu_version!==state.version)s=await call('food_state',{menu:true});
   if(Array.isArray(s.menu)){state.menu=s.menu;state.version=s.menu_version;for(const id of [...state.cart.keys()])if(!item(id))state.cart.delete(id)}
   Object.assign(state,{seat:s.seat,account:s.account,desk:s.desk,orders:s.orders||[],error:''});
  }catch(e){state.error=e.message||'Нет связи с клубом'}
  finally{
   loading=false;
   // Polling every 5 s re-draws only when something changed, so scrolling and taps are not interrupted.
   const now=JSON.stringify([state.menu?.length,state.version,state.seat,state.account,state.desk,state.orders,state.error]);
   if(now!==shown){shown=now;render()}
  }
 }
 function active(){
  const o=state.orders[0];if(!o)return null;
  return o.status!=='closed'||Date.now()-Date.parse(o.updated_at)<10*60000?o:null;
 }
 function blocker(){
  if(state.error)return state.error;
  if(!state.account)return 'Войдите в аккаунт клуба, чтобы заказать';
  if(!state.desk)return 'Заказы сейчас не принимаются. Позовите администратора с ПК';
  if(!state.seat)return 'Заказать можно, когда сидишь за ПК в клубе';
  const o=active();if(o&&['new','sent'].includes(o.status))return 'Прошлый заказ ещё у администратора';
  return '';
 }

 function orderCard(o){
  const card=el('section','food-order');card.dataset.status=o.status;
  const head=el('div','food-order-head');head.append(el('span','smm-tag','Заказ · ПК '+o.host_id),el('span','food-order-total',rub(o.total)));
  const title=el('h2','smm-title food-order-title',TITLES[o.status]||'Закрыт');
  const steps=el('ol','food-steps');const at=o.status==='new'?0:STEPS.findIndex(s=>s[0]===o.status);
  STEPS.forEach(([,label],i)=>{const li=el('li',i<=at?'on':'',label);steps.append(li)});
  const list=el('p','food-order-items',o.items.map(i=>i.name+' ×'+i.qty).join(', '));
  card.append(head,title,steps,list);
  if(o.status==='closed'&&o.message)card.append(el('p','smm-note',o.message));
  else if(o.status!=='closed')card.append(el('p','smm-note','Оплата: '+(PAY.find(p=>p[0]===o.payment)||['','—'])[1].toLowerCase()+'. Администратор принесёт заказ к ПК.'));
  return card;
 }

 function stepper(id,q){
  const box=el('div','food-qty');
  const minus=el('button','','−'),plus=el('button','','+');minus.type=plus.type='button';
  minus.setAttribute('aria-label','Убрать');plus.setAttribute('aria-label','Добавить');plus.disabled=q>=5;
  minus.onclick=()=>{q>1?state.cart.set(id,q-1):state.cart.delete(id);tap('select');render()};
  plus.onclick=()=>{if(q<5){state.cart.set(id,q+1);tap('select');render()}};
  box.append(minus,el('b','',String(q)),plus);return box;
 }
 function product(m){
  const card=el('article','food-card');
  const pic=el('div','food-pic');
  if(typeof m.image==='string'&&m.image.startsWith('data:image/')){const img=el('img');img.src=m.image;img.alt='';img.loading='lazy';pic.append(img)}
  else pic.append(el('span','food-pic-letter',m.name.trim()[0]||'·'));
  const q=state.cart.get(m.id)||0;
  const add=el('button','food-add',q?null:'+ '+rub(m.price));add.type='button';
  card.append(pic,el('h3','',m.name));
  if(q)card.append(el('span','food-price',rub(m.price)),stepper(m.id,q));
  else{add.onclick=()=>{state.cart.set(m.id,1);tap('select');render()};card.append(add)}
  return card;
 }

 function menuView(){
  const frag=document.createDocumentFragment();
  const o=active();if(o)frag.append(orderCard(o));
  if(!state.menu){
   // Loading: a bouncing cup in the middle, no caption.
   const wait=el('div','food-loading');wait.setAttribute('role','status');wait.setAttribute('aria-label','Загрузка меню');
   wait.innerHTML='<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 16h24l-3 26H15Z"/><path d="M10 16h28M24 16V8h8"/></svg>';
   frag.append(wait);return frag;
  }
  // Until Desk at the club has sent the menu, keep the old "soon" card instead of an empty list.
  if(!state.menu.length){frag.append(el('span','smm-tag','Скоро'),el('h2','smm-title food-soon-title','Еда\nи напитки'),el('p','smm-text','Здесь появится меню бара клуба.'));return frag}
  const groups=[...new Set(state.menu.map(m=>m.group))];
  if(!groups.includes(state.group))state.group=groups[0];
  if(groups.length>1){
   const tabs=el('div','food-groups');tabs.setAttribute('role','tablist');
   for(const g of groups){const b=el('button','',g);b.type='button';b.setAttribute('aria-selected',String(g===state.group));b.onclick=()=>{state.group=g;tap('select');render();body.scrollTop=0};tabs.append(b)}
   frag.append(tabs);
  }
  const grid=el('div','food-grid');state.menu.filter(m=>m.group===state.group).forEach(m=>grid.append(product(m)));frag.append(grid);
  const why=blocker();
  if(count()){
   const bar=el('div','food-bar');const go=el('button','btn-main',why?why:'Оформить · '+rub(total()));go.type='button';go.disabled=!!why;
   go.onclick=()=>{state.view='checkout';state.request=state.request||crypto.randomUUID();tap('select');render();body.scrollTop=0};
   bar.append(el('span','food-bar-count',count()+' шт.'),go);frag.append(bar);
  }
  return frag;
 }

 function checkoutView(){
  const frag=document.createDocumentFragment();
  const back=el('button','food-back','← Меню');back.type='button';back.onclick=()=>{state.view='menu';render()};
  frag.append(back,el('span','smm-tag','ПК '+(state.seat||'—')),el('h2','smm-title','Твой заказ'));
  const list=el('div','food-lines');
  for(const [id,q] of state.cart){const m=item(id);if(!m)continue;const row=el('div','food-line');row.append(el('span','',m.name),stepper(id,q),el('b','',rub(m.price*q)));list.append(row)}
  frag.append(list,el('div','food-sum'));frag.lastChild.append(el('span','','Итого'),el('b','',rub(total())));
  const pay=el('div','food-pay-one');pay.append(el('span','','Оплата'),el('b','','С депозита'));frag.append(pay);
  const why=blocker()||(!count()?'Корзина пустая':'');
  const send=el('button','btn-main',state.busy?'Отправляем…':why||'Отправить на ресепшен');send.type='button';send.disabled=!!why||state.busy;send.onclick=submit;
  frag.append(send);
  return frag;
 }

 async function submit(){
  if(state.busy)return;state.busy=true;render();
  try{
   const items=[...state.cart].map(([id,qty])=>({id,qty}));
   const r=await call('food_order',{request_id:state.request,items,payment:state.payment});
   state.orders=[r.order,...state.orders.filter(o=>o.id!==r.order.id)];
   state.cart.clear();state.request=null;state.view='menu';tap('ok');toast('Заказ отправлен на ресепшен','ok');
  }catch(e){
   const text=String(e.message||'Не получилось отправить').replace(/^HTTP \d+: /,'');
   // A refused order is not created: a new attempt gets a new id; a lost answer keeps it so a retry is not a second order.
   if(/HTTP 4\d\d/.test(e.message||''))state.request=crypto.randomUUID();
   toast(text,'err');
  }finally{state.busy=false;render();load()}
 }

 function render(){
  if(state.view==='checkout'&&!count())state.view='menu';
  body.classList.remove('food-soon');body.classList.add('food');
  const tabs=el('div','market-tabs');tabs.setAttribute('role','tablist');
  for(const [key,label] of [['food','Еда'],['packs','Пакеты часов']]){const b=el('button','',label);b.type='button';b.setAttribute('aria-selected',String(state.section===key));b.onclick=()=>{if(state.section===key)return;state.section=key;state.view='menu';tap('select');render();body.scrollTop=0};tabs.append(b)}
  body.replaceChildren(tabs,state.section==='packs'?packsView():state.view==='checkout'?checkoutView():menuView());
 }
 function packsView(){
  // Time packages are sold here after online payment is connected.
  const frag=document.createDocumentFragment();
  frag.append(el('span','smm-tag','Скоро'),el('h2','smm-title food-soon-title','Пакеты\nчасов'),el('p','smm-text','Купить пакет часов можно будет прямо здесь, без очереди на ресепшене.'));
  return frag;
 }
 function start(){if(open)return;open=true;shown='';render();load();clearInterval(timer);timer=setInterval(()=>{if(!document.hidden)load()},5000)}
 function stop(){open=false;clearInterval(timer)}
 const nav=window.navTo;
 window.navTo=tab=>{nav(tab);tab==='food'?start():stop()};
 window.foodScreen={start,stop,state};
})();
