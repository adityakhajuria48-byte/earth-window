'use strict';
window.EarthBands = (() => {
  let libraryPromise;
  const el=(tag,value,cls)=>{const x=document.createElement(tag);x.textContent=value;if(cls)x.className=cls;return x;};
  async function assetURL(href,signal){
    const clean=EW.https(href);if(!clean)throw Error('This asset does not provide an HTTPS download.');
    const u=new URL(clean);
    if(!u.hostname.endsWith('.blob.core.windows.net'))return clean;
    const r=await fetch('https://planetarycomputer.microsoft.com/api/sas/v1/sign?'+new URLSearchParams({href:clean}),{signal});
    if(!r.ok)throw Error('The data provider could not authorize this asset. Try its source metadata link.');
    const d=await r.json(),signed=EW.https(d.href);
    if(!signed||new URL(signed).origin!==u.origin||new URL(signed).pathname!==u.pathname)throw Error('Unexpected asset authorization response.');
    return signed;
  }
  function library(){
    if(window.GeoTIFF)return Promise.resolve(window.GeoTIFF);
    if(!libraryPromise)libraryPromise=new Promise((resolve,reject)=>{const s=document.createElement('script');const timer=setTimeout(()=>{s.remove();libraryPromise=null;reject(Error('Raster viewer timed out. You can still open the band files.'));},15000);s.src='https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js';s.onload=()=>{clearTimeout(timer);window.GeoTIFF?resolve(window.GeoTIFF):reject(Error('Raster viewer did not initialize.'));};s.onerror=()=>{clearTimeout(timer);libraryPromise=null;reject(Error('Raster viewer could not load. You can still open the band files.'));};document.head.append(s);});
    return libraryPromise;
  }
  async function readBand(b,signal){
    if(b.requiresAuth)throw Error('Sign in with the data provider to download this product.');
    const GeoTIFF=await library();if(signal.aborted)throw Error('Preview cancelled.');
    const url=await assetURL(b.href,signal);
    const tiff=await GeoTIFF.fromUrl(url,{allowFullFile:false},signal);
    try{
      const first=await tiff.getImage();const count=await tiff.getImageCount();let chosen=first;
      for(let i=1;i<Math.min(count,16);i++){const candidate=await tiff.getImage(i);if(candidate.getWidth()<chosen.getWidth()&&Math.max(candidate.getWidth(),candidate.getHeight())>=512)chosen=candidate;}
      if(chosen.getWidth()*chosen.getHeight()>4000000)throw Error('This band has no small overview. Open the original data file in QGIS.');
      const ratio=chosen.getWidth()/chosen.getHeight(),width=ratio>=1?512:Math.max(1,Math.round(512*ratio)),height=ratio>=1?Math.max(1,Math.round(512/ratio)):512;
      const data=await chosen.readRasters({samples:[b.index],width,height,interleave:true,resampleMethod:'nearest',signal});
      const nodata=b.nodata??chosen.getGDALNoData();
      const valid=v=>Number.isFinite(v)&&(nodata===null||nodata===undefined||v!==Number(nodata));
      const sample=Array.from(data).filter(valid).sort((a,b)=>a-b);
      if(!sample.length)throw Error('This band contains no valid pixels in the preview.');
      const lo=sample[Math.floor(sample.length*.02)],hi=sample[Math.min(sample.length-1,Math.floor(sample.length*.98))];
      const keys=first.getGeoKeys();
      const affine=first.getFileDirectory().ModelTransformation;
      const resolution=first.getResolution();
      const epsg=Number(keys.ProjectedCSTypeGeoKey||keys.GeographicTypeGeoKey);
      const mapSafe=(!affine||(!affine[1]&&!affine[4]))&&resolution[0]>0&&resolution[1]<0;
      return {data,width,height,valid,lo,hi,bbox:first.getBoundingBox(),crs:JSON.stringify(keys),epsg,mapSafe};
    }finally{if(tiff.close)await tiff.close();}
  }
  function panel(f){
    const bs=EW.bands(f),presets=EW.presets(bs),indices=EW.indices(f),box=el('section','','band-panel');
    box.append(el('span','EXPLORE THE SPECTRUM','eyebrow'),el('h3','Bands available in this image'));
    if(!bs.length){box.append(el('p','This record does not expose individual band files. Open the source metadata to check its data access options.','detail-note'));return box;}
    if(EW.source(f).access==='account'){const note=el('p','Catalogue metadata is public. These data files require a Copernicus Data Space account; this website is not signed in to that provider.','detail-note');const link=el('a','Open provider to sign in and find this scene ↗');link.href=EW.https(EW.source(f).providerURL);link.target='_blank';link.rel='noopener noreferrer';box.append(note,link);}
    const intro=el('p',`${bs.length} band or data-layer option${bs.length===1?'':'s'} found in this record. Access and preview availability are shown below.`,'detail-note');box.append(intro);
    const controls=el('div','','band-controls');
    const mode=el('select','');mode.id='band-mode';mode.setAttribute('aria-label','Band display mode');
    mode.append(new Option('Single band / data layer','single'),...presets.map(p=>new Option(p.label,p.id)),...indices.map(p=>new Option(p.label,p.id)));
    const band=el('select','');band.id='band-choice';band.setAttribute('aria-label','Available band or data layer');
    for(const b of bs)band.append(new Option(b.label,b.id));
    const modeLabel=el('label','Display');modeLabel.htmlFor=mode.id;const bandLabel=el('label','Band / data layer');bandLabel.htmlFor=band.id;
    const modeField=el('div',''),bandField=el('div','');modeField.append(modeLabel,mode);bandField.append(bandLabel,band);controls.append(modeField,bandField);box.append(controls);
    const info=el('p','','band-info'),metadata=el('dl','','band-metadata'),help=el('p','','band-help'),metadataDetails=el('details','','band-calibration');metadataDetails.append(el('summary','Calibration and band details'),metadata);box.append(info,metadataDetails,help);
    const buttons=el('div','','band-actions'),render=el('button','Render band preview'),open=el('button','Open selected band file ↗'),save=el('button','Save preview PNG ↓');
    render.type=open.type=save.type='button';save.hidden=true;buttons.append(render,open,save);box.append(buttons);
    const status=el('p','','detail-note');status.setAttribute('role','status');box.append(status);
    const canvas=el('canvas','');canvas.hidden=true;canvas.className='band-canvas';const legend=el('div','','raster-legend');legend.hidden=true;box.append(canvas,legend);
    const links=el('div','','band-file-links');box.append(links);
    let controller=null,revision=0;const cache=new Map();
    const chosen=()=>mode.value==='single'?[bs.find(b=>b.id===band.value)]:[...presets,...indices].find(p=>p.id===mode.value).bands;
    function change(){revision++;controller?.abort();canvas.hidden=true;legend.hidden=true;save.hidden=true;status.textContent='';render.disabled=false;render.textContent='Render band preview';bandField.hidden=mode.value!=='single';const selected=chosen();render.disabled=selected.some(b=>!b.canPreview);info.textContent=selected.map(b=>[b.label,typeof b.wavelength==='number'?`${b.wavelength} µm`:null,Number.isFinite(b.gsd)?`${b.gsd} m pixels`:null,b.unit?`unit: ${b.unit}`:null].filter(Boolean).join(' · ')).join(' / ');metadata.replaceChildren();for(const b of selected){for(const [title,value] of [['Band',b.label],['Pixel spacing',Number.isFinite(b.gsd)?b.gsd+' m':'Not reported'],['Units',b.unit||'Not reported'],['No-data value',b.nodata??'Not reported'],['Scale',b.scale??'Not reported'],['Offset',b.offset??'0 (format default)']]){const cell=el('div','');cell.append(el('dt',title),el('dd',String(value)));metadata.append(cell);}}const index=indices.find(x=>x.id===mode.value);help.textContent=index?index.formula+' · Unitless, −1 to +1. Uses reported reflectance scale and offset. Clouds, shadows and quality flags are not masked; this is an exploratory downsampled preview.':mode.value==='single'?'Single-band brightness uses a 2–98% stretch of raw stored pixel values. Calibration metadata is shown above.':'RGB channels are stretched independently for display; colours are not calibrated measurements.';open.hidden=mode.value!=='single';open.disabled=selected.some(b=>b.requiresAuth);links.replaceChildren();if(mode.value!=='single'){selected.forEach((b,i)=>{const btn=el('button',`${indices.some(x=>x.id===mode.value)?'Input '+(i+1):['R','G','B'][i]}: ${b.label} ↗`);btn.type='button';btn.disabled=b.requiresAuth;btn.onclick=()=>openFile(b);links.append(btn);});}if(render.disabled)status.textContent=selected.some(b=>b.requiresAuth)?'Provider sign-in is required. Band names describe the catalogue files; pixels have not been loaded.':EW.source(f).preview==='download'?'Original files are public, but this provider does not allow browser raster previews. Download and open them in QGIS.':'This asset format requires geospatial software. Use the file link to access it.';}
    async function openFile(b){if(b.requiresAuth){status.textContent='Open the provider and sign in to access this file.';return;}const tab=window.open('about:blank','_blank');if(tab)tab.opener=null;status.textContent='Preparing the original data file…';try{const href=await assetURL(b.href,AbortSignal.timeout(20000));if(tab)tab.location.href=href;else{const a=el('a','Open the original file ↗');a.href=href;a.target='_blank';a.rel='noopener noreferrer';status.replaceChildren(a);return;}status.textContent='Original data file opened. Large raster files may download instead of displaying.';}catch(e){tab?.close();status.textContent=e.message;}}
    mode.onchange=band.onchange=change;open.onclick=()=>openFile(chosen()[0]);
    render.onclick=async()=>{const token=++revision;controller?.abort();controller=new AbortController();const active=controller;const timer=setTimeout(()=>active.abort(),45000);render.disabled=true;canvas.hidden=true;save.hidden=true;status.textContent='Reading source pixels and building your preview…';try{const selected=chosen(),rasters=[];for(const b of selected){if(!cache.has(b.id)){if(cache.size>=6)cache.clear();cache.set(b.id,await readBand(b,active.signal));}rasters.push(cache.get(b.id));}if(active.signal.aborted)throw Error('Preview timed out. Try a single band or open the original file.');if(token!==revision)return;const index=indices.find(x=>x.id===mode.value),stretched=index?EW.indexRaster(rasters,selected):EW.stretch(rasters);canvas.width=stretched.width;canvas.height=stretched.height;const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(canvas.width,canvas.height);pixels.data.set(stretched.pixels);ctx.putImageData(pixels,0,0);canvas.setAttribute('aria-label',`Source-data preview: ${selected.map(b=>b.label).join(', ')}`);canvas.hidden=false;save.hidden=false;legend.replaceChildren();legend.className='raster-legend'+(index?' index-legend':'');const values=el('div','','legend-values');values.append(el('span',index?'−1':rasters[0].lo.toPrecision(5)),el('span',index?'0':'Raw values · first channel'),el('span',index?'+1':rasters[0].hi.toPrecision(5)));if(!index&&rasters.length===3){legend.append(el('strong','RGB display limits · raw stored values'));rasters.forEach((r,i)=>legend.append(el('p',`${['Red channel','Green channel','Blue channel'][i]}: ${r.lo.toPrecision(5)} to ${r.hi.toPrecision(5)}`)));}else legend.append(el('strong',index?index.label+' · fixed scale':'Display stretch'),el('div','','legend-bar'),values);legend.hidden=false;status.textContent=index?`Exploratory ${index.id.toUpperCase()} from scaled source reflectance. Valid preview range ${stretched.min.toFixed(3)} to ${stretched.max.toFixed(3)}. Clouds and shadows are not masked; no-data and invalid ratios are transparent.`:'Full-tile preview from source pixels. Each channel uses a 2–98% stretch of raw stored values. No-data pixels are transparent.';}catch(e){if(token===revision)status.textContent=active.signal.aborted?'Preview timed out or was cancelled. Open the original file if the provider blocks browser access.':e.message;}finally{clearTimeout(timer);if(token===revision)render.disabled=chosen().some(b=>!b.canPreview);}};
    save.onclick=()=>{const a=document.createElement('a');a.href=canvas.toDataURL('image/png');a.download=`earth-window-${f.id.replace(/[^a-z0-9_-]/gi,'_')}-${mode.value==='single'?band.value.replace(':','-'):mode.value}.png`;a.click();};
    const dialog=document.getElementById('scene-dialog');const close=()=>{revision++;controller?.abort();cache.clear();dialog.removeEventListener('close',close);};dialog.addEventListener('close',close);
    change();return box;
  }
  return {panel,assetURL,readBand};
})();
