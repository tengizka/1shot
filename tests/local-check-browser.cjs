const {chromium}=require('playwright-core'),binary=require('@sparticuz/chromium').default,fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args,headless:true});
 try{
  const page=await browser.newPage(),calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>window.Telegram={WebApp:{initData:'synthetic-signed-data',ready(){}}});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='tengizka.github.io'){
    const file=url.pathname.replace(/^\/1shot\//,'');if(fs.existsSync(file))return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(file)});
   }
   if(url.hostname==='api.tengizka.fun'){
    const req=route.request();if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'https://tengizka.github.io','Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'GET,POST'}});
    const b=req.postDataJSON();calls.push({path:url.pathname,b});let status=200,data;
    if(url.pathname==='/healthz')data={ok:true,backend:'local'};
    else if(url.pathname==='/api/hosts')data={hosts:[]};
    else if(url.pathname==='/api/club-agent'){status=404;data={error:'not_found'}}
    else if(b.action==='capabilities')data={enabled:false,protocol:2};
    else if(b.action==='list'){status=b.initData?200:403;data=b.initData?{bookings:[]}:{error:'unauthorized'}}
    else throw Error('Unexpected action');
    return route.fulfill({status,headers:{'Access-Control-Allow-Origin':'https://tengizka.github.io'},contentType:'application/json',body:JSON.stringify(data)});
   }
   return route.abort();
  });
  await page.goto('https://tengizka.github.io/1shot/local-check.html');assert.equal(calls.length,0);
  await page.locator('#once').click();await page.waitForSelector('#protection.ok');assert.match(await page.locator('#database').innerText(),/Записей ПК: 0/);
  await page.locator('#auth').click();await page.waitForSelector('#telegram.ok');
  assert.equal(calls.filter(x=>x.b?.initData==='synthetic-signed-data').length,1);
  assert.ok(!await page.locator('body').innerText().then(x=>x.includes('synthetic-signed-data')));
  assert.ok(calls.every(x=>x.path==='/healthz'||x.path==='/api/hosts'||x.path==='/api/club-agent'||['list','capabilities'].includes(x.b?.action)));
  await page.locator('#monitor').click();await page.waitForTimeout(600);await page.locator('#stop').click();const count=calls.length;await page.waitForTimeout(5200);assert.equal(calls.length,count);
  assert.deepEqual(errors,[]);console.log('GitHub-to-local test page: explicit requests, empty database, auth, no mutations, stop polling PASS');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
