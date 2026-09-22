const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const globe=require('./dist/globe.js');
const basemaps=require('./dist/basemaps.js');

test('detailed reference tiles refine beyond overview imagery without claiming capture dates',()=>{
  const detailed=basemaps.layer('detailed','2024-01-01');
  assert.equal(detailed.maxLevel,19);assert.match(detailed.url,/blankTile=false/);
  assert.ok(!detailed.url.includes('2024-01-01'));assert.match(detailed.note,/Mixed acquisition dates/);
  assert.equal(basemaps.layer('reference').maxLevel,8);
  assert.match(basemaps.layer('nasa','2024-01-01').url,/2024-01-01/);
});
test('missing fine reference tiles select the correct quadrant of real parent imagery',()=>{
  assert.deepEqual(basemaps.parentTile({x:11,y:6,z:10},1),{x:5,y:3,z:9,sx:.5,sy:0,fraction:.5});
  assert.deepEqual(basemaps.parentTile({x:11,y:6,z:10},2),{x:2,y:1,z:8,sx:.75,sy:.5,fraction:.25});
});
test('a stalled map tile falls back and unloaded tiles cannot publish late results',()=>{
  const images=[],timers=new Map(),draws=[];let next=0;
  const context=vm.createContext({document:{createElement:()=>({dataset:{},getContext:()=>({drawImage(...args){draws.push(args);}})})},Image:class{constructor(){images.push(this);this.width=this.height=256;}removeAttribute(){}},setTimeout:f=>{timers.set(++next,f);return next;},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(fs.readFileSync('dist/basemaps.js','utf8'),context);
  const L={GridLayer:{extend:methods=>class{constructor(){Object.assign(this,methods);}on(name,fn){this.unload=fn;}}},Util:{template:(url,p)=>url.replace(/\{(\w+)\}/g,(_,k)=>p[k])}};
  const layer=vm.runInContext('EWBasemaps',context).detailedLayer(L,{});let completed=0;
  const tile=layer.createTile({x:11,y:6,z:19},error=>{assert.equal(error,null);completed++;});
  const late=images[0].onload;timers.values().next().value();
  assert.match(images[1].src,/tile\/18\/3\/5\?/);late();assert.equal(completed,0);
  images[1].onload();assert.equal(tile.dataset.sourceZoom,'18');assert.equal(completed,1);assert.equal(timers.size,0);
  assert.deepEqual(draws[0].slice(1),[-256,-0,512,512]);
  const nextTile=layer.createTile({x:11,y:6,z:19},()=>{throw Error('Unloaded tile completed');});
  const unloaded=images[2].onload;layer.unload({tile:nextTile});unloaded();assert.equal(timers.size,0);
});

test('zoom uses clearance above terrain, respects exaggeration and never crosses its near limit',()=>{
  // Old sea-level step: 8500 * .4 = 3400 m, despite only 500 m above a mountain.
  assert.equal(globe.zoomAmount(8500,8000,true),125);
  assert.equal(globe.zoomAmount(8250,8000,true),0);
  assert.equal(globe.zoomAmount(8100,8000,true),0);
  assert.equal(globe.zoomAmount(24500,8000,true,3),125);
  assert.equal(globe.zoomAmount(24250,8000,true,3),0);
  assert.equal(globe.zoomAmount(1000,500,true,2,250),0);
  assert.equal(globe.zoomAmount(NaN,0,true),0);
  assert.equal(globe.zoomAmount(8500,undefined,true),0);
});
test('zoom out remains available below terrain and stops at the orbit limit',()=>{
  assert.equal(globe.zoomAmount(7000,8000,false),250);
  assert.equal(globe.zoomAmount(39999900,0,false),100);
  assert.equal(globe.zoomAmount(40000000,0,false),0);
});

test('globe footprints accept polygons, holes and dateline multipolygons without swapping coordinates',()=>{
  const ring=[[170,-10],[180,-10],[180,10],[170,-10]];
  const other=[[-180,-10],[-170,-10],[-170,10],[-180,-10]];
  assert.deepEqual(globe.rings({type:'MultiPolygon',coordinates:[[ring],[other]]}),[ring,other]);
  assert.deepEqual(globe.rings({type:'Polygon',coordinates:[ring,other]}),[ring,other]);
  assert.deepEqual(globe.rings({type:'Polygon'}),[]);
  assert.deepEqual(globe.rings({type:'Polygon',coordinates:[[[NaN,0],[0,0],[0,1],[NaN,0]]]}),[]);
});

function environment(){
  const elements=new Map();
  const element=()=>({value:'',textContent:'',hidden:false,disabled:false,attrs:{},children:[],append(...x){this.children.push(...x);},replaceChildren(...x){this.children=x;},setAttribute(k,v){this.attrs[k]=v;},addEventListener(){}});
  const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const calls=[];
  const globeStub={active:false,footprints(){},setPosition(...args){calls.push(args);},init(options){this.options=options;},bounds:()=>[170,-25,-170,25]};
  const context=vm.createContext({document:{getElementById:get,createElement:element,querySelectorAll:()=>[]},window:{},EWStudio:{init(){},openPanel(){}},EWGlobe:globeStub,EW:require('./dist/catalog.js'),EWGeo:require('./dist/geocoding.js'),URL,URLSearchParams,AbortController,AbortSignal,Date,Blob,setTimeout,clearTimeout,fetch:()=>Promise.reject(Error('No provider requests in integration tests'))});
  vm.runInContext(fs.readFileSync('dist/app.js','utf8'),context);
  return {context,calls,get,globeStub};
}
test('failed 3D startup preserves 2D zoom; explicitly leaving 3D recentres the selected place',()=>{
  const {context,globeStub}=environment(),views=[];
  vm.runInContext("setPlace(32.916,75.141,'Udhampur')",context);
  context.mapStub={invalidateSize(){},setView(...args){views.push(args);}};
  vm.runInContext('map=mapStub;updateMapLayer=()=>{};',context);
  globeStub.options.onMode(false);assert.equal(views.length,0);
  globeStub.options.onMode(true);globeStub.options.onMode(false);
  assert.equal(views.length,1);assert.deepEqual(Array.from(views[0][0]),[32.916,75.141]);assert.equal(views[0][1],8);
});
test('actual app place selection forwards Anak Krakatau to the globe and preserves satellite query coordinates',()=>{
  const {context,calls,get}=environment();
  get('date').value='2025-09-10';get('time').value='12:00';get('window').value='7';get('cloud').value='40';
  vm.runInContext("setPlace(-6.1009,105.4233,'Anak Krakatau, Indonesia')",context);
  assert.equal(calls.length,1);assert.equal(calls[0][0].lat,-6.1009);assert.equal(calls[0][0].lon,105.4233);assert.equal(calls[0][1],true);
  const q=vm.runInContext('searchParams()',context);assert.equal(q.scope,'point');assert.equal(q.lon,105.4233);
  vm.runInContext('wholeWorld(false)',context);assert.equal(calls.at(-1)[0].scope,'world');
});
test('globe region search keeps dateline bounds and clearing the location remains worldwide',()=>{
  const {context,globeStub}=environment();globeStub.active=true;
  vm.runInContext('search = () => {}; searchMapArea()',context);
  const geometry=JSON.parse(vm.runInContext('EW.spatialQuery(state).intersects',context));
  assert.equal(geometry.type,'MultiPolygon');assert.equal(geometry.coordinates.length,2);
  vm.runInContext('wholeWorld(false)',context);
  assert.equal(vm.runInContext('JSON.stringify(EW.spatialQuery(state))',context),'{}');
});

test('shapefile query sends polygon holes by POST and follows POST pagination',async()=>{
  const {context}=environment(),sent=[];
  const geometry={type:'Polygon',coordinates:[[[0,0],[3,0],[3,3],[0,3],[0,0]],[[1,1],[1,2],[2,2],[2,1],[1,1]]]};
  context.geometry=geometry;
  context.fetch=async(url,options)=>{sent.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({features:[],links:sent.length===1?[{rel:'next',href:'https://catalog.example/search',method:'POST',body:{token:'next'},merge:true}]:[]})};};
  const result=await vm.runInContext("fetchSource({scope:'area',geometry,start:'2025-01-01',end:'2025-01-02'}, {id:'test',name:'Test',collection:'test',endpoint:'https://catalog.example/search'}, new AbortController().signal)",context);
  assert.equal(result.status,'complete');assert.equal(sent.length,2);
  assert.deepEqual(sent[0].body.intersects,geometry);assert.equal(sent[0].body.bbox,undefined);
  assert.deepEqual(sent[1].body.intersects,geometry);assert.equal(sent[1].body.token,'next');
  vm.runInContext('state.geometry=geometry;wholeWorld(false)',context);
  assert.equal(vm.runInContext('state.geometry',context),null);
  vm.runInContext("state.geometry=geometry;setPlace(1,2,'test')",context);
  assert.equal(vm.runInContext('state.geometry',context),null);
});
