/* UI-only result lifetime. Never acknowledges a request on the server. */
(() => {
 class ProfileFeedback {
  constructor(node,owner){
   this.node=node;this.owner=owner;this.key='';this.seenMemory=[];this.root=node.closest('.ov-body');
   new MutationObserver(()=>this.schedule()).observe(document.getElementById('ov-profile'),{attributes:true,attributeFilter:['class']});
   document.addEventListener('visibilitychange',()=>this.schedule());this.root.addEventListener('scroll',()=>this.schedule(),{passive:true});
   this.observer=new IntersectionObserver(()=>this.schedule(),{root:this.root,threshold:[0,.5,1]});this.observer.observe(node);
  }
  storageKey(){return '1shot_profile_seen:'+this.owner()}
  seen(){let stored=[];try{const v=JSON.parse(localStorage.getItem(this.storageKey())||'[]');if(Array.isArray(v))stored=v.filter(k=>typeof k==='string')}catch{}return [...new Set([...stored,...this.seenMemory])].slice(-80)}
  visible(){const r=this.node.getBoundingClientRect(),v=this.root.getBoundingClientRect();return !document.hidden&&document.getElementById('ov-profile').classList.contains('open')&&r.height>0&&Math.min(r.bottom,v.bottom,innerHeight)-Math.max(r.top,v.top,0)>=Math.min(r.height/2,24)}
  cancel(){clearTimeout(this.timer);clearTimeout(this.fade);this.timer=this.fade=null;this.node.classList.remove('result-leaving')}
  show(command,text){
   const key=command?.id?this.owner()+':'+command.id+':'+command.status:'local:'+text;
   if(key!==this.key){this.cancel();this.key=key;this.terminal=!!command?.id&&['done','rejected','cancelled'].includes(command.status);this.dismissed=this.terminal&&this.seen().includes(key)}
   this.node.dataset.status=command?.status||'';const value=this.dismissed?'':text||'';if(this.node.textContent!==value)this.node.textContent=value;this.schedule();
  }
  schedule(){
   if(!this.visible()){this.cancel();return}
   if(!this.terminal||this.dismissed||!this.node.textContent||this.timer||this.fade)return;
   this.timer=setTimeout(()=>{this.timer=null;this.node.classList.add('result-leaving');this.fade=setTimeout(()=>{
    this.fade=null;this.dismissed=true;this.node.textContent='';this.node.classList.remove('result-leaving');this.seenMemory=[...this.seen().filter(k=>k!==this.key),this.key].slice(-80);
    try{localStorage.setItem(this.storageKey(),JSON.stringify(this.seenMemory))}catch{}
   },matchMedia('(prefers-reduced-motion: reduce)').matches?0:240)},6000);
  }
 }
 window.ProfileFeedback=ProfileFeedback;
})();
