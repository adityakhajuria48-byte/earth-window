'use strict';
window.EWStudio=(()=>{
  const $=id=>document.getElementById(id),slots={a:null,b:null};
  const rasters=new Map();let controller,revision=0;
  const label=f=>{
    const period=EW.interval(f),date=t=>new Date(t).toISOString().slice(0,10);
    const satellite=f.properties?.platform?String(f.properties.platform).replace(/-/g,' '):`${EW.source(f).family||'Satellite'} · platform not reported`;
    return `${satellite} · ${period.composite?date(period.start)+' – '+date(period.end)+' composite':new Date(period.start).toISOString().replace('T',' ').replace('.000Z',' UTC')}`;
  };
  function options(f){const bands=EW.bands(f);return [...EW.presets(bands).filter(p=>p.bands.every(b=>b.isTiff)).map(p=>({id:p.id,label:p.label,bands:p.bands})),...bands.filter(b=>b.isTiff).map(b=>({id:b.id,label:b.label,bands:[b]}))];}
  function stop(){revision++;controller?.abort();$('render-globe').disabled=false;}
  function changed(){stop();EWGlobe.clearSurfaces();$('active-layer').hidden=true;$('overlay-status').textContent='Settings changed. Select Display on globe to update the imagery.';}
  function pin(f,slot){
    changed();slots[slot]=f;const o=options(f),select=$('capture-'+slot+'-band');
    select.replaceChildren(...o.map(p=>new Option(p.label,p.id)));select.disabled=!o.length;
    $('capture-'+slot+'-label').textContent=label(f);$('clear-'+slot).disabled=false;
    $('compare-type').value='captures';updateType();openPanel('layers',true);
    $('overlay-status').textContent=o.length?'Capture added. Choose its bands, then Display on globe.':'This capture has no supported raster bands. Source data remain available in its details.';
  }
  function updateType(){const captures=$('compare-type').value==='captures';$('capture-fields').hidden=!captures;$('overview-fields').hidden=captures;}
  function openPanel(name,open){
    const panel=$(name+'-panel'),button=$('toggle-'+name);panel.hidden=!open;button.setAttribute('aria-expanded',String(open));
    if(open)for(const other of ['search','layers','results'])if(other!==name&&(window.matchMedia('(max-width: 760px)').matches||(name!=='results'&&other!=='results'))){$(other+'-panel').hidden=true;$('toggle-'+other).setAttribute('aria-expanded','false');}
  }
  function captureInfo(slot){
    const f=slots[slot];if(!f)throw Error(`Add a capture to ${slot==='a'?'Before (A)':'After (B)'} from the image results.`);
    const mode=options(f).find(o=>o.id===$('capture-'+slot+'-band').value);if(!mode)throw Error('This capture does not expose a supported band selection.');
    return {f,mode};
  }
  async function getRasters(info,signal){
    const rows=[];
    for(const band of info.mode.bands){
      const key=band.href+'#'+band.index;
      if(!rasters.has(key)){if(rasters.size>=8)rasters.delete(rasters.keys().next().value);rasters.set(key,await EarthBands.readBand(band,signal));}
      rows.push(rasters.get(key));
    }return rows;
  }
  function chronological(a,b){return EW.interval(a).end<EW.interval(b).start;}
  async function display(){
    stop();EWGlobe.clearSurfaces();const token=revision;
    controller=new AbortController();const active=controller,signal=active.signal,timer=setTimeout(()=>active.abort(),120000);
    const compare=$('compare-enabled').checked;$('render-globe').disabled=true;
    $('overlay-status').textContent='Preparing georeferenced imagery…';
    try{
      let entries,labels;
      if($('compare-type').value==='overview'){
        const dates=[$('before-date').value,$('after-date').value],today=new Date().toISOString().slice(0,10);
        if(dates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||d<'2000-02-24'||d>today))throw Error('Choose valid overview dates between 24 February 2000 and today.');
        if(compare&&dates[0]>=dates[1])throw Error('The before date must be earlier than the after date.');
        entries=dates.slice(0,compare?2:1).map(date=>({kind:'overview',date}));labels=entries.map(e=>'Terra / MODIS · '+e.date);
      }else{
        const infos=[captureInfo('a')];if(compare)infos.push(captureInfo('b'));
        if(compare&&!chronological(infos[0].f,infos[1].f))throw Error('Choose an earlier capture for Before (A) and a later capture for After (B). Composite periods must not overlap.');
        const arrays=[];for(const info of infos)arrays.push(await getRasters(info,signal));
        const compatible=compare&&infos[0].mode.id===infos[1].mode.id&&EW.source(infos[0].f).family===EW.source(infos[1].f).family;
        const limits=compatible?EWSurface.sharedStretch(...arrays):null;
        entries=[];for(let i=0;i<infos.length;i++){const rendered=await EWSurface.project(arrays[i],limits,signal);entries.push({...rendered,credit:label(infos[i].f)+' · '+EW.source(infos[i].f).agency});}
        if(compare){const [a,b]=entries.map(e=>e.bounds);if(Math.max(a[0],b[0])>=Math.min(a[2],b[2])||Math.max(a[1],b[1])>=Math.min(a[3],b[3]))throw Error('These captures do not overlap. Choose two images covering the same area.');}
        labels=infos.map(info=>label(info.f)+' · '+info.mode.label);
        $('stretch-note').textContent=compatible?'Shared display limits across both dates. Clouds, sensor processing and registration can still differ.':'Each image uses a separate display stretch. Colour differences alone do not establish ground change.';
      }
      if(token!==revision)return;if(signal.aborted)throw Error('Image loading cancelled.');
      await EWGlobe.showSurfaces(entries,compare);
      if(token!==revision)return;if(signal.aborted)throw Error('Image loading cancelled.');
      $('before-label').textContent='A · '+labels[0];$('after-label').textContent='B · '+(labels[1]||'');
      $('active-layer-label').textContent=compare?'A / B comparison':'Capture A';
      $('active-layer-detail').textContent=labels.join(' / ');
      $('active-layer').hidden=false;
      $('overlay-status').textContent=$('compare-type').value==='overview'?'Dated NASA mosaics selected. Swipe to compare available tiles; gaps or clouds may occur.':'Source-band previews are on the globe. Swipe to compare; open original files for full-resolution analysis.';
      if($('compare-type').value==='overview')$('stretch-note').textContent='Daily mosaics combine observations. They are not exact-time captures; terrain remains the same reference DEM.';
      if(window.matchMedia('(max-width: 760px)').matches)openPanel('layers',false);
    }catch(e){if(token===revision)$('overlay-status').textContent=signal.aborted?'Image loading timed out. Try a single band or open the original source file.':e.message;}
    finally{clearTimeout(timer);if(token===revision)$('render-globe').disabled=false;}
  }
  function init(){
    for(const name of ['search','layers','results']){
      $('toggle-'+name).onclick=()=>openPanel(name,$(name+'-panel').hidden);
      $('close-'+name).onclick=()=>openPanel(name,false);
    }
    $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('fullscreen').title='Fullscreen is unavailable in this browser; the workspace already fills the page.';$('fullscreen').setAttribute('aria-label',$('fullscreen').title);}};
    const today=new Date().toISOString().slice(0,10),before=new Date(Date.now()-365*86400000).toISOString().slice(0,10),after=new Date(Date.now()-7*86400000).toISOString().slice(0,10);
    for(const id of ['before-date','after-date'])$(id).max=today;
    $('before-date').value=before;$('after-date').value=after;
    $('compare-type').onchange=()=>{updateType();changed();};
    for(const id of ['before-date','after-date','capture-a-band','capture-b-band','compare-enabled'])$(id).onchange=changed;
    $('swipe').oninput=e=>{EWGlobe.setSplit(e.target.value);$('swipe-value').textContent=e.target.value+'%';};
    $('render-globe').onclick=display;
    $('clear-overlay').onclick=()=>{stop();EWGlobe.clearSurfaces();$('active-layer').hidden=true;$('overlay-status').textContent='Showing the reference map.';};
    for(const slot of ['a','b'])$('clear-'+slot).onclick=()=>{changed();slots[slot]=null;$('capture-'+slot+'-label').textContent='No capture selected';$('capture-'+slot+'-band').replaceChildren();$('capture-'+slot+'-band').disabled=true;$('clear-'+slot).disabled=true;};
    if(window.matchMedia('(max-width: 760px)').matches)openPanel('search',false);
    updateType();
  }
  function onMode(active){if(!active){$('swipe-line').hidden=true;$('swipe-labels').hidden=true;if(!$('active-layer').hidden)$('overlay-status').textContent='Capture overlays are available in 3D. Return to 3D and select Display on globe.';$('active-layer').hidden=true;}}
  return {init,pin,onMode,chronological,openPanel};
})();
