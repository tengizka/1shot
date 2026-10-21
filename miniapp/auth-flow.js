/* 2.1 · Step-by-step sign-in and sign-up: one field per screen, animated forward/back. */
(()=>{
 const $=id=>document.getElementById(id);
 const choice=$('auth-choice'),forgot=$('auth-forgot'),forms={login:$('form-login'),register:$('form-register')};
 const LABELS={login:['Дальше','Войти'],register:['Дальше','Отправить анкету']};
 let mode=null,idx=0;
 const steps=f=>[...f.querySelectorAll('.step')];
 const reduce=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

 /* +7 / 7 / +8 / 8 / no prefix → +7XXXXXXXXXX; nicknames stay as typed. */
 function normPhone(value){
  const t=String(value||'').trim();if(!/^[+\d ()-]{7,20}$/.test(t))return t;
  const d=t.replace(/\D/g,'');
  if(d.length===11&&/^[78]/.test(d))return '+7'+d.slice(1);
  if(d.length===10)return '+7'+d;
  return t;
 }
 window.normPhone=normPhone;

 function animateIn(el,dir){el.classList.remove('enter-l','enter-r');if(reduce())return;void el.offsetWidth;el.classList.add(dir<0?'enter-l':'enter-r')}
 function setButton(){const f=forms[mode],last=idx===steps(f).length-1,btn=f.querySelector('.wiz-actions .btn-main');if(!btn.disabled)btn.textContent=LABELS[mode][last?1:0]}
 function render(dir=1){
  const f=forms[mode],list=steps(f);
  list.forEach((s,i)=>{const on=i===idx;s.classList.toggle('current',on);s.hidden=!on;s.setAttribute('aria-hidden',String(!on))});
  const cur=list[idx];animateIn(cur,dir);
  const bar=f.querySelector('.wiz-progress');bar.innerHTML=list.map((_,i)=>`<i class="${i<idx?'done':i===idx?'now':''}"></i>`).join('');
  f.querySelector('.wiz-count').textContent=`${String(idx+1).padStart(2,'0')} / ${String(list.length).padStart(2,'0')}`;
  setButton();clearAuthErr();
  const input=cur.querySelector('input:not([type=hidden]):not([type=radio]),button#birthday-open');
  if(input&&!reduce())setTimeout(()=>input.focus({preventScroll:true}),dir?260:0);
  window.Telegram?.WebApp?.BackButton?.show?.();
 }
 function showChoice(){
  Object.values(forms).forEach(f=>{f.classList.remove('active');f.hidden=false});forgot.hidden=true;
  choice.hidden=false;animateIn(choice,-1);mode=null;clearAuthErr();window.Telegram?.WebApp?.BackButton?.hide?.();
 }
 function openForm(tab){
  mode=tab;idx=0;choice.hidden=true;forgot.hidden=true;
  Object.entries(forms).forEach(([k,f])=>f.classList.toggle('active',k===tab));
  animateIn(forms[tab],1);render(1);
 }
 window.switchAuthTab=(tab)=>openForm(tab==='register'?'register':'login');

 function fail(step,message){
  step.classList.remove('shake');void step.offsetWidth;step.classList.add('shake');
  showAuthErr(mode==='login'?'form-login':'form-register',message);
 }
 function validate(step){
  if(step.dataset.optional)return true;
  const text=step.querySelector('input:not([type=hidden]):not([type=radio])');
  if(text){
   text.value=text.id==='l-user'||text.id==='r-phone'?normPhone(text.value):text.value;
   const v=text.type==='password'?text.value:text.value.trim();
   if(!v.trim())return fail(step,'Заполни поле, чтобы продолжить'),false;
   if(text.minLength>0&&Array.from(v).length<text.minLength)return fail(step,`Минимум ${text.minLength} символов`),false;
   if(text.id==='r-user'&&!/^[\p{L}\p{N}_.-]{3,30}$/u.test(v))return fail(step,'Ник: от 3 до 30 букв, цифр, точек, дефисов или _'),false;
   if(text.id==='r-phone'&&!/^\+7\d{10}$/.test(v))return fail(step,'Проверь номер: 10 цифр после +7'),false;
  }
  if(step.querySelector('[name=sex]')&&!step.querySelector('[name=sex]:checked'))return fail(step,'Выбери пол'),false;
  if(step.querySelector('#r-birth')&&!$('r-birth').value)return fail(step,'Выбери дату рождения'),false;
  return true;
 }
 window.authNext=event=>{
  event.preventDefault();if(!mode)return;
  const f=forms[mode],list=steps(f),step=list[idx];
  if(!validate(step))return;
  if(idx<list.length-1){idx++;render(1);return}
  const promo=$('r-promo');if(promo)promo.value=promo.value.trim().toUpperCase();
  (mode==='login'?window.doLogin:window.doRegister)(event);
 };
 window.authBack=()=>{if(!mode)return;if(idx>0){idx--;render(-1)}else showChoice()};
 window.authForgot=()=>{forms.login.classList.remove('active');forgot.hidden=false;animateIn(forgot,1)};
 window.authForgotBack=()=>{forgot.hidden=true;mode='login';forms.login.classList.add('active');idx=Math.min(idx,1);render(-1)};
 window.Telegram?.WebApp?.BackButton?.onClick?.(()=>{if(!forgot.hidden)authForgotBack();else authBack()});

 /* Keep the step label on the button around the "waiting for the club" state. */
 window.setAuthLoading=(formId,loading)=>{
  const btn=$(formId==='form-login'?'btn-login':'btn-reg');btn.disabled=loading;
  if(loading)btn.innerHTML='<div class="spinner"></div>Проверяем…';else{btn.disabled=false;const was=mode;mode=formId==='form-login'?'login':'register';setButton();mode=was}
 };
 document.querySelectorAll('.auth-form').forEach(f=>{f.classList.remove('active')});
})();
