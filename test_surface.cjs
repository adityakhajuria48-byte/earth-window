const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const terrain=require('./dist/terrain.js');
const surface=require('./dist/surface.js');
const EW=require('./dist/catalog.js');

test('Terrarium decoding preserves sea level, negative relief and fractional heights',()=>{
  assert.equal(terrain.decode(128,0,0),0);
  assert.equal(terrain.decode(127,255,128),-.5);
  assert.equal(terrain.decode(131,232,64),1000.25);
  const rgba=new Uint8Array([128,0,0,255,128,1,0,255,127,255,0,255,128,2,128,255]);
  assert.deepEqual([...terrain.grid(rgba,2,2,2)],[0,1,-1,2.5]);
});

test('comparison uses common channel limits without mutating either source raster',()=>{
  const a=[{lo:5,hi:10},{lo:1,hi:5},{lo:-2,hi:9}],b=[{lo:2,hi:8},{lo:3,hi:8},{lo:-5,hi:11}];
  assert.deepEqual(surface.sharedStretch(a,b),[{lo:2,hi:10},{lo:1,hi:8},{lo:-5,hi:11}]);
  assert.equal(a[0].lo,5);
  assert.throws(()=>surface.sharedStretch(a,[b[0]]),/same display channels/);
});

function projectionEnvironment(){
  let pixels;
  const context=vm.createContext({window:{proj4:()=>({forward:p=>p})},EW,setTimeout,clearTimeout,document:{createElement:()=>({getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:p=>{pixels=p.data;}}),toDataURL:()=> 'data:image/png;base64,test'})}});
  vm.runInContext(fs.readFileSync('dist/surface.js','utf8'),context);
  return {api:vm.runInContext('EWSurface',context),pixels:()=>pixels};
}
const raster=()=>({data:new Float32Array([0,100,50,-9999]),width:2,height:2,lo:0,hi:100,valid:v=>v!==-9999,bbox:[10,20,12,22],crs:'4326',epsg:4326,mapSafe:true});
test('geographic reprojection keeps north at the top, longitude order and transparent no-data',async()=>{
  const env=projectionEnvironment(),out=await env.api.project([raster()],null,new AbortController().signal);
  assert.deepEqual(Array.from(out.bounds),[10,20,12,22]);
  const p=env.pixels(),at=(x,y)=>Array.from(p.slice((y*out.width+x)*4,(y*out.width+x)*4+4));
  assert.deepEqual(at(0,0),[0,0,0,255]);
  assert.deepEqual(at(out.width-1,0),[255,255,255,255]);
  assert.deepEqual(at(0,out.height-1),[128,128,128,255]);
  assert.equal(at(out.width-1,out.height-1)[3],0);
});
test('unsupported projections, rotated grids, dateline tiles and cancellation are explicit',async()=>{
  const {api}=projectionEnvironment(),signal=new AbortController().signal;
  assert.match(api.definition(32748),/zone=48 .*south/);
  assert.match(api.definition(32601),/zone=1 /);
  await assert.rejects(api.project([{...raster(),epsg:32767}],null,signal),/projection/);
  await assert.rejects(api.project([{...raster(),mapSafe:false}],null,signal),/rotated/);
  await assert.rejects(api.project([{...raster(),bbox:[179,20,181,22]}],null,signal),/boundary/);
  const aborted=new AbortController();aborted.abort();
  await assert.rejects(api.project([raster()],null,aborted.signal),/cancelled/);
});
test('before/after ordering excludes overlapping composite periods',()=>{
  const context=vm.createContext({window:{},EW});
  vm.runInContext(fs.readFileSync('dist/studio.js','utf8'),context);
  const {chronological}=context.window.EWStudio;
  const f=(start,end)=>({properties:{start_datetime:start,end_datetime:end}});
  assert.equal(chronological(f('2024-08-28','2024-09-04'),f('2024-09-05','2024-09-12')),true);
  assert.equal(chronological(f('2024-08-28','2024-09-04'),f('2024-09-04','2024-09-12')),false);
  assert.equal(chronological(f('2024-09-05','2024-09-12'),f('2024-08-28','2024-09-04')),false);
});
