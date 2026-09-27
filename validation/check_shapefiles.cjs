// Execute the exact reader with the shipped vendor files, not stubbed projections.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {unzipSync}=require('fflate');
const cases=JSON.parse(fs.readFileSync('validation/shapefile-cases.json'));
const fixtures=unzipSync(fs.readFileSync('validation/shapefile-fixtures.zip'));
const runtime={console,TextDecoder,TextEncoder,DataView,Uint8Array,ArrayBuffer,URL};runtime.self=runtime;
vm.createContext(runtime);
for(const name of ['shp-vendor','fflate-vendor','proj4-vendor','aoi-reader'])vm.runInContext(fs.readFileSync('dist/'+name+'.js','utf8'),runtime);
(async()=>{
 for(const item of cases){
  let result,parseError;
  try{result=await runtime.EWAreaReader.parse(fixtures[item.id+'.zip'],runtime.fflate.unzipSync,runtime.shp,runtime.proj4);}catch(error){parseError=error;}
  if(item.reject){assert.ok(parseError,'Invalid ZIP accepted: '+item.id);item.reader='correctly rejected';continue;}
  if(parseError)throw parseError;
  {
   assert.ok(!item.reject,'Invalid ZIP accepted');
   result.bounds.forEach((v,i)=>assert.ok(Math.abs(v-item.expected_bounds[i])<1e-6,`${item.id} bound ${i}: ${v}`));
   assert.equal(result.features,item.features);assert.equal(result.vertices,item.vertices);
   const polys=result.geometry.type==='Polygon'?[result.geometry.coordinates]:result.geometry.coordinates;
   if(item.kind==='hole')assert.equal(polys[0].length,2);
   if(item.kind==='multipart UTM')assert.equal(polys.length,2);
   item.reader='passed';item.geometry=result.geometry;item.bounds=result.bounds;
  }
 }
 fs.writeFileSync('validation/shapefile-results.json',JSON.stringify(cases,null,2)+'\n');
 console.log(JSON.stringify({readerPassed:cases.length,valid:100,invalid:20}));
})().catch(e=>{console.error(e);process.exitCode=1;});
