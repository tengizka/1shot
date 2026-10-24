/* Phone links open the dialer the way «Открыть звонилку» always did in Telegram: as a new window (target=_blank).
   Links with their own onclick (the contact dialog) keep it. */
(()=>{
 document.addEventListener('click',e=>{
  const a=e.target.closest?.('a[href^="tel:"]');
  if(!a||a.hasAttribute('onclick'))return;
  a.target='_blank';a.rel='noopener';
 },true);
})();
