/* Sign-in, application and waiting screens: club photos fade one after another behind the form. */
(()=>{
 const auth=document.getElementById('auth');if(!auth)return;
 const wide=matchMedia('(min-aspect-ratio: 1/1)').matches;
 const photos=document.createElement('div');photos.className='auth-photos';photos.setAttribute('aria-hidden','true');
 for(const n of wide?[1,2]:[3,4,1,2]){const img=document.createElement('img');img.src='../landing/club-'+n+'.webp';img.alt='';img.decoding='async';photos.append(img)}
 photos.firstChild.classList.add('on');auth.prepend(photos);
 let shown=0;
 setInterval(()=>{if(document.hidden||!auth.classList.contains('active'))return;const all=photos.children;all[shown].classList.remove('on');shown=(shown+1)%all.length;all[shown].classList.add('on')},5000);
})();
