'use strict';
const $ = id => document.getElementById(id);
let SOURCES = [];
let sourcesPromise;
async function loadSources(){if(SOURCES.length)return SOURCES;if(!sourcesPromise)sourcesPromise=fetchJSON('/sources.json',AbortSignal.timeout(10000)).then(x=>{if(!Array.isArray(x)||!x.length)throw Error('Archive list unavailable.');SOURCES=x;return x;}).catch(e=>{sourcesPromise=null;throw e;});return sourcesPromise;}
const today = new Date().toISOString().slice(0, 10);
const initialDate = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
const state = {scope:'world',bounds:null,lat:null,lon:null,name:'Whole world',placeText:'',scenes:[],date:initialDate,target:0,request:0,geoRequest:0,selected:null,query:null,dirty:false,shown:30,sourceResults:[]};
let map, marker, nasa, streets, footprint, resultFootprints, currentController;
$('date').value = initialDate; $('date').max = today;
function text(tag, value, cls) { const e = document.createElement(tag); e.textContent = value; if(cls)e.className=cls;return e; }
function safeURL(href) {return EW.https(href);}
function dateLabel(value) {return new Date(value).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'});}
function captureTime(value) {return new Date(value).toISOString().slice(11,19)+' UTC';}
function platform(f) {const p=f.properties.platform;return p?String(p).replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase()):`${EW.source(f).family||'Satellite'} · platform not reported`;}
function cloud(f) {return EW.cloud(f);}
function cloudLabel(f) {if(EW.source(f).kind==='radar')return 'Radar · cloud filter not applied';const c=cloud(f);return c===null?'Clouds unreported':c.toFixed(1)+'% cloud';}
function resolution(f) {const v=f.properties.gsd||EW.source(f).gsd;return Number.isFinite(v)?`${v} m nominal · varies by band`:'See individual band metadata';}
function itemDate(f) {const t=EW.interval(f);return t?dateLabel(t.start):'Date unreported';}
function itemTime(f) {const t=EW.interval(f);if(!t)return 'Date unreported';return t.composite?`${EW.source(f).period} · to ${dateLabel(t.end)}`:captureTime(t.start);}
function previewURL(f) {const assets=f.assets||{};for(const [key,a] of Object.entries(assets)){if(key==='thumbnail'||key==='rendered_preview'||(a.roles||[]).includes('thumbnail')){const u=safeURL(a.href);if(u)return u;}}return null;}
function assetURL(f,key) {return safeURL(f.assets?.[key]?.href);}
async function fetchJSON(url,signal) {const r=await fetch(url,{signal,headers:{Accept:'application/geo+json, application/json'}});if(!r.ok)throw Error(r.status===429?'The imagery service is busy. Please wait a minute and retry.':`The service could not complete this request (HTTP ${r.status}). Please retry.`);return r.json();}
function warnMap(message) {$('map-warning').textContent=message;$('map-warning').hidden=!message;}
function updateMapLayer() {
  if(!map)return;
  if(nasa)map.removeLayer(nasa);
  warnMap('');
  const street=$('map-layer').value==='streets';
  $('map-source').textContent=street?'OpenStreetMap · Reference map':'Terra / MODIS · Daily overview';
  $('map-date').textContent=street?'Reference only · Not capture-date imagery':`${dateLabel(state.date)} · Daily mosaic · Not a selected scene`;
  if(street){streets.setOpacity(1);return;}
  streets.setOpacity(0);
  nasa=L.tileLayer(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${state.date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,{maxNativeZoom:9,maxZoom:17,noWrap:true,attribution:'Imagery: <a href="https://www.earthdata.nasa.gov/">NASA GIBS</a>',bounds:[[-85,-180],[85,180]]}).addTo(map);
  nasa.on('tileerror',()=>warnMap('NASA overview tiles could not load. Try Street map; scene search is separate.'));
  if(new Date(state.date)<new Date('2000-02-24'))warnMap('This date predates Terra/MODIS imagery. Use Street map to locate the historical scenes.');
}
function initMap() {
  if(!window.L){$('map').append(text('div','The interactive map could not load. You can still search imagery by place or coordinates.','map-unavailable'));$('map-date').textContent='Map service unavailable';$('map-layer').disabled=true;return;}
  map=L.map('map',{zoomControl:false,worldCopyJump:true,minZoom:1,maxZoom:17}).setView([15,0],1);
  L.control.zoom({position:'bottomright'}).addTo(map);
  streets=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
  streets.on('tileerror',()=>{if($('map-layer').value==='streets')warnMap('Street-map tiles could not load. You can still search by place or coordinates.');});
  resultFootprints=L.layerGroup().addTo(map);
  map.on('click',e=>{const lon=((e.latlng.lng+180)%360+360)%360-180;const lat=Math.max(-90,Math.min(90,e.latlng.lat));setPlace(lat,lon,`${lat.toFixed(4)}, ${lon.toFixed(4)}`,false);});
  updateMapLayer();
}
function clearResults(message) {state.shown=30;$('load-more').hidden=true;$('source-status').replaceChildren();state.scenes=[];state.selected=null;resultFootprints?.clearLayers();$('count').textContent='—';$('export').disabled=true;$('scene-list').replaceChildren(empty('Ready for another perspective',message));if(footprint&&map){map.removeLayer(footprint);footprint=null;}}
function invalidate() {state.request++;currentController?.abort();$('search-button').disabled=false;$('search-button').replaceChildren(text('span','Find satellite images'),text('span','↗'));clearResults('Your search changed. Select Find satellite images to update the results.');$('result-summary').textContent='Search settings changed.';}
function setPlace(lat,lon,name,fly=true) {state.scope='point';state.bounds=null;$('world-search').setAttribute('aria-pressed','false');state.geoRequest++;$('find-place').disabled=false;state.lat=lat;state.lon=lon;state.name=name;state.placeText=name;state.dirty=false;$('place').value=name;$('place-results').replaceChildren();$('location-title').textContent=name;$('coordinates').textContent=`${Math.abs(lat).toFixed(4)}° ${lat>=0?'N':'S'}, ${Math.abs(lon).toFixed(4)}° ${lon>=0?'E':'W'}`;if(map){if(!marker)marker=L.marker([lat,lon],{icon:L.divIcon({className:'',html:'<div class="pin-dot"></div>',iconSize:[16,16],iconAnchor:[8,8]}),keyboard:false}).addTo(map);else marker.setLatLng([lat,lon]);if(fly)map.setView([lat,lon],Math.min(10,Math.max(7,map.getZoom())));}invalidate();$('search-notice').textContent='Location selected. Find images to update the archive results.';}
function wholeWorld(run=true){
  state.scope='world';state.bounds=null;state.lat=null;state.lon=null;state.name='Whole world';state.placeText='';state.dirty=false;state.geoRequest++;
  $('place').value='';$('place-results').replaceChildren();$('find-place').disabled=false;$('location-title').textContent='Whole world';$('coordinates').textContent='Worldwide · No location filter';$('world-search').setAttribute('aria-pressed','true');
  if(marker&&map){map.removeLayer(marker);marker=null;}map?.setView([15,0],1);invalidate();$('search-notice').textContent='Worldwide search selected.';if(run)search();
}
function searchMapArea(){
  if(!map){$('search-notice').textContent='The map is unavailable. Worldwide search and coordinate search still work.';return;}
  const b=map.getBounds(),width=b.getEast()-b.getWest();if(width>=360){wholeWorld();return;}
  const wrap=x=>((x+180)%360+360)%360-180;
  state.scope='area';state.bounds=[wrap(b.getWest()),Math.max(-90,b.getSouth()),wrap(b.getEast()),Math.min(90,b.getNorth())];state.name='Selected map area';state.placeText='';state.dirty=false;state.geoRequest++;
  $('place').value='';$('place-results').replaceChildren();$('find-place').disabled=false;$('location-title').textContent=state.name;$('coordinates').textContent='Region: '+state.bounds.map(n=>n.toFixed(1)+'°').join(', ');$('world-search').setAttribute('aria-pressed','false');
  if(marker){map.removeLayer(marker);marker=null;}invalidate();search();
}
function showResultLocations(){
  if(!map||!resultFootprints)return;resultFootprints.clearLayers();
  for(const f of orderedScenes().slice(0,state.shown)){
    if(!f.geometry)continue;
    const layer=L.geoJSON(f.geometry,{bubblingMouseEvents:false,style:{color:EW.source(f).kind==='radar'?'#78cef1':'#b8f56b',weight:1,fillOpacity:.045}});
    layer.on('click',e=>{if(e.originalEvent)L.DomEvent.stopPropagation(e.originalEvent);openScene(f);});
    layer.addTo(resultFootprints);
  }
}
function parseCoords(q) {const m=q.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);if(!m)return null;const lat=Number(m[1]),lon=Number(m[2]);if(lat < -90||lat>90||lon < -180||lon>180)throw Error('Use latitude from −90 to 90 and longitude from −180 to 180.');return [lat,lon];}
async function findPlace() {const q=$('place').value.trim();if(!q){wholeWorld(false);return true;}const request=++state.geoRequest;try {const coords=parseCoords(q);if(coords){setPlace(...coords,q);return true;}$('find-place').disabled=true;$('search-notice').textContent='Finding places…';const url=window.EARTH_WINDOW_PYTHON?'/api/geocode?'+new URLSearchParams({q}):'https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name:q,count:5,language:'en',format:'json'});const raw=await fetchJSON(url,AbortSignal.timeout(20000));const results=window.EARTH_WINDOW_PYTHON?raw:(raw.results||[]).map(p=>({lat:p.latitude,lon:p.longitude,display_name:[p.name,p.admin1,p.country].filter(Boolean).join(', ')}));if(request!==state.geoRequest)return false;$('place-results').replaceChildren();if(!Array.isArray(results)||!results.length)throw Error('No matching place found. Try another name or enter latitude, longitude.');if(results.length===1){setPlace(Number(results[0].lat),Number(results[0].lon),results[0].display_name);return true;}for(const place of results){const b=text('button',place.display_name);b.type='button';b.onclick=()=>setPlace(Number(place.lat),Number(place.lon),place.display_name);$('place-results').append(b);}$('search-notice').textContent='Choose the matching location above, then find images.';return false;}catch(e){if(request===state.geoRequest)$('search-notice').textContent=e.name==='TimeoutError'?'Place lookup timed out. Try coordinates or click the map.':e.message;return false;}finally{if(request===state.geoRequest)$('find-place').disabled=false;}}
function searchParams() {const date=$('date').value,time=$('time').value;if(!date||!time)throw Error('Choose a date and UTC time.');const target=new Date(`${date}T${time}:00Z`);if(!Number.isFinite(+target))throw Error('Choose a valid date and UTC time.');if(date>today)throw Error('Future imagery is not available. Choose today or an earlier date.');if(date<'1982-01-01')throw Error('Choose a date from 1982 onward.');const days=Number($('window').value);const start=new Date(`${date}T00:00:00Z`);start.setUTCDate(start.getUTCDate()-days);const end=new Date(`${date}T23:59:59.999Z`);end.setUTCDate(end.getUTCDate()+days);return {date,time,days,target:+target,start:start.toISOString(),end:new Date(Math.min(+end,Date.now())).toISOString(),cloud:Number($('cloud').value),scope:state.scope,bounds:state.bounds,lat:state.lat,lon:state.lon};}
async function fetchSource(q,s,signal){
  const params=new URLSearchParams({collections:s.collection,...EW.spatialQuery(q),datetime:EW.requestRange(q,s),limit:100,sortby:'-datetime'});
  let url=s.endpoint+'?'+params,features=[],truncated=false,complete=false;
  const local=new AbortController(),abort=()=>local.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)local.abort();const timeout=setTimeout(abort,45000);
  try{for(let page=0;page<3;page++){
    const data=await fetchJSON(url,local.signal);if(!Array.isArray(data.features))throw Error('Unexpected archive response.');
    features.push(...data.features.map(f=>EW.attach(f,s)));
    const next=data.links?.find(l=>l.rel==='next');if(!next){complete=true;break;}
    const href=EW.https(next.href),expected=new URL(s.endpoint);
    if(!href||new URL(href).origin!==expected.origin||!new URL(href).pathname.startsWith(expected.pathname.slice(0,expected.pathname.lastIndexOf('/')+1))||(next.method&&next.method!=='GET')){truncated=true;break;}
    url=href;if(page===2)truncated=true;
  }return {id:s.id,name:s.name,status:complete?'complete':'partial',features,truncated};}
  catch(e){return {id:s.id,name:s.name,status:features.length?'partial':'unavailable',features,truncated:!!features.length,error:'Could not finish checking this archive. Retry to check its coverage.'};}
  finally{clearTimeout(timeout);signal.removeEventListener('abort',abort);}
}
async function fetchScenes(q,signal,onProgress){
  await loadSources();
  if(window.EARTH_WINDOW_PYTHON)return fetchJSON('/api/search?'+new URLSearchParams({scope:q.scope,...(q.scope==='point'?{lat:q.lat,lon:q.lon}:q.scope==='area'?{bounds:q.bounds.join(',')}:{}),date:q.date,time:q.time,window:q.days,cloud:q.cloud}),signal);
  const progress=SOURCES.map(s=>({id:s.id,name:s.name,status:'pending',features:[]}));
  const results=await Promise.all(SOURCES.map((s,i)=>fetchSource(q,s,signal).then(result=>{progress[i]=result;if(!signal.aborted)onProgress?.({features:progress.flatMap(r=>r.features),sources:progress.map(({features,...r})=>r)});return result;})));
  return {features:results.flatMap(r=>r.features),sources:results.map(({features,...r})=>r),truncated:results.some(r=>r.truncated)};
}
function renderSourceStatus(sources){
  const box=$('source-status');box.replaceChildren();const details=text('details','');
  const checked=sources.filter(s=>s.status==='complete').length,unavailable=sources.filter(s=>s.status==='unavailable').length;
  details.append(text('summary',`${checked}/${sources.length} archives fully checked${unavailable?` · ${unavailable} unavailable`:''} · View coverage`));
  const list=text('ul','');for(const s of sources){const count=state.scenes.filter(f=>EW.source(f).sourceId===s.id).length;list.append(text('li',`${s.name}: ${s.status==='pending'?'checking…':s.status==='unavailable'?'unavailable — coverage unknown':s.status==='partial'?`${count} shown · partial search`:`${count} shown · search complete`}`));}details.append(list);box.append(details);
  const counts=new Map();for(const f of state.scenes)counts.set(platform(f),(counts.get(platform(f))||0)+1);
  if(counts.size){const line=text('p','Data available from: ','available-from');line.append(text('strong',Array.from(counts,([name,n])=>`${name} (${n})`).join(' · ')));box.prepend(line);}
}
function empty(title,message) {const e=text('div','','empty-state');e.append(text('span','◎'),text('h3',title),text('p',message));return e;}
async function search(event){
  event?.preventDefault();if(state.dirty||$('place').value.trim()!==state.placeText){if(!await findPlace())return;}
  let q;try{q=searchParams();}catch(e){$('search-notice').textContent=e.message;return;}
  const request=++state.request;currentController?.abort();currentController=new AbortController();const controller=currentController;const timeout=setTimeout(()=>controller.abort(),65000),signal=controller.signal;
  state.target=q.target;state.date=q.date;state.query={...q,name:state.name};clearResults('');updateMapLayer();
  $('search-button').disabled=true;$('search-button').textContent='Checking all satellite archives…';$('search-notice').textContent='';$('result-summary').textContent=`Searching ${q.scope==='world'?'the whole world':state.name} across connected satellite archives…`;
  $('scene-list').replaceChildren(...Array.from({length:3},()=>text('div','','skeleton')));
  try{
    const data=await fetchScenes(q,signal,partial=>{
      if(request!==state.request)return;
      state.scenes=EW.dedupe(partial.features.filter(f=>EW.matches(f,q)));state.sourceResults=partial.sources;
      $('count').textContent=state.scenes.length;$('export').disabled=!state.scenes.length;
      renderSourceStatus(partial.sources);
      if(state.scenes.length)renderScenes();
      $('result-summary').textContent=`${state.scenes.length} results found so far · Still checking connected archives…`;
    });if(request!==state.request)return;
    state.scenes=EW.dedupe(data.features.filter(f=>EW.matches(f,q)));state.sourceResults=data.sources||[];
    $('count').textContent=state.scenes.length;$('export').disabled=!state.scenes.length;
    const complete=state.sourceResults.filter(s=>s.status==='complete').length;
    const hasFailure=complete<state.sourceResults.length;
    $('result-summary').textContent=`${q.scope==='world'?'Worldwide':state.name} · ${state.scenes.length} loaded image / data result${state.scenes.length===1?'':'s'} · ${dateLabel(q.start)} – ${dateLabel(q.end)}${hasFailure?' · Coverage check incomplete. See archive status below.':''}`;
    renderSourceStatus(state.sourceResults);renderScenes();if(q.scope!=='point')$('search-notice').textContent='Broad-area results are limited to 300 records per archive before filtering, newest first. Zoom in and search the map area for more local coverage.';
    if(!state.scenes.length){if(!complete){$('scene-list').replaceChildren(empty('Archives could not complete the search','Availability is unknown. Retry to check the archives; no sample results have been substituted.'));}else $('search-notice').textContent='No matches in the checked data. Try a wider time window or higher cloud limit.';}
  }catch(e){if(request!==state.request)return;clearResults('Check your connection and try again.');$('result-summary').textContent='Search unavailable — coverage is unknown.';$('search-notice').textContent=e.name==='AbortError'?'The search timed out. Please try again.':e.message;}
  finally{clearTimeout(timeout);if(request===state.request){$('search-button').disabled=false;$('search-button').replaceChildren(text('span','Find satellite images'),text('span','↗'));}}
}
function orderedScenes(){return [...state.scenes].sort((a,b)=>{
  // Individual captures and composite periods remain separate in time ranking.
  if($('sort').value==='clear')return (cloud(a)??101)-(cloud(b)??101);
  if($('sort').value==='newest')return EW.interval(b).start-EW.interval(a).start;
  const composite=Number(!!EW.interval(a).composite)-Number(!!EW.interval(b).composite);
  return composite||EW.distance(a,state.target)-EW.distance(b,state.target);
});}
function imagePreview(f,detail=false) {const wrap=text('div','','thumb-wrap');const url=previewURL(f);const fallback=()=>{wrap.replaceChildren(text('div','Preview unavailable · Open source assets for imagery','missing-thumb'));};if(url){const img=document.createElement('img');img.src=url;img.alt=`Full-scene preview from ${platform(f)}, ${itemDate(f)}`;img.loading='lazy';img.referrerPolicy='no-referrer';img.onerror=fallback;if(detail){img.className='detail-image';wrap.style.height='auto';}wrap.append(img);}else fallback();if(!detail)wrap.append(text('span',platform(f),'thumb-label'));return wrap;}
function renderScenes() {showResultLocations();$('scene-list').replaceChildren();if(!state.scenes.length){$('scene-list').append(empty('No scenes match this search','Satellites capture on particular passes. Widen the date window or allow more cloud cover, then search again.'));return;}for(const f of orderedScenes().slice(0,state.shown)){const card=text('article','','scene-card'+(state.selected===EW.identity(f)?' selected':''));const button=text('button','','scene-open');button.type='button';button.setAttribute('aria-label',`View ${platform(f)}, ${itemDate(f)}, ${itemTime(f)}`);button.onclick=()=>openScene(f);button.append(imagePreview(f));const body=text('div','','scene-body');body.append(text('h3',platform(f)),text('p',`${itemDate(f)} · ${EW.source(f).agency}`,'scene-provider'));const meta=text('div','','scene-meta');meta.append(text('span',itemTime(f)),text('span',cloudLabel(f),'cloud-pill'));const bottom=text('div','','scene-bottom');bottom.append(text('span',`${EW.bands(f).length} bands / layers`),text('span','Inspect ↗'));body.append(meta,bottom);button.append(body);card.append(button);$('scene-list').append(card);}$('load-more').hidden=state.shown>=state.scenes.length;$('load-more').textContent=`Show more · ${Math.min(state.shown,state.scenes.length)} of ${state.scenes.length}`;}
function openScene(f){
  state.selected=EW.identity(f);renderScenes();
  if(map&&f.geometry){if(footprint)map.removeLayer(footprint);footprint=L.geoJSON(f.geometry,{style:{color:'#b8f56b',weight:2,fillOpacity:.06}}).addTo(map);}
  $('scene-details').replaceChildren(imagePreview(f,true));const content=text('div','','detail-content'),t=EW.interval(f),source=EW.source(f);
  content.append(text('span',t.composite?'COMPOSITE DATA PRODUCT':'SATELLITE CAPTURE','eyebrow'),text('h2',platform(f)+' · '+itemDate(f)));
  const dl=text('dl','','detail-grid');const entries=[['Satellite',platform(f)],['Data provider',`${source.agency} · ${source.region}`],[t.composite?'Product period (UTC)':'Captured (UTC)',t.composite?`${dateLabel(t.start)} – ${dateLabel(t.end)}`:`${dateLabel(t.start)} ${captureTime(t.start)}`],[t.composite?'Temporal detail':'Distance from chosen time',t.composite?`${source.period} · not an exact-time capture`:`${(EW.distance(f,state.target)/3600000).toFixed(1)} hours ${t.start<state.target?'before':'after'}`],['Cloud cover',cloudLabel(f)],['Pixel spacing',resolution(f)],['Collection',f.collection],['Scene / product ID',f.id]];
  for(const [k,v] of entries){const div=text('div','');div.append(text('dt',k),text('dd',v));dl.append(div);}content.append(dl);
  content.append(EarthBands.panel(f));
  content.append(text('p','Previews show the complete source tile. Outlines show where these data were collected. Valid pixels or clear ground are not guaranteed throughout a footprint. The map remains the labelled NASA overview or street map.','detail-note'));
  const links=text('div','','detail-links');
  for(const [label,url] of [['Open supplied image preview ↗',previewURL(f)],['View source metadata ↗',safeURL(f.links?.find(l=>l.rel==='self')?.href)]]){if(url){const a=text('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';links.append(a);}}
  content.append(links);$('scene-details').append(content);$('scene-dialog').showModal();
}
$('find-place').onclick=findPlace;
$('place').addEventListener('input',()=>{state.geoRequest++;$('find-place').disabled=false;state.dirty=true;invalidate();$('place-results').replaceChildren();});
$('place').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();findPlace();}});
$('recenter').onclick=()=>{if(state.scope==='point')map?.setView([state.lat,state.lon],8);else if(state.scope==='world')map?.setView([15,0],1);else if(map){const [w,s,e,n]=state.bounds;map.fitBounds([[s,w],[n,e<w?e+360:e]]);}};
$('world-search').onclick=()=>wholeWorld();
$('area-search').onclick=searchMapArea;
$('map-layer').onchange=updateMapLayer;
$('search-form').onsubmit=search;
for(const id of ['date','time','window','cloud'])$(id).addEventListener('change',invalidate);
$('cloud').addEventListener('input',()=>{$('cloud-value').textContent=$('cloud').value+'%';});
$('sort').onchange=()=>{state.shown=30;renderScenes();};
$('load-more').onclick=()=>{state.shown+=30;renderScenes();};
$('about-open').onclick=()=>$('about-dialog').showModal();
for(const dialog of document.querySelectorAll('dialog')){dialog.querySelector('.close-dialog').onclick=()=>dialog.close();dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});}
$('export').onclick=()=>{const payload={type:'FeatureCollection',search:state.query,retrieved_at:new Date().toISOString(),sources:state.sourceResults,features:orderedScenes()};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/geo+json'}));const a=document.createElement('a');a.href=url;a.download=`earth-window-${state.query.date}.geojson`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
initMap();
loadSources().then(()=>{if(!state.dirty&&state.request===0)search();}).catch(e=>{$('search-notice').textContent=e.message;});
