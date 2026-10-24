const {chromium}=require('playwright-core'),binary=require('@sparticuz/chromium').default,fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),page=await context.newPage(),calls=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.Telegram={WebApp:{initData:'test',initDataUnsafe:{user:{id:123}},ready(){},expand(){},enableClosingConfirmation(){},setHeaderColor(){},setBackgroundColor(){}}};
   localStorage.setItem('1shot_v2_profile',JSON.stringify({telegram_id:123,gizmo_user_id:77,username:'neo'}));
  });
  const pic='data:image/webp;base64,'+'UklGRg==';
  const server={seat:null,orders:[],menu:[{id:10,group:'Напитки',name:'Red Bull',price:189,image:pic},{id:12,group:'Напитки',name:'Вода',price:60,image:'javascript:alert(1)'},{id:11,group:'Снеки',name:'Lays',price:120,image:null},{id:30,group:'Аренда',name:'Аренда мышки Logitech G PRO X Superlight',price:199,image:null},{id:60,group:'Standart',name:'3 часа Standart',price:499,image:null},{id:61,group:'Standart',name:'Пакет Ночь Standart',price:899,image:null},{id:62,group:'VIP',name:'3 часа VIP',price:599,image:null}],fail:null};
  await page.route('**/*',route=>{const url=new URL(route.request().url());
   if(url.host==='club.test'){
    const rawPath=url.pathname==='/'?'index.html':url.pathname.slice(1),file=fs.existsSync('miniapp/'+rawPath)?'miniapp/'+rawPath:rawPath;
    if(fs.existsSync(file))return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html',body:fs.readFileSync(file)});
   }
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
   if(url.pathname.endsWith('/club-bookings')){
    const b=route.request().postDataJSON();calls.push(b);
    if(b.action==='food_state')return route.fulfill({contentType:'application/json',body:JSON.stringify({menu_version:'1-3',menu:b.menu?server.menu:null,account:true,desk:true,seat:server.seat,orders:server.orders})});
    if(b.action==='food_order'){
     if(server.fail)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:server.fail})});
     const order={id:'o1',status:'new',items:b.items.map(i=>({...server.menu.find(m=>m.id===i.id),qty:i.qty})),total:b.items.reduce((s,i)=>s+server.menu.find(m=>m.id===i.id).price*i.qty,0),payment:b.payment,host_id:server.seat,message:'',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
     server.orders=[order];return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({order})});
    }
    return route.fulfill({contentType:'application/json',body:JSON.stringify(b.action==='capabilities'?{enabled:true,protocol:2,poll_bundle:1,registration_approval:1,desk:{online:true,valid_for_ms:30000}}:{bookings:[],hosts:[],account:null,commands:[],desk:{online:true,valid_for_ms:30000}})});
   }
   if(url.pathname.endsWith('/hosts'))return route.fulfill({contentType:'application/json',body:'{"hosts":[]}'});return route.abort();
  });
  await page.goto('https://club.test/');await page.waitForSelector('#splash',{state:'hidden'});
  // Desk has not sent a menu yet: the old "soon" card stays.
  const menu=server.menu;server.menu=[];await page.evaluate(()=>navTo('food'));const food=page.locator('#ov-food');
  await page.waitForFunction(()=>/Здесь появится меню/.test(document.querySelector('#ov-food').textContent));
  await page.evaluate(()=>{navTo('hall');foodScreen.state.menu=null});server.menu=menu;await page.evaluate(()=>navTo('food'));
  await page.waitForSelector('#ov-food .food-card');
  assert.deepEqual(await food.locator('.food-groups button').allTextContents(),['Напитки','Снеки']);
  assert.deepEqual(await food.locator('.food-card h3').allTextContents(),['Red Bull','Вода']);
  assert.equal(await food.locator('.food-card img').count(),1,'only data:image pictures are shown');
  assert.deepEqual(await food.locator('.market-tabs button').allTextContents(),['Еда','Аренда','Пакеты часов'],'market: food, rentals and hour packages on top');
  assert.deepEqual(await food.locator('.food-groups button').allTextContents(),['Напитки','Снеки'],'rentals are not a food group');
  await food.locator('.market-tabs button',{hasText:'Аренда'}).click();assert.deepEqual(await food.locator('.food-card h3').allTextContents(),['Аренда мышки Logitech G PRO X Superlight']);
  await food.locator('.food-card .food-add').click();assert.equal(await food.getByRole('button',{name:'Добавить'}).isDisabled(),true,'one of each rental item');
  if(process.env.SHOTS)await page.screenshot({path:process.env.SHOTS+'/rent.png'});
  await food.getByRole('button',{name:'Убрать'}).click();
  assert.doesNotMatch(await food.innerText(),/когда сидишь за ПК/i,'no hint text under the menu');
  assert.equal(await page.evaluate(()=>{const b=document.querySelector('#ov-food .ov-body');return b.scrollWidth<=b.clientWidth}),true,'the market never scrolls sideways');
  assert.equal((await page.locator('#nav-food').textContent()).trim(),'Маркет');
  assert.equal(await page.evaluate(()=>{const n=document.querySelector('.bottom-nav').getBoundingClientRect(),o=document.querySelector('#ov-food').getBoundingClientRect(),hit=document.elementFromPoint(n.left+n.width/2,n.top+n.height/2);return n.height>0&&Math.abs(o.bottom-n.top)<=1&&!!hit?.closest('.bottom-nav')}),true,'the bottom menu stays visible and the section ends right on top of it');
  await food.locator('.market-tabs button',{hasText:'Пакеты часов'}).click();
  assert.deepEqual(await food.locator('.pack-section').allTextContents(),['STANDART','VIP'],'packages split into STANDART and VIP');
  assert.deepEqual(await food.locator('.food-card h3').allTextContents(),['3 часа Standart','Пакет Ночь Standart','3 часа VIP']);
  const night=food.locator('.food-card',{hasText:'Пакет Ночь'});assert.equal(await night.locator('.pack-window').innerText(),'22:00–08:00');
  const h=new Date(Date.now()+3*3600000).getUTCHours();assert.equal(await night.locator('.food-add').isDisabled(),!(h>=22||h<8),'night package only sells 22–8 MSK');
  if(process.env.SHOTS)await page.screenshot({path:process.env.SHOTS+'/packs.png'});
  await food.locator('.market-tabs button',{hasText:'Еда'}).click();await page.waitForSelector('#ov-food .food-card');

  // Add to cart, five is the limit.
  await food.locator('.food-card').first().locator('.food-add').click();
  for(let i=0;i<6;i++){const plus=food.locator('.food-card').first().getByRole('button',{name:'Добавить'});if(await plus.isDisabled())break;await plus.click()}
  assert.equal(await food.locator('.food-card').first().locator('.food-qty b').innerText(),'5');
  await food.locator('.food-groups button',{hasText:'Снеки'}).click();await food.locator('.food-card .food-add').click();
  const bar=food.locator('.food-bar .btn-main');assert.equal(await bar.isDisabled(),true);
  server.seat='13';await page.evaluate(()=>foodScreen.start&&(foodScreen.stop(),foodScreen.start()));
  await page.waitForFunction(()=>document.querySelector('#ov-food .food-bar .btn-main')&&!document.querySelector('#ov-food .food-bar .btn-main').disabled);
  assert.match(await bar.innerText(),/1\s?065 ₽/);
  if(process.env.SHOTS)await page.screenshot({path:process.env.SHOTS+'/food-cart.png'});

  // Checkout: deposit only, no fine print; a refusal keeps the cart and makes a fresh attempt id.
  await bar.click();await page.waitForSelector('#ov-food .food-pay-one');
  const send=food.getByRole('button',{name:'Отправить на ресепшен'});assert.equal(await send.isDisabled(),false,'deposit is the only payment, nothing to pick');
  assert.equal(await food.locator('.food-pay button').count(),0);assert.match(await food.locator('.food-pay-one').innerText(),/депозит/i);
  assert.doesNotMatch(await food.innerText(),/не списывает|администратор/i,'no fine print under the cart');
  if(process.env.SHOTS)await page.screenshot({path:process.env.SHOTS+'/food-checkout.png'});
  server.fail='Прошлый заказ ещё у администратора. Дождитесь ответа';await send.click();
  await page.waitForFunction(()=>document.querySelector('#toasts .toast.err'));assert.match(await page.locator('#toasts').innerText(),/Прошлый заказ/);
  const first=calls.filter(c=>c.action==='food_order')[0];
  server.fail=null;await food.getByRole('button',{name:'Отправить на ресепшен'}).click();
  await page.waitForSelector('#ov-food .food-order');
  const orders=calls.filter(c=>c.action==='food_order');assert.equal(orders.length,2);assert.notEqual(orders[1].request_id,first.request_id);
  assert.deepEqual(orders[1].items,[{id:10,qty:5},{id:11,qty:1}]);assert.equal(orders[1].payment,'deposit');assert.equal(orders[1].price,undefined,'the client never sends prices');
  assert.match(await food.locator('.food-order').innerText(),/Отправлен/i);assert.equal(await food.locator('.food-bar').count(),0,'cart is empty after sending');

  // Accepted, then closed; a rejected call would also read "Закрыт", never "отменён".
  server.orders=[{...server.orders[0],status:'accepted',updated_at:new Date().toISOString()}];await page.evaluate(()=>{foodScreen.stop();foodScreen.start()});
  await page.waitForFunction(()=>/Принят, несём/.test(document.querySelector('#ov-food .food-order').textContent));
  server.orders=[{...server.orders[0],status:'closed',updated_at:new Date().toISOString()}];await page.evaluate(()=>{foodScreen.stop();foodScreen.start()});
  await page.waitForFunction(()=>/Закрыт/.test(document.querySelector('#ov-food .food-order-title').textContent));
  assert.doesNotMatch(await food.innerText(),/отмен/i);
  assert.equal(calls.filter(c=>c.action==='food_state'&&c.menu).length,2,'the menu with pictures loads only when missing (empty, then real)');
  await page.screenshot({path:process.env.SHOT||'/tmp/food.png'});
  assert.deepEqual(errors,[]);
  console.log('Food PASS: menu by groups, safe pictures, seat required, max 5, deposit only, refusal retried with a new id, statuses without "cancelled".');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
