const {chromium}=require('playwright-core'),binary=require('@sparticuz/chromium').default,fs=require('fs'),assert=require('assert/strict');
// Outside Telegram (the Android app): sign in with nick and password, then requests carry the session key.
(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),calls=[],errors=[];let secret=null;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());
   if(url.host==='telegram.org')return route.fulfill({contentType:'text/javascript',body:'window.Telegram={WebApp:{initData:"",initDataUnsafe:{},ready(){},expand(){}}}'});
   if(url.host==='club.test'){const raw=url.pathname==='/'?'index.html':url.pathname.slice(1);const file=fs.existsSync('miniapp/'+raw)?'miniapp/'+raw:raw;
    if(fs.existsSync(file))return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html',body:fs.readFileSync(file)});return route.fulfill({status:404,body:''})}
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
   if(url.pathname.endsWith('/club-auth')){const b=route.request().postDataJSON();calls.push(b);
    if(b.action==='app_login'){secret=b.secret;return route.fulfill({contentType:'application/json',body:JSON.stringify({request_id:'r1'})})}
    if(b.action==='app_status')return route.fulfill({contentType:'application/json',body:JSON.stringify(b.secret===secret?{status:'done',profile:{telegram_id:-555,gizmo_user_id:7,username:'guest'}}:{status:'failed'})});
    return route.fulfill({contentType:'application/json',body:'{"ok":true}'})}
   if(url.pathname.endsWith('/club-bookings')){const b=route.request().postDataJSON();calls.push(b);let r={ok:true};
    if(b.action==='capabilities')r={desk:{online:true,valid_for_ms:30000},enabled:true,protocol:2};
    if(b.action==='list')r={bookings:[]};
    if(b.action==='account')r={account:{data:{username:'guest',balance:100,session:null},updated_at:new Date().toISOString()},commands:[]};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(r)})}
   if(url.pathname.endsWith('/hosts'))return route.fulfill({contentType:'application/json',body:'{"hosts":[]}'});return route.abort();
  });
  await page.goto('https://club.test/');await page.waitForSelector('#splash',{state:'hidden'});
  if(process.env.SHOTS)await page.screenshot({path:process.env.SHOTS+'/app-start.png'});
  assert.ok(await page.evaluate(()=>window.ONESHOT_APP),'app mode outside Telegram');
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await page.locator('#l-user').fill('guest');await page.locator('#btn-login').click();
  await page.waitForTimeout(500);await page.locator('#l-pass').fill('secret1');await page.locator('#btn-login').click();
  await page.waitForSelector('#app.active',{timeout:20000});
  const login=calls.find(b=>b.action==='app_login');assert.ok(login&&login.secret&&login.password==='secret1'&&!('initData' in login),'nick and password, no Telegram signature');
  await page.waitForFunction(()=>true);await page.waitForTimeout(1500);
  const later=calls.filter(b=>b.action==='list'||b.action==='account'||b.action==='capabilities');
  assert.ok(later.some(b=>b.appToken===secret),'requests carry the session key');
  assert.ok(later.every(b=>!('initData' in b)));
  assert.equal(await page.evaluate(()=>localStorage.getItem('1shot_app_token')),secret);
  assert.deepEqual(errors,[]);
  console.log('App mode PASS: sign-in with nick and password outside Telegram, session key on every request.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
