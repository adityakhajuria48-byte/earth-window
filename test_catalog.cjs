const test=require('node:test');
const assert=require('node:assert/strict');
const EW=require('./dist/catalog.js');
const sources=require('./dist/sources.json');
const q={start:'2025-09-10T00:00:00Z',end:'2025-09-10T23:59:59Z',cloud:20};
const feature=(source,props={},assets={})=>EW.attach({id:'synthetic-test-record',collection:source.collection,properties:{datetime:'2025-09-10T10:00:00Z',...props},assets},source);
const asset=(name,wavelength)=>({href:`https://example.com/${name}.tif`,type:'image/tiff; application=geotiff',roles:['data'], 'eo:bands':[{name,common_name:name,center_wavelength:wavelength}]});

test('automatic registry includes optical, radar, composite, and international sources',()=>{
  assert.equal(sources.length,6);
  assert.deepEqual(new Set(sources.map(x=>x.region)),new Set(['Europe','United States','Japan']));
  assert.ok(sources.every(s=>s.endpoint.startsWith('https:')));
});
test('cloud filter never drops radar or unknown optical cloud values',()=>{
  assert.equal(EW.matches(feature(sources[0],{'eo:cloud_cover':90}),q),false);
  assert.equal(EW.matches(feature(sources[0]),q),true);
  assert.equal(EW.matches(feature(sources.find(s=>s.id==='s1'),{'eo:cloud_cover':100}),q),true);
});
test('composites use overlapping periods, not fictitious exact captures',()=>{
  const f=feature(sources.find(s=>s.id==='alos'),{datetime:'2025-01-01T00:00:00Z'});
  assert.equal(EW.matches(f,q),true);assert.equal(EW.interval(f).composite,true);
  assert.equal(EW.distance(f,Date.parse(q.start)),0);
  assert.match(EW.requestRange(q,sources.find(s=>s.id==='alos')),/2025-01-01/);
  const m=feature(sources.find(s=>s.id==='modis'),{datetime:'2025-09-05T00:00:00Z'});
  assert.equal(EW.matches(m,q),true);
  assert.equal(EW.matches(feature(sources[0],{datetime:'2025-09-05T00:00:00Z'}),q),false);
});
test('explicit STAC intervals and malformed dates are handled',()=>{
  const f=feature(sources[4],{datetime:null,start_datetime:'2025-09-09T00:00:00Z',end_datetime:'2025-09-16T23:59:59Z'});
  assert.equal(EW.matches(f,q),true);
  assert.equal(EW.interval(feature(sources[0],{datetime:'not-a-date'})),null);
  assert.equal(EW.interval(feature(sources[0],{start_datetime:'2025-09-20',end_datetime:'2025-09-10'})),null);
});
test('only real raster assets become band options; no missing band is fabricated',()=>{
  const f=feature(sources[0],{}, {red:asset('red',.665),nir:asset('nir',.84),thumbnail:{href:'https://example.com/thumbnail.jpg',roles:['thumbnail']},metadata:{href:'https://example.com/meta.xml',roles:['metadata']}});
  const bs=EW.bands(f);assert.deepEqual(bs.map(b=>b.key),['red','nir']);assert.equal(EW.presets(bs).length,0);
});
test('RGB presets require all channels and preserve the intended order',()=>{
  const f=feature(sources[0],{},Object.fromEntries(['red','green','blue','nir','swir16'].map(n=>[n,asset(n)])));
  const ps=EW.presets(EW.bands(f));assert.equal(ps.length,3);
  assert.deepEqual(ps.find(p=>p.id==='vegetation').bands.map(b=>b.key),['nir','red','green']);
  assert.deepEqual(ps.find(p=>p.id==='swir').bands.map(b=>b.key),['swir16','nir','red']);
});
test('band labels prefer source descriptions over inconsistent common names',()=>{
  const a=asset('lwir12',1.24);a.title='Surface Reflectance Band 5 (1230–1250 nm)';
  const b=EW.bands(feature(sources[4],{}, {sur_refl_b05:a}))[0];
  assert.equal(b.common,null);assert.match(b.label,/1230/);
});
test('duplicate Sentinel reprocessing is collapsed only with the same tile and capture',()=>{
  const p={platform:'sentinel-2a','mgrs:utm_zone':43,'mgrs:latitude_band':'S','mgrs:grid_square':'DR'};
  const a=feature(sources[0],p),b=feature(sources[1],p);
  assert.equal(EW.dedupe([a,b]).length,1);
  assert.equal(EW.dedupe([a,feature(sources[1],{...p,'mgrs:grid_square':'DS'})]).length,2);
});
test('URL handling rejects insecure and credential-bearing assets',()=>{
  assert.equal(EW.https('javascript:alert(1)'),null);
  assert.equal(EW.https('https://name:password@example.com/a.tif'),null);
});
const raster=(data)=>({data,width:2,height:1,valid:v=>v!==-9999,lo:0,hi:100,bbox:[0,0,2,1],crs:'same'});
test('single-band stretch is grayscale with transparent no-data pixels',()=>{
  assert.deepEqual(Array.from(EW.stretch([raster([0,100])]).pixels),[0,0,0,255,255,255,255,255]);
  assert.equal(EW.stretch([raster([-9999,100])]).pixels[3],0);
});
test('RGB rendering rejects different grids and preserves channel assignment',()=>{
  assert.throws(()=>EW.stretch([raster([0,100]),{...raster([0,100]),crs:'other'},raster([0,100])]),/different grids/);
  assert.deepEqual(Array.from(EW.stretch([raster([100,0]),raster([0,100]),raster([0,0])]).pixels).slice(0,4),[255,0,0,255]);
});
