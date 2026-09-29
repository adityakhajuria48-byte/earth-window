'use strict';
window.EWStudio=(()=>{
  const $=id=>document.getElementById(id);
  function openPanel(name,open){
    $(name+'-panel').hidden=!open;$('toggle-'+name).setAttribute('aria-expanded',String(open));
    if(open)for(const other of ['search','layers','results'])if(other!==name&&(window.matchMedia('(max-width: 760px)').matches||(name!=='results'&&other!=='results'))){$(other+'-panel').hidden=true;$('toggle-'+other).setAttribute('aria-expanded','false');}
  }
  function init(){
    for(const name of ['search','layers','results']){
      $('toggle-'+name).onclick=()=>openPanel(name,$(name+'-panel').hidden);
      $('close-'+name).onclick=()=>openPanel(name,false);
    }
    $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('fullscreen').setAttribute('aria-label','Fullscreen is unavailable in this browser.');}};
    $('clear-overlay').onclick=()=>{EWGlobe.clearSurfaces();$('active-layer').hidden=true;$('overlay-status').textContent='Showing the reference map.';};
    if(window.matchMedia('(max-width: 760px)').matches)openPanel('search',false);
  }
  return {init,openPanel};
})();
