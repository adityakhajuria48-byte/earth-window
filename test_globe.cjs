const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const globe=require('./dist/globe.js');

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
  const globeStub={active:false,footprints(){},setPosition(...args){calls.push(args);},init(){},bounds:()=>[170,-25,-170,25]};
  const context=vm.createContext({document:{getElementById:get,createElement:element,querySelectorAll:()=>[]},window:{},EWStudio:{init(){},openPanel(){}},EWGlobe:globeStub,EW:require('./dist/catalog.js'),EWGeo:require('./dist/geocoding.js'),URL,URLSearchParams,AbortController,AbortSignal,Date,Blob,setTimeout,clearTimeout,fetch:()=>Promise.reject(Error('No provider requests in integration tests'))});
  vm.runInContext(fs.readFileSync('dist/app.js','utf8'),context);
  return {context,calls,get,globeStub};
}
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
