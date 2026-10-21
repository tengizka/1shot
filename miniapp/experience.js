// No external assets, trackers, or network requests.
function openClubContact(event) {
  event?.preventDefault();
  document.getElementById('contact-result').textContent='';
  const dialog=document.getElementById('club-contact');
  if (!dialog.open) dialog.showModal();
}
function closeClubContact(){document.getElementById('club-contact').close();}
async function copyClubPhone() {
  const number='+74955837811';
  let copied=false;
  try { await navigator.clipboard.writeText(number);copied=true; } catch {
    const input=document.createElement('textarea');input.value=number;
    input.style.cssText='position:fixed;opacity:0;';document.getElementById('club-contact').append(input);
    input.select();try{copied=document.execCommand('copy');}catch{}input.remove();
  }
  document.getElementById('contact-result').textContent=copied?'Номер скопирован':'Не удалось скопировать. Номер для набора: +7 (495) 583-78-11';
}
(() => {
  const canvas=document.getElementById('matrix-rain');
  const ctx=canvas.getContext('2d');if(!ctx)return;
  const logoSource=document.querySelector('.header-logo path')?.getAttribute('d');
  const logoPath=logoSource ? new Path2D(logoSource) : null;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let columns=[],frame=0,last=0,width=0,height=0;
  const glyphs='⌁×+⟋⟍⋮⊞◇▱⊥⌜⌟≋';
  const pick=()=>glyphs[Math.floor(Math.random()*glyphs.length)];
  // Each column falls at its own speed; the bright head leaves a grey trail, a few heads are lime.
  const column=(fresh)=>({y:fresh?Math.random()*height/20:-Math.random()*24,speed:.35+Math.random()*.55,lime:Math.random()<.12,prev:pick()});
  function resize(){
    width=innerWidth;height=innerHeight;
    const ratio=Math.min(devicePixelRatio||1,1.5);
    canvas.width=width*ratio;canvas.height=height*ratio;
    ctx.setTransform(ratio,0,0,ratio,0,0);
    columns=Array.from({length:Math.ceil(width/22)},()=>column(true));
  }
  function draw(time){
    if(document.hidden||reduced.matches){frame=0;return;}
    frame=requestAnimationFrame(draw);
    if(time-last<55)return;last=time;
    ctx.fillStyle='rgba(0,0,0,.085)';ctx.fillRect(0,0,width,height);
    ctx.font='14px monospace';
    columns.forEach((c,i)=>{
      const x=i*22,y=Math.floor(c.y)*20,edge=x<width*.18||x>width*.82;
      if (logoPath && i%5===0) {
        const slice=(i%9)*58;ctx.save();ctx.fillStyle=edge?'rgba(255,255,255,.85)':'rgba(255,255,255,.3)';ctx.translate(x,y);ctx.scale(.16,.16);ctx.beginPath();ctx.rect(0,-11,59,140);ctx.clip();ctx.translate(-slice,-11);ctx.fill(logoPath);ctx.restore();
      } else if (Math.floor(c.y)!==Math.floor(c.y-c.speed)) {
        ctx.fillStyle=edge?'rgba(150,150,150,.75)':'rgba(120,120,120,.4)';ctx.fillText(c.prev,x,y-20);
        c.prev=pick();
        ctx.fillStyle=c.lime?(edge?'rgba(163,255,16,.95)':'rgba(163,255,16,.6)'):(edge?'rgba(255,255,255,.95)':'rgba(255,255,255,.5)');
        ctx.fillText(c.prev,x,y);
      }
      c.y+=c.speed;
      if(c.y*20>height&&Math.random()>.96)columns[i]=column(false);
    });
  }
  function start(){if(!frame&&!document.hidden&&!reduced.matches)frame=requestAnimationFrame(draw);}
  reduced.addEventListener('change',()=>{if(reduced.matches){cancelAnimationFrame(frame);frame=0;ctx.clearRect(0,0,width,height);}else start();});
  document.addEventListener('visibilitychange',start);
  addEventListener('resize',resize);resize();start();
})();
