/* Personal data stays in the club: new accounts are created only at the reception (Desk → Gizmo).
   The app keeps sign-in; the online application form is never opened, and the account screen
   no longer shows or sends name, email, phone or birth date — those change at the reception. */
(()=>{
 const $=id=>document.getElementById(id);
 const box=$('auth-offline'),choice=$('auth-choice'),forgot=$('auth-forgot');
 const forms=[$('form-login'),$('form-register')];
 const re=/^[A-Za-z0-9_-]{2,32}$/;
 let code='GG';
 try{const p=window.Telegram?.WebApp?.initDataUnsafe?.start_param;if(p&&re.test(p))code=p.toUpperCase()}catch{}
 const word=$('offline-word');if(word){word.querySelector('b').textContent=code;word.hidden=false}
 window.showOfflineReg=()=>{forms.forEach(f=>f&&f.classList.remove('active'));if(forgot)forgot.hidden=true;choice.hidden=true;box.hidden=false;window.Telegram?.WebApp?.BackButton?.show?.()};
 window.hideOfflineReg=()=>{box.hidden=true;choice.hidden=false;window.Telegram?.WebApp?.BackButton?.hide?.()};
 const open=window.switchAuthTab;
 window.switchAuthTab=(tab,el)=>tab==='register'?window.showOfflineReg():open(tab,el);
 window.Telegram?.WebApp?.BackButton?.onClick?.(()=>{if(!box.hidden)window.hideOfflineReg()});
 /* Account screen: personal fields are shown nowhere and never submitted (disabled inputs are left out of the form data). */
 const PD=['firstName','lastName','email','mobilePhone'];
 function lock(){
  const form=$('edit-account');if(!form||form.dataset.pdLocked)return;
  form.dataset.pdLocked='1';
  for(const name of PD){const input=form.elements[name];if(input){input.disabled=true;input.value='';const label=input.closest('label');if(label)label.hidden=true}}
  const bday=$('account-birthday');if(bday){const label=bday.closest('label');if(label)label.hidden=true}
  const note=document.createElement('p');note.className='club-note';note.textContent='Имя, телефон и почту меняет администратор в клубе.';form.insertBefore(note,form.querySelector('button'));
 }
 lock();new MutationObserver(lock).observe(document.body,{childList:true,subtree:true});
})();
