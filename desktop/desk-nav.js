/* Desk 4 menu: four sections instead of eight. Each section opens its pages as tabs on top of the page:
   Зал (Зал · Аренды), Гости (Найти гостя · Регистрация), Смена (ТБанк и статистика · Заметки), Настройки.
   The old section buttons stay in the DOM, hidden, and do the actual switching (their handlers load the data),
   so every page keeps working exactly as before. */
(()=>{
 const nav=document.querySelector('nav');if(!nav)return;
 const ICON={
  hall:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  guests:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  shift:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'
 };
 const GROUPS=[
  {id:'hall',label:'Зал',pages:[['hall','Зал'],['rentals','Аренды']]},
  {id:'guests',label:'Гости',pages:[['accounts','Найти гостя'],['registrations','Регистрация']]},
  {id:'shift',label:'Смена',pages:[['stats','ТБанк и статистика'],['notes','Заметки']]}
 ];
 const old=name=>nav.querySelector(`.tab[data-panel="${name}"]`);
 const groupOf=name=>GROUPS.find(g=>g.pages.some(([p])=>p===name));
 const last={};
 // Section buttons
 const logo=nav.querySelector('.brand-logo');let after=logo;
 for(const g of GROUPS){
  const b=document.createElement('button');b.type='button';b.className='tab group-tab';b.dataset.group=g.id;
  b.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[g.id]}</svg><span></span><b data-zero></b>`;
  b.querySelector('span').textContent=g.label;
  b.onclick=()=>old(last[g.id]||g.pages[0][0])?.click();
  after.after(b);after=b;
 }
 for(const g of GROUPS)for(const [p] of g.pages)old(p)?.classList.add('grouped-tab');
 const settings=old('sound');if(settings){settings.classList.add('settings-tab');nav.querySelector('.exit')?.before(settings)}
 // Tabs on top of each page of a section
 for(const g of GROUPS){
  if(g.pages.length<2)continue;
  for(const [p] of g.pages){
   const section=document.getElementById('panel-'+p);if(!section)continue;
   const bar=document.createElement('div');bar.className='subnav';bar.setAttribute('role','tablist');
   for(const [q,label] of g.pages){const t=document.createElement('button');t.type='button';t.textContent=label;t.dataset.page=q;t.setAttribute('role','tab');t.setAttribute('aria-selected',String(q===p));t.onclick=()=>old(q)?.click();bar.append(t)}
   section.prepend(bar);
  }
 }
 // Which section is lit follows whichever page is open
 function mark(){
  const view=document.body.dataset.view,g=groupOf(view);
  if(g)last[g.id]=view;
  nav.querySelectorAll('.group-tab').forEach(b=>b.classList.toggle('active',!!g&&b.dataset.group===g.id));
 }
 new MutationObserver(mark).observe(document.body,{attributes:true,attributeFilter:['data-view']});mark();
 // Counters (rentals out, password requests) move onto their section
 setInterval(()=>{for(const g of GROUPS){
  const n=g.pages.reduce((a,[p])=>a+(Number(old(p)?.querySelector('b')?.textContent)||0),0);
  const badge=nav.querySelector(`.group-tab[data-group="${g.id}"] b`);
  if(badge){badge.textContent=n?String(n):'';badge.toggleAttribute('data-zero',!n)}
 }},1000);
})();
