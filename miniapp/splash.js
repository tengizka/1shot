/* 1SHOT start screen: ten different splashes, a different one on every launch (never the same twice in a row).
   The mascot never covers the logo: it sits above it, below it, or takes its turn before it.
   ?splash=3 in the address shows one on purpose. Styles: splash.css. */
(()=>{
 const LOGO='M478.042 17.5467V52.4814H440.879V61.4825H478.042V127.032H487.105V61.4825H521.737V52.478H487.105V17.5502L478.042 17.5467ZM97.1209 52.4814H50.0112V61.4825H125.311V77.1869L103.824 108.092V72.4431H94.7577V136.975L134.371 79.9952V52.4814H108.213L125.307 28.397V41.7347H134.371V0.00345001L97.1209 52.478V52.4814ZM263.77 52.4814H230.108V17.5502H221.045V52.4814H156.306V61.4825H221.045V127.032H230.108V61.4825H263.77V127.032H272.829V17.5536H263.773V52.4849L263.77 52.4814ZM346.594 0L346.58 52.4814H296.165V61.4859H346.58L346.573 79.3259L386.283 137.11V61.4859H410.954V52.4814H383.823L346.594 0ZM355.64 76.5486L355.65 28.397L372.735 52.4814H365.814V61.4859H377.22V107.957L355.64 76.5486ZM14.3692 17.5502V52.4814H0V61.4859H14.3692V118.031H0V127.036H37.7982V118.031H23.4324V17.5536H14.3692V17.5502Z';
 const MASCOT='<svg class="sp-mascot" viewBox="-1 -1 47 45" aria-hidden="true"><g class="olm-ears"><polygon points="4.62219,10.7343 4.0874,16.197 9.32084,8.74788 9.32084,12.7971 12.0713,12.7971 12.0713,0 4.62219,10.7343"/><polygon points="0,17.4576 0,22.309 2.75043,22.309 2.82684,18.9474 6.26485,18.9474 6.26485,16.2352 4.08744,16.197 4.62223,10.7344 0,17.4576"/><polygon points="33.6545,16.197 37.0162,16.197 42.2497,8.74788 42.2497,12.8353 45,12.8353 45,0 33.6545,16.197"/></g><g class="olm-face"><polygon points="2.75043,33.3106 2.75043,22.309 0,22.309 0,42.1732 12.0713,24.6393 12.0713,12.7971 9.32088,12.7971 9.32088,23.7988 2.75043,33.3106"/><polygon points="35.6793,33.3107 35.6793,22.309 32.929,22.309 32.929,42.1733 44.962,24.6393 44.962,16.197 38.7353,16.197 38.7353,18.9474 42.2498,18.9474 42.2498,23.7988 35.6793,33.3107"/><polygon points="26.7404,28.3445 26.7404,18.1833 24.1045,18.1833 24.1045,28.3445 26.7404,28.3445"/><polygon points="24.1044,25.6707 20.0552,25.6707 20.0552,28.3446 24.1044,28.3446 24.1044,25.6707"/></g><g class="olm-eyes"><g class="olm-eye-l"><polygon points="23.3114,15 18.3187,15 17.4082,15 16,15 16,17.7122 20.6374,17.7122 23.3114,17.7122 23.3114,15"/></g><g class="olm-eye-r"><polygon points="35.3114,15 30.3187,15 29.4082,15 28,15 28,17.7122 32.6374,17.7122 35.3114,17.7122 35.3114,15"/></g></g><g class="olm-mouth"><polygon points="25.4032,32.9495 20.4105,32.9495 19.5,32.9495 18.0918,32.9495 18.0918,35.6616 22.7292,35.6616 25.4032,35.6616 25.4032,32.9495"/></g></svg>';
 const EDGES=[0,45,145,283,425,522];  // where each of the five letters starts and ends
 const NAMES=['drop','scan','swap','glitch','type','zoom','slots','pixels','outline','neon'];
 let uid=0;
 const whole=cls=>`<svg class="sp-logo ${cls||''}" viewBox="0 0 522 138" aria-hidden="true"><path pathLength="1" d="${LOGO}"/></svg>`;
 // The logo as five separately animated letters.
 const letters=inner=>{const id='spc'+(++uid);return `<svg class="sp-logo" viewBox="0 0 522 138" aria-hidden="true">`+[0,1,2,3,4].map(i=>
  `<clipPath id="${id}${i}"><rect x="${EDGES[i]}" y="-6" width="${EDGES[i+1]-EDGES[i]}" height="150"/></clipPath><g clip-path="url(#${id}${i})"><g class="sl" style="--i:${i}">${inner||`<path d="${LOGO}"/>`}</g></g>`).join('')+'</svg>'};
 const BUILD={
  drop:()=>MASCOT+letters(),
  scan:()=>'<i class="sp-beam"></i>'+whole()+MASCOT,
  swap:()=>MASCOT+letters(),
  glitch:()=>`<div class="sp-stack">${whole('g0')}${whole('g1')}${whole('g2')}</div>`+MASCOT,
  type:()=>`<div class="sp-stack">${letters()}<i class="sp-cursor"></i></div>`+MASCOT,
  zoom:()=>letters()+'<i class="sp-line"></i>',
  slots:()=>letters(`<path d="${LOGO}"/><path d="${LOGO}" transform="translate(0 -170)"/><path d="${LOGO}" transform="translate(0 -340)"/>`)+MASCOT,
  pixels:()=>{let cells='';for(let i=0;i<84;i++)cells+=`<i style="animation-delay:${(.15+Math.random()*1.25).toFixed(2)}s"></i>`;return `<div class="sp-stack">${whole()}<div class="sp-cells">${cells}</div></div>`+MASCOT},
  outline:()=>whole(),
  neon:()=>MASCOT+whole(),
 };
 function pick(){
  const asked=Number(new URLSearchParams(location.search).get('splash'));
  if(asked>=1&&asked<=NAMES.length)return asked-1;
  let last=-1;try{last=Number(localStorage.getItem('1shot_splash_last')??-1)}catch{}
  let n;do{n=Math.floor(Math.random()*NAMES.length)}while(n===last);
  try{localStorage.setItem('1shot_splash_last',String(n))}catch{}
  return n;
 }
 window.oneshotSplash={names:NAMES,play(screen,slot){
  const name=NAMES[pick()];
  slot.innerHTML=`<div class="sp sp-${name}">${BUILD[name]()}</div>`;
  screen.dataset.splash=name;
  if(name==='type'){  // the block cursor steps from letter to letter, then blinks at the end
   const cursor=slot.querySelector('.sp-cursor'),at=i=>({left:(EDGES[i]/522*100)+'%'});
   cursor.animate([at(0),at(1),at(2),at(3),at(4),at(5)],{duration:1500,delay:250,easing:'steps(6,jump-none)',fill:'both'});
  }
  return name;
 }};
})();
