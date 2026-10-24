const {chromium}=require('playwright-core'),binary=require('@sparticuz/chromium').default,fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('native dialog: '+d.message());d.accept()});
  await page.addInitScript(()=>{
   window.calls=[];window.reply={ok:true,status:'done',gizmo_user_id:77,username:'neo',promo:{code:'HEADSHOT',result:'granted'}};
   const old=new Date(Date.now()-5*86400000).toISOString(),fresh=new Date().toISOString(),exp=d=>new Date(Date.parse(d)+30*86400000).toISOString();
   const registrations=[
    {id:'a',status:'awaiting_admin',created_at:old,expires_at:exp(old),public_data:{username:'oldguest',first_name:'Олег',last_name:'Старый',mobile_phone:'+79990000001'}},
    {id:'b',status:'awaiting_admin',created_at:fresh,expires_at:exp(fresh),public_data:{username:'newguest',first_name:'Анна',last_name:'Новая',mobile_phone:'+79995556677',promo_code:'HEADSHOT'}}];
   window.pywebview={api:{snapshot:async()=>({online:true,protocol_ready:true,registration_ready:true,registrations,last_sync:Date.now()/1000,hosts:[],rows:[],password_requests:[],alerts:0,rentals:[],rental_items:{}}),
    promo_codes:async()=>({codes:[{code:'HEADSHOT',channel:'ВКонтакте'},{code:'GG',channel:'Сайт без рекламы'}]}),
    register_guest:async(...a)=>{calls.push(a);return reply}}};
   document.addEventListener('DOMContentLoaded',()=>dispatchEvent(new Event('pywebviewready')));
  });
  await page.route('**/*',r=>{const url=new URL(r.request().url());const file='desktop/'+(url.pathname==='/'?'index.html':url.pathname.slice(1));if(url.host==='desk.test'&&fs.existsSync(file))return r.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html',body:fs.readFileSync(file)});return r.abort()});
  await page.goto('https://desk.test');await page.waitForSelector('#desk-splash',{state:'detached'});await page.locator('[data-panel="registrations"]').click();

  // Newest application first, dated, searchable by phone digits written the Russian way.
  const titles=()=>page.locator('.registration-list .card h3').allTextContents();
  await page.waitForFunction(()=>document.querySelectorAll('.registration-list .card').length===2);
  assert.deepEqual(await titles(),['newguest','oldguest']);
  assert.match(await page.locator('.registration-list .card .registration-when').first().innerText(),/Подана .* · ждёт ещё 30 дн\./);
  await page.locator('#registration-search').fill('8 999 555');assert.deepEqual(await titles(),['newguest']);
  await page.locator('#registration-search').fill('олег');assert.deepEqual(await titles(),['oldguest']);
  await page.locator('#registration-search').fill('');await page.selectOption('#registration-sort','old');assert.deepEqual(await titles(),['oldguest','newguest']);

  assert.equal(await page.locator('#desk-reg [name=username]').count(),0,'no nickname field');
  // Reception registration: everything filled, sex and promo picked by buttons, identity confirmed.
  await page.locator('#desk-reg-open').click();const submit=page.locator('#desk-reg-submit');
  await page.waitForSelector('#desk-reg [data-group="code"] button');assert.equal(await submit.isDisabled(),true);
  for(const [n,v] of [['password','x'],['first_name','Нео'],['last_name','Андерсон'],['mobile_phone','8 999 123 45 67']])await page.locator(`#desk-reg [name=${n}]`).fill(v);
  await page.locator('#desk-reg [name=birth_date]').fill('2000-01-01');
  await page.locator('#desk-reg [data-group="sex"] button[data-value="1"]').click();
  await page.locator('#desk-reg [name=checked]').check();assert.equal(await submit.isDisabled(),true,'promo choice is required, even "without"');
  await page.locator('#desk-reg [data-group="code"] button[data-value="HEADSHOT"]').click();assert.equal(await submit.isDisabled(),false);
  await submit.click();await page.waitForFunction(()=>calls.length===1);
  const [id,data,code,confirmed]=await page.evaluate(()=>calls[0]);
  assert.match(id,/^[0-9a-f-]{36}$/);assert.equal(code,'HEADSHOT');assert.equal(confirmed,true);
  assert.deepEqual(data,{password:'x',first_name:'Нео',last_name:'Андерсон',mobile_phone:'8 999 123 45 67',birth_date:'2000-01-01',sex:1});
  assert.match(await page.locator('#desk-reg-message').innerText(),/Ник для входа: neo · ID 77\. Час STANDART начислен \(HEADSHOT\)/);
  assert.equal(await page.locator('#desk-reg [name=password]').inputValue(),'');

  // A duplicate keeps the form and starts a fresh attempt id; "without promo" sends no code.
  await page.evaluate(()=>{reply={ok:false,status:'rejected'}});
  for(const [n,v] of [['password','y'],['first_name','Нео'],['last_name','Андерсон'],['mobile_phone','+79991234567']])await page.locator(`#desk-reg [name=${n}]`).fill(v);
  await page.locator('#desk-reg [name=birth_date]').fill('2000-01-01');await page.locator('#desk-reg [data-group="sex"] button[data-value="1"]').click();
  await page.locator('#desk-reg [data-group="code"] button[data-value=""]').click();await page.locator('#desk-reg [name=checked]').check();await submit.click();
  await page.waitForFunction(()=>calls.length===2);assert.equal(await page.evaluate(()=>calls[1][2]),null);
  assert.match(await page.locator('#desk-reg-message').innerText(),/уже есть в Gizmo/);
  await submit.click();await page.waitForFunction(()=>calls.length===3);assert.notEqual(await page.evaluate(()=>calls[2][0]),await page.evaluate(()=>calls[1][0]));
  await page.screenshot({path:process.env.SHOT||'/tmp/desk-registration.png'});
  assert.deepEqual(errors,[]);
  console.log('Desk registration PASS: newest first, dated, phone/name search and sort; reception form needs every field, sex and promo by buttons, identity check; duplicate starts a new attempt.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
