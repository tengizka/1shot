/* iOS keyboard: «Done» instead of «return»; it only closes the keyboard, it never submits a form. */
(()=>{
 const mark=root=>root.querySelectorAll?.('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([enterkeyhint])').forEach(i=>i.setAttribute('enterkeyhint','done'));
 mark(document);new MutationObserver(list=>list.forEach(m=>m.addedNodes.forEach(n=>n.nodeType===1&&(n.matches?.('input')?mark(n.parentNode||document):mark(n))))).observe(document.documentElement,{childList:true,subtree:true});
 document.addEventListener('keydown',e=>{
  if(e.key!=='Enter'||e.isComposing)return;const t=e.target;
  if(!(t instanceof HTMLInputElement)||t.getAttribute('enterkeyhint')!=='done')return;
  e.preventDefault();t.blur();
 },true);
})();
/* The bottom menu's real height (it differs between phones): sections end exactly on top of it. */
(()=>{
 const nav=document.querySelector('.bottom-nav');if(!nav)return;
 const set=()=>{const h=nav.offsetHeight;if(h)document.documentElement.style.setProperty('--nav-h',h+'px')};
 set();if(window.ResizeObserver)new ResizeObserver(set).observe(nav);addEventListener('resize',set);
})();
