/* Deliberately fixed destination: never accept a URL from query parameters before sending initData. */
(()=>{
 'use strict';
 const base='https://api.tengizka.fun', $=id=>document.getElementById(id),tg=window.Telegram?.WebApp;
 tg?.ready?.();$('page-origin').textContent=location.origin;
 let busy=false,timer=null,until=0,controller=null,serverOK=false,rounds=0,successes=0,failures=0;
 function status(id,kind,text){$(id).className=kind;$(id).querySelector('p').textContent=text;}
 function buttons(){ $('once').disabled=busy||!!until;$('monitor').disabled=busy||!!until;$('stop').disabled=!until;$('auth').disabled=busy||!!until||!serverOK||!tg?.initData; }
 function summary(text){$('summary').textContent=text;}
 function stop(){clearTimeout(timer);timer=null;until=0;controller?.abort();buttons();}
 async function request(path,body){
  const response=await fetch(base+path,{method:body===undefined?'GET':'POST',mode:'cors',credentials:'omit',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
  let data=null;try{data=await response.json()}catch{}
  return {status:response.status,data};
 }
 async function cycle(protection){
  if(busy)return;busy=true;serverOK=false;buttons();controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000),start=performance.now();
  let ok=false;
  try{
   status('health','pending','Проверяем HTTPS, доступ из этой страницы и локальную базу…');
   const h=await request('/healthz');if(h.status!==200||h.data?.ok!==true||h.data?.backend!=='local')throw Error('Сервер не подтвердил локальный backend. HTTP '+h.status);
   serverOK=true;status('health','ok','Локальный сервер ответил; проверка схемы PostgreSQL прошла.');
   status('database','pending','Читаем настройки и последние состояния ПК…');
   const c=await request('/api/club-bookings',{action:'capabilities'}),hosts=await request('/api/hosts');
   if(c.status!==200||typeof c.data?.enabled!=='boolean'||c.data?.protocol!==2||hosts.status!==200||!Array.isArray(hosts.data?.hosts))throw Error('Не удалось подтвердить чтение настроек и карты локальной базы.');
   const now=Date.now(),fresh=hosts.data.hosts.filter(h=>{const at=Date.parse(h.updated_at);return Number.isFinite(at)&&now-at>=-30000&&now-at<30000}).length;
   status('database','ok',`Бронирование: ${c.data.enabled?'включено':'выключено'}. Записей ПК: ${hosts.data.hosts.length}; свежих: ${fresh}. ${hosts.data.hosts.length?'':'Пустая база — нормальный результат на этом этапе.'}`);
   if(protection){
    status('protection','pending','Проверяем запреты без секретов и без игровых команд…');
    const unauth=await request('/api/club-bookings',{action:'list',initData:''}),admin=await request('/api/club-agent',{});
    if(unauth.status!==403||admin.status!==404)throw Error('Неожиданный результат проверки защиты. Не подключайте Desk до разбора.');
    status('protection','ok','Без Telegram-подписи — отказ 403. Служебный маршрут снаружи — 404.');
   }
   ok=true;summary(`Проверка ${++rounds}: успешно · ${Math.round(performance.now()-start)} мс на весь набор запросов.\nУспешно: ${++successes}; ошибок: ${failures}.\n${until?'Минутный тест продолжается.':'Связь подтверждена. Игровые действия не проверялись.'}`);
  }catch(e){
   rounds++;failures++;serverOK=false;
   const note=e.name==='AbortError'?'Проверка остановлена или сервер не ответил вовремя.':e instanceof TypeError?'Браузер не смог получить ответ. Возможные причины: туннель, DNS, HTTPS, интернет или CORS.':e.message;
   status('health','fail','Полная проверка не завершена. '+note);summary(`Проверка ${rounds}: неуспешно.\nУспешно: ${successes}; ошибок: ${failures}.\n${note}`);
  }finally{
   clearTimeout(timeout);busy=false;controller=null;
   if(until&&Date.now()<until&&!document.hidden)timer=setTimeout(()=>cycle(false),Math.max(0,5000-(performance.now()-start)));
   else if(until){until=0;summary(`Минутный тест завершён. Успешно: ${successes}; ошибок: ${failures}.\n${ok?'Последний набор запросов прошёл.':'Есть ошибки — соединение пока не считаем надёжным.'}`)}
   buttons();
  }
 }
 $('once').onclick=()=>cycle(true);
 $('monitor').onclick=()=>{rounds=successes=failures=0;until=Date.now()+60000;cycle(true)};
 $('stop').onclick=()=>{stop();summary('Тест остановлен.');};
 document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();summary('Страница скрыта — запросы остановлены. Для продолжения запусти проверку заново.')}});
 $('auth').onclick=async()=>{
  if(busy||!serverOK||!tg?.initData)return;busy=true;buttons();controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);
  try{
   const r=await request('/api/club-bookings',{action:'list',initData:tg.initData});
   if(r.status!==200||!Array.isArray(r.data?.bookings)){status('telegram','fail','Подпись не подтверждена или ответ сервера неверный. HTTP '+r.status);return;}
   status('telegram','ok','Сервер принял подпись Telegram и вернул список только этого пользователя. Пустой список допустим; вход в клубный аккаунт ещё не проверен.');
  }catch{status('telegram','fail','Не удалось завершить проверку Telegram. Переоткрой мини-апп и проверь соединение.');}
  finally{clearTimeout(timeout);controller=null;busy=false;buttons();}
 };
 if(tg?.initData)status('telegram','','Данные Telegram получены. Сначала проверь сервер, затем нажми «Проверить Telegram».');
 buttons();
})();
