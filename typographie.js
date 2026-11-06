/* Presentation only: marketing copy source and tracking/URL attributes remain untouched. */
(function(){
 'use strict';
 const thin='\u202f';
 function format(value){
  return value.replace(/[ \u00a0\u202f]*([:;?!])/g,thin+'$1')
   .replace(/«[ \u00a0\u202f]*/g,'«'+thin)
   .replace(/[ \u00a0\u202f]*»/g,thin+'»');
 }
 const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
 while((node=walk.nextNode())){
  if(!node.parentElement||node.parentElement.closest('script,style,noscript,code,pre'))continue;
  node.textContent=format(node.textContent);
 }
 for(const el of document.querySelectorAll('[alt],[aria-label],[title]')){
  for(const attr of ['alt','aria-label','title'])if(el.hasAttribute(attr))el.setAttribute(attr,format(el.getAttribute(attr)));
 }
 document.documentElement.dataset.typographie='fr-FR';
})();
