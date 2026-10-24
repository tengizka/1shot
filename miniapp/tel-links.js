/* Telegram's in-app browser ignores tel: links. Open a tiny page in the phone's own browser instead,
   which hands the number to the dialer. Links with their own onclick (the contact dialog) keep it. */
(()=>{
 const page=new URL('../call.html',location.href).href;
 document.addEventListener('click',e=>{
  const a=e.target.closest?.('a[href^="tel:"]');const tg=window.Telegram?.WebApp;
  if(!a||a.hasAttribute('onclick')||!tg?.openLink||!tg.initData)return;
  e.preventDefault();tg.openLink(page);
 },true);
})();
