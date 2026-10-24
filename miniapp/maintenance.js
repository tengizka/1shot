/* Maintenance strip on top of every screen. To remove: set MESSAGE to '' (or drop this script). */
(()=>{
 const MESSAGE='Идут техработы · возможны перебои';
 if(!MESSAGE)return;
 const bar=document.createElement('div');bar.id='maintenance-bar';bar.setAttribute('role','status');
 bar.innerHTML='<span class="mt-dot" aria-hidden="true"></span><span></span>';bar.lastChild.textContent=MESSAGE;
 document.body.prepend(bar);document.body.classList.add('maintenance');
})();
