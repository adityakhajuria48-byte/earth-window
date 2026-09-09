/* Shared, DOM-independent catalogue and band interpretation. */
(function(root) {
  'use strict';
  const DAY=86400000;
  function source(f){return f._earthWindow||{};}
  function interval(f){
    const p=f.properties||{},s=source(f);
    let start=Date.parse(p.start_datetime||p.datetime),end=Date.parse(p.end_datetime||p.datetime);
    if(!Number.isFinite(start))return null;
    if(s.period==='annual mosaic'&&!p.start_datetime){const year=new Date(start).getUTCFullYear();start=Date.UTC(year,0,1);end=Date.UTC(year+1,0,1)-1;}
    else if(s.period==='8-day composite'&&!p.end_datetime){end=Math.min(start+8*DAY-1,Date.UTC(new Date(start).getUTCFullYear()+1,0,1)-1);}
    end=Number.isFinite(end)?end:start;if(end<start)return null;return {start,end,composite:s.period&&s.period!=='scene'};
  }
  function distance(f,target){const t=interval(f);return !t?Infinity:target<t.start?t.start-target:target>t.end?target-t.end:0;}
  function cloud(f){const v=f.properties?.['eo:cloud_cover'];return typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100?v:null;}
  function matches(f,q){const t=interval(f);if(!t||t.end<Date.parse(q.start)||t.start>Date.parse(q.end))return false;const c=cloud(f);return source(f).kind==='radar'||c===null||c<=q.cloud;}
  function attach(f,s){return {...f,_earthWindow:{sourceId:s.id,name:s.name,family:s.family,agency:s.agency,region:s.region,kind:s.kind,period:s.period,gsd:s.gsd}};}
  function requestRange(q,s){let start=new Date(q.start),end=new Date(q.end);if(s.period==='8-day composite')start=new Date(+start-7*DAY);if(s.period==='annual mosaic'){start=new Date(Date.UTC(start.getUTCFullYear(),0,1));end=new Date(Date.UTC(end.getUTCFullYear()+1,0,1)-1);}return `${start.toISOString()}/${end.toISOString()}`;}
  function identity(f){const s=source(f),p=f.properties||{};return `${s.sourceId}:${f.collection}:${f.id}`;}
  function dedupe(features){const seen=new Set();return features.filter(f=>{const p=f.properties||{},s=source(f);const tile=p['mgrs:utm_zone']&&p['mgrs:latitude_band']&&p['mgrs:grid_square']?`${p['mgrs:utm_zone']}${p['mgrs:latitude_band']}${p['mgrs:grid_square']}`:null;const key=s.family==='Sentinel-2'&&p.platform&&p.datetime&&tile?`${s.family}:${p.platform}:${p.datetime}:${tile}`:identity(f);if(seen.has(key))return false;seen.add(key);return true;});}
  function https(href){try{const u=new URL(href);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
  const COMMON={coastal:'Coastal aerosol',blue:'Blue',green:'Green',red:'Red',rededge:'Red edge',nir:'Near infrared',nir08:'Near infrared',nir09:'Water vapour / NIR',swir16:'Shortwave infrared 1',swir22:'Shortwave infrared 2',lwir11:'Thermal infrared',lwir12:'Thermal infrared 2',vv:'VV radar',vh:'VH radar',hh:'HH radar',hv:'HV radar'};
  function bands(f){const result=[];for(const [key,a] of Object.entries(f.assets||{})){
    const href=https(a.href);if(!href)continue;
    const roles=a.roles||[], eo=a['eo:bands']||a.bands||[];
    const raster=a['raster:bands']||[];
    const isTiff=/tiff/i.test(a.type||'')||/\.tiff?(?:\?|$)/i.test(href);
    const known=COMMON[key.toLowerCase()];
    if(/jp2/i.test(key)||roles.includes('thumbnail')||roles.includes('overview')||['visual','thumbnail','rendered_preview','tilejson','map'].includes(key))continue;
    if(!eo.length&&!raster.length&&!known&&!roles.includes('data'))continue;
    if(!isTiff&&!/hdf|netcdf|jp2/i.test(a.type||href))continue;
    // Asset metadata owns the band list. Unlabelled data assets remain explicit.
    const count=Math.max(eo.length,raster.length,1);
    for(let i=0;i<count;i++){
      const e=eo[i]||{},r=raster[i]||{};let common=e.common_name||((eo.length<=1&&known)?key.toLowerCase():null);if(common?.startsWith('lwir')&&e.center_wavelength<3)common=null;
      const name=e.name||(count===1?key:`${key} / band ${i+1}`);
      const label=[name,(count===1?a.title:null)||e.description||COMMON[common]].filter(Boolean).filter((v,i,x)=>x.indexOf(v)===i).join(' · ');
      result.push({id:`${key}:${i}`,key,index:i,label,common,href,isTiff,wavelength:e.center_wavelength,gsd:a.gsd||f.properties?.gsd||source(f).gsd,nodata:r.nodata,unit:r.unit,scale:r.scale,offset:r.offset});
    }
  }return result;}
  function presets(bs){const get=(...names)=>bs.find(b=>b.isTiff&&names.includes(b.common));const red=get('red'),green=get('green'),blue=get('blue'),nir=get('nir','nir08'),swir=get('swir16');return [{id:'true',label:'True colour',bands:[red,green,blue]},{id:'vegetation',label:'False colour · vegetation',bands:[nir,red,green]},{id:'swir',label:'False colour · SWIR',bands:[swir,nir,red]}].filter(p=>p.bands.every(Boolean));}
  function stretch(rasters){
    const first=rasters[0];
    if(!first||![1,3].includes(rasters.length))throw Error('Choose one band or three display channels.');
    const aligned=r=>r.width===first.width&&r.height===first.height&&r.crs===first.crs&&r.bbox.length===first.bbox.length&&r.bbox.every((v,i)=>Math.abs(v-first.bbox[i])<Math.max(1,Math.abs(v))*1e-6);
    if(!rasters.every(aligned))throw Error('These bands use different grids. Open the originals in QGIS to align them before combining.');
    const channels=rasters.length===1?[first,first,first]:rasters;
    const pixels=new Uint8ClampedArray(first.width*first.height*4);
    for(let i=0;i<first.width*first.height;i++){
      let valid=true;for(let c=0;c<3;c++){const r=channels[c],v=r.data[i];if(!r.valid(v))valid=false;pixels[i*4+c]=Math.round(255*Math.max(0,Math.min(1,(v-r.lo)/(r.hi-r.lo||1))));}pixels[i*4+3]=valid?255:0;
    }
    return {width:first.width,height:first.height,pixels};
  }
  const api={source,interval,distance,cloud,matches,attach,requestRange,identity,dedupe,https,bands,presets,stretch};
  root.EW=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
