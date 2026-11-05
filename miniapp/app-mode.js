/* 1SHOT outside Telegram (the Android app, later the web version).
   Telegram signs every request; here the guest signs in once with the club nick and password and the app keeps
   a random session key instead. The rest of the mini-app runs unchanged: it sees a small stand-in for
   Telegram.WebApp, and requests to our server carry the session key in place of Telegram's signature. */
(()=>{
 if(window.Telegram?.WebApp?.initData)return;  // inside Telegram: nothing to do
 window.ONESHOT_APP=true;
 const KEY='1shot_app_token',PENDING='1shot_app_pending',PROFILE='1shot_v2_profile';
 const read=k=>{try{return localStorage.getItem(k)}catch{return null}};
 const write=(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch{}};
 const key=()=>{const a=new Uint8Array(32);crypto.getRandomValues(a);return btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
 const profile=()=>{try{return JSON.parse(read(PROFILE)||'null')}catch{return null}};
 const noop=()=>{};
 const web={
  get initData(){return read(KEY)?'app':''},
  get initDataUnsafe(){const p=profile();return read(KEY)&&p?{user:{id:p.telegram_id}}:{}},
  platform:'app',version:'7.0',colorScheme:'dark',
  ready:noop,expand:noop,close:noop,enableClosingConfirmation:noop,disableVerticalSwipes:noop,
  setHeaderColor:noop,setBackgroundColor:noop,onEvent:noop,offEvent:noop,isVersionAtLeast:()=>false,
  HapticFeedback:{impactOccurred:noop,notificationOccurred:noop,selectionChanged:noop},
  BackButton:{show:noop,hide:noop,onClick:noop,offClick:noop},
  MainButton:{show:noop,hide:noop,setText:noop,onClick:noop,offClick:noop},
  openLink:u=>window.open(u,'_blank'),openTelegramLink:u=>window.open(u,'_blank'),
  showAlert:(m,cb)=>{alert(m);cb&&cb()},showConfirm:(m,cb)=>cb&&cb(confirm(m)),
 };
 window.Telegram={WebApp:web};
 // Sign-in and every later request: the session key replaces Telegram's signature.
 const send=window.fetch.bind(window);
 window.fetch=(url,options={})=>{
  const address=String(url);
  if(!/\/functions\/v1\/club-/.test(address)||typeof options?.body!=='string')return send(url,options);
  let body;try{body=JSON.parse(options.body)}catch{return send(url,options)}
  const auth=/club-auth/.test(address);
  if(auth&&body.action==='login'){const secret=key();write(PENDING,secret);body.action='app_login';body.secret=secret}
  else if(auth&&body.action==='status'){body.action='app_status';body.secret=read(PENDING)}
  else if(read(KEY))body.appToken=read(KEY);
  delete body.initData;
  const request=send(url,{...options,body:JSON.stringify(body)});
  return request.then(async response=>{
   if(body.action==='app_status'){try{const data=await response.clone().json();if(data.status==='done'){write(KEY,read(PENDING));write(PENDING,null)}}catch{}}
   // The key expired or was signed out elsewhere: back to the sign-in screen.
   else if(response.status===403&&body.appToken){write(KEY,null);write(PROFILE,null);setTimeout(()=>location.reload(),300)}
   return response;
  });
 };
 // Signing out also ends the session on the server.
 addEventListener('DOMContentLoaded',()=>{
  const out=window.doLogout;if(typeof out!=='function')return;
  window.doLogout=(...args)=>{
   const token=read(KEY);write(KEY,null);
   if(token)send((window.CLUB_API_BASE||'')+'/club-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'app_logout',appToken:token})}).catch(noop);
   return out(...args);
  };
 });
})();
