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
  function resize(){
    width=innerWidth;height=innerHeight;
    const ratio=Math.min(devicePixelRatio||1,1.5);
    canvas.width=width*ratio;canvas.height=height*ratio;
    ctx.setTransform(ratio,0,0,ratio,0,0);
    columns=Array.from({length:Math.ceil(width/22)},()=>Math.random()*height/20);
  }
  function draw(time){
    if(document.hidden||reduced.matches){frame=0;return;}
    frame=requestAnimationFrame(draw);
    if(time-last<85)return;last=time;
    ctx.fillStyle='rgba(0,0,0,.13)';ctx.fillRect(0,0,width,height);
    ctx.font='14px monospace';
    columns.forEach((y,i)=>{
      const x=i*22;const edge=x<width*.18||x>width*.82;
      ctx.fillStyle=edge?'rgba(255,255,255,.9)':'rgba(255,255,255,.32)';
      const glyphs='⌁×+⟋⟍⋮⊞◇▱⊥⌜⌟≋';
      if (logoPath && i%5===0) {
        const slice=(i%9)*58;ctx.save();ctx.translate(x,y*20);ctx.scale(.16,.16);ctx.beginPath();ctx.rect(0,-11,59,140);ctx.clip();ctx.translate(-slice,-11);ctx.fill(logoPath);ctx.restore();
      } else ctx.fillText(glyphs[Math.floor(Math.random()*glyphs.length)],x,y*20);
      columns[i]=y*20>height&&Math.random()>.97 ? -Math.random()*20 : y+.45;
    });
  }
  function start(){if(!frame&&!document.hidden&&!reduced.matches)frame=requestAnimationFrame(draw);}
  reduced.addEventListener('change',()=>{if(reduced.matches){cancelAnimationFrame(frame);frame=0;ctx.clearRect(0,0,width,height);}else start();});
  document.addEventListener('visibilitychange',start);
  addEventListener('resize',resize);resize();start();
})();
