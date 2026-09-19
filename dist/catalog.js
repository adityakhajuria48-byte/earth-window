/* Shared, DOM-independent catalogue and band interpretation. */
(function(root) {
  'use strict';
  const DAY=86400000;
  function spatialQuery(q){
    if(q.scope==='world')return {};
    if(q.scope==='area'){
      const b=q.bounds;
      if(!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite))throw Error('Invalid map bounds.');
      const [w,s,e,n]=b;
      if(w < -180||w>180||e < -180||e>180||s < -90||n>90||s>=n||w===e)throw Error('Invalid map bounds.');
      if(w<e)return {bbox:b.join(',')};
      const ring=(a,z)=>[[a,s],[z,s],[z,n],[a,n],[a,s]];
      return {intersects:JSON.stringify({type:'MultiPolygon',coordinates:[[ring(w,180)],[ring(-180,e)]].filter(p=>p[0][0][0]!==p[0][1][0])})};
    }
    if(!Number.isFinite(q.lat)||!Number.isFinite(q.lon)||Math.abs(q.lat)>90||Math.abs(q.lon)>180)throw Error('Invalid geographic point.');
    return {intersects:JSON.stringify({type:'Point',coordinates:[q.lon,q.lat]})};
  }
  function source(f){return f._earthWindow||{};}
  function interval(f){
    const p=f.properties||{},s=source(f);
    let start=Date.parse(p.start_datetime||p.datetime),end=Date.parse(p.end_datetime||p.datetime);
    if(!Number.isFinite(start))return null;
    if(s.period==='annual mosaic'&&!p.start_datetime){const year=new Date(start).getUTCFullYear();start=Date.UTC(year,0,1);end=Date.UTC(year+1,0,1)-1;}
    else if(s.period==='8-day composite'&&!p.end_datetime){end=Math.min(start+8*DAY-1,Date.UTC(new Date(start).getUTCFullYear()+1,0,1)-1);}
    if(s.timePrecision==='day'){const d=new Date(start);start=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());end=start+DAY-1;}
    end=Number.isFinite(end)?end:start;if(end<start)return null;return {start,end,composite:!!s.period&&s.period!=='scene',dayOnly:s.timePrecision==='day',range:end>start};
  }
  function distance(f,target){const t=interval(f);return !t?Infinity:target<t.start?t.start-target:target>t.end?target-t.end:0;}
  function cloud(f){const v=f.properties?.['eo:cloud_cover'];return typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100?v:null;}
  function matches(f,q){if(q.resolution && (spacing(f)===null || spacing(f)>q.resolution))return false;const t=interval(f);if(!t||t.end<Date.parse(q.start)||t.start>Date.parse(q.end))return false;const c=cloud(f);return source(f).kind==='radar'||c===null||c<=q.cloud;}
  function attach(f,s){return {...f,_earthWindow:{sourceId:s.id,name:s.name,family:s.family,agency:s.agency,region:s.region,kind:s.kind,period:s.period,gsd:s.gsd,platform:s.platform,timePrecision:s.timePrecision,access:s.access,preview:s.preview,providerURL:s.providerURL,coverage:s.coverage}};}
  function requestRange(q,s){let start=new Date(q.start),end=new Date(q.end);if(s.period==='8-day composite')start=new Date(+start-7*DAY);if(s.period==='annual mosaic'){start=new Date(Date.UTC(start.getUTCFullYear(),0,1));end=new Date(Date.UTC(end.getUTCFullYear()+1,0,1)-1);}return `${start.toISOString()}/${end.toISOString()}`;}
  function identity(f){const s=source(f),p=f.properties||{};return `${s.sourceId}:${f.collection}:${f.id}`;}
  function dedupe(features){const seen=new Set();return features.filter(f=>{const p=f.properties||{},s=source(f);const tile=p['mgrs:utm_zone']&&p['mgrs:latitude_band']&&p['mgrs:grid_square']?`${p['mgrs:utm_zone']}${p['mgrs:latitude_band']}${p['mgrs:grid_square']}`:null;const key=s.family==='Sentinel-2'&&p.platform&&p.datetime&&tile?`${s.family}:${p.platform}:${p.datetime}:${tile}`:identity(f);if(seen.has(key))return false;seen.add(key);return true;});}
  function https(href){try{const u=new URL(href);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
  const COMMON={coastal:'Coastal aerosol',blue:'Blue',green:'Green',red:'Red',rededge:'Red edge',nir:'Near infrared',nir08:'Near infrared',nir09:'Water vapour / NIR',swir16:'Shortwave infrared 1',swir22:'Shortwave infrared 2',lwir11:'Thermal infrared',lwir12:'Thermal infrared 2',vv:'VV radar',vh:'VH radar',hh:'HH radar',hv:'HV radar'};
  function bands(f){const result=[];for(const [key,a] of Object.entries(f.assets||{})){
    if(!a||typeof a!=='object')continue;const href=https(a.href)||https(a.alternate?.https?.href);if(!href)continue;
    const roles=Array.isArray(a.roles)?a.roles:[], eo=Array.isArray(a['eo:bands'])?a['eo:bands']:Array.isArray(a.bands)?a.bands:[];
    const raster=Array.isArray(a['raster:bands'])?a['raster:bands']:[];
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
      result.push({id:`${key}:${i}`,key,index:i,label,common,href,isTiff,wavelength:e.center_wavelength,gsd:a.gsd||e.resolution_x||f.properties?.gsd||source(f).gsd,nodata:r.nodata??e.nodata,unit:r.unit,scale:r.scale??e.scale,offset:r.offset??e.scale_add,requiresAuth:source(f).access==='account'||!!a['auth:refs']?.length,serverPreview:isTiff&&source(f).preview==='download'&&source(f).access!=='account'&&!a['auth:refs']?.length,canPreview:isTiff&&source(f).access!=='account'&&!a['auth:refs']?.length&&source(f).preview!=='download'});
    }
  }return result;}
  function presets(bs){const get=(...names)=>bs.find(b=>b.isTiff&&names.includes(b.common));const red=get('red'),green=get('green'),blue=get('blue'),nir=get('nir','nir08'),swir=get('swir16','swir');return [{id:'true',label:'True colour',bands:[red,green,blue]},{id:'vegetation',label:'False colour · vegetation',bands:[nir,red,green]},{id:'swir',label:'False colour · SWIR',bands:[swir,nir,red]}].filter(p=>p.bands.every(Boolean));}
  function onDay(f,day){const t=interval(f),start=Date.parse(day+'T00:00:00Z');return !!t&&Number.isFinite(start)&&t.end>=start&&t.start<start+DAY;}
  function availability(features,q){
    const start=Date.parse(q.start),end=Date.parse(q.end);if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return [];
    const first=Math.floor(start/DAY)*DAY,last=Math.floor(end/DAY)*DAY,rows=[];
    for(let time=first;time<=last&&rows.length<62;time+=DAY){
      const day=new Date(time).toISOString().slice(0,10),matches=features.filter(f=>onDay(f,day));
      rows.push({day,captures:matches.filter(f=>!interval(f).composite).length,composites:matches.filter(f=>interval(f).composite).length});
    }return rows;
  }
  function spacing(f){const values=bands(f).map(b=>b.gsd).filter(v=>typeof v==='number'&&Number.isFinite(v)&&v>0);const nominal=f.properties?.gsd||source(f).gsd;if(typeof nominal==='number'&&Number.isFinite(nominal)&&nominal>0)values.push(nominal);return values.length?Math.min(...values):null;}
  function rank(features,target,mode='best'){
    const rows=features.map(f=>{const t=interval(f),bs=bands(f);return {f,t,ground:['optical','radar'].includes(source(f).kind),access:bs.some(b=>b.canPreview)?0:bs.some(b=>!b.requiresAuth)?1:2,gap:distance(f,target),cloud:source(f).kind==='optical'?(cloud(f)??Infinity):Infinity,gsd:spacing(f)??Infinity};});
    rows.sort((a,b)=>{
      if(mode==='clear')return a.cloud-b.cloud||a.gap-b.gap;
      if(mode==='detail')return Number(!a.ground)-Number(!b.ground)||a.gsd-b.gsd||a.gap-b.gap;
      if(mode==='newest')return (b.t?.start||0)-(a.t?.start||0);
      if(mode==='nearest')return Number(!!a.t?.composite)-Number(!!b.t?.composite)||Number(!!a.t?.dayOnly)-Number(!!b.t?.dayOnly)||a.gap-b.gap;
      // Access, ground imagery, time precision, proximity, clouds, then spacing.
      return Number(!a.ground)-Number(!b.ground)||a.access-b.access||Number(!!a.t?.composite)-Number(!!b.t?.composite)||Number(!!a.t?.dayOnly)-Number(!!b.t?.dayOnly)||a.gap-b.gap||a.cloud-b.cloud||a.gsd-b.gsd;
    });return rows.map(r=>r.f);
  }
  function timeOffset(f,target){const t=interval(f);if(!t)return 'Time unavailable';if(t.composite)return source(f).period+' · not an instant';if(t.dayOnly)return 'Day only · exact time unavailable';const gap=distance(f,target);if(gap===0)return t.range?'Requested time falls in acquisition interval':'Matches the reported capture time';const amount=gap<3600000?Math.max(1,Math.round(gap/60000))+' min':gap<DAY?(gap/3600000).toFixed(1)+' h':(gap/DAY).toFixed(1)+' days';return amount+(target<t.start?' after':' before')+' requested time';}
  function indices(f){
    // These connected Level-2 collections expose surface reflectance, not radiance.
    if(!['s2','s2-c1','landsat','modis'].includes(source(f).sourceId))return [];
    const bs=bands(f),get=(...names)=>bs.find(b=>b.canPreview&&names.includes(b.common)&&Number.isFinite(b.scale)&&b.scale>0&&(b.offset==null||Number.isFinite(b.offset)));
    const nir=get('nir','nir08'),red=get('red'),green=get('green'),swir=get('swir22');
    return [{id:'ndvi',label:'NDVI · vegetation',bands:[nir,red],formula:'(NIR − Red) / (NIR + Red)'},{id:'ndwi',label:'NDWI · water',bands:[green,nir],formula:'(Green − NIR) / (Green + NIR)'},{id:'nbr',label:'NBR · burn ratio',bands:[nir,swir],formula:'(NIR − SWIR2) / (NIR + SWIR2)'}].filter(x=>x.bands.every(Boolean));
  }
  function indexRaster(rasters,bs){
    const [a,b]=rasters;if(!a||!b||rasters.length!==2||bs.length!==2||!bs.every(x=>Number.isFinite(x.scale)&&x.scale>0&&(x.offset==null||Number.isFinite(x.offset))))throw Error('This index needs two bands with explicit reflectance calibration.');
    if(a.width!==b.width||a.height!==b.height||a.crs!==b.crs||a.bbox.length!==b.bbox.length||!a.bbox.every((v,i)=>Math.abs(v-b.bbox[i])<Math.max(1,Math.abs(v))*1e-6))throw Error('Index bands use different grids. Align the original rasters in GIS first.');
    const values=new Float32Array(a.data.length);values.fill(NaN);const pixels=new Uint8ClampedArray(values.length*4);let count=0,min=Infinity,max=-Infinity;
    for(let i=0;i<values.length;i++){if(!a.valid(a.data[i])||!b.valid(b.data[i]))continue;const x=a.data[i]*bs[0].scale+(bs[0].offset??0),y=b.data[i]*bs[1].scale+(bs[1].offset??0),den=x+y;if(!Number.isFinite(den)||den<=1e-12)continue;const v=(x-y)/den;if(!Number.isFinite(v)||v < -1||v>1)continue;values[i]=v;min=Math.min(min,v);max=Math.max(max,v);count++;const low=v<0?[36,92,170]:[241,239,224],high=v<0?[241,239,224]:[37,131,84],weight=v<0?v+1:v;for(let c=0;c<3;c++)pixels[i*4+c]=Math.round(low[c]+(high[c]-low[c])*weight);pixels[i*4+3]=255;}
    if(!count)throw Error('No valid index pixels were found after no-data and denominator checks.');return {width:a.width,height:a.height,pixels,values,count,min,max};
  }
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
  const api={source,interval,distance,cloud,matches,attach,requestRange,identity,dedupe,https,bands,presets,stretch,spatialQuery,onDay,availability,spacing,rank,timeOffset,indices,indexRaster};
  root.EW=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
