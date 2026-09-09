const test=require('node:test');
const assert=require('node:assert/strict');
const EW=require('./dist/catalog.js');
const sources=require('./dist/sources.json');
const q={start:'2025-09-10T00:00:00Z',end:'2025-09-10T23:59:59Z',cloud:20};
const feature=(source,props={},assets={})=>EW.attach({id:'synthetic-test-record',collection:source.collection,properties:{datetime:'2025-09-10T10:00:00Z',...props},assets},source);
const asset=(name,wavelength)=>({href:`https://example.com/${name}.tif`,type:'image/tiff; application=geotiff',roles:['data'], 'eo:bands':[{name,common_name:name,center_wavelength:wavelength}]});

test('worldwide search never includes a default location',()=>{
  assert.deepEqual(EW.spatialQuery({scope:'world',lat:32,lon:75}),{});
});
test('points anywhere in the world and regions produce correct geometry',()=>{
  for(const [lat,lon] of [[40.7,-74],[-33.9,151.2],[-90,0],[65,-150]]){
    assert.deepEqual(JSON.parse(EW.spatialQuery({scope:'point',lat,lon}).intersects).coordinates,[lon,lat]);
  }
  assert.equal(EW.spatialQuery({scope:'area',bounds:[-10,35,30,60]}).bbox,'-10,35,30,60');
  const cross=JSON.parse(EW.spatialQuery({scope:'area',bounds:[170,-25,-170,25]}).intersects);
  assert.equal(cross.type,'MultiPolygon');assert.equal(cross.coordinates.length,2);
  assert.throws(()=>EW.spatialQuery({scope:'area',bounds:[NaN,0,1,1]}),/Invalid/);
});

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

const GEO=require('./dist/geocoding.js');
const landmarks=require('./dist/landmarks.json');
test('exact volcano aliases resolve locally and become the correct satellite point query',async()=>{
  for(const query of ['Mount Anak Krakatau','  GUNUNG   ANAK KRAKATAU  ','Anak Krakatoa, Indonesia']){
    const [place]=await GEO.lookup(query,()=>{throw Error('External call unexpected');},landmarks);
    assert.deepEqual(JSON.parse(EW.spatialQuery({scope:'point',...place}).intersects).coordinates,[105.4233,-6.1009]);
  }
  assert.deepEqual(GEO.known('Krakatau',landmarks),[]);
  assert.deepEqual(GEO.known('Mount Anak Krakatau Hotel',landmarks),[]);
});
test('other landmarks use global Photon POI search without a hidden country filter',async()=>{
  const rows=await GEO.lookup('Test mountain',async url=>{
    const u=new URL(url);assert.equal(u.hostname,'photon.komoot.io');
    assert.deepEqual([...u.searchParams.keys()],['q','limit','lang']);
    return {features:[{geometry:{type:'Point',coordinates:[-70.01,-32.65]},properties:{name:'Test mountain',country:'Argentina'}}]};
  });
  assert.equal(rows[0].lon,-70.01);assert.equal(rows[0].display_name,'Test mountain, Argentina');
});
test('city fallback survives Photon failure and outages never become a false no-match',async()=>{
  const get=async url=>{if(url.includes('photon'))throw Error('offline');return {results:[{name:'Tokyo',latitude:35.68,longitude:139.69}]};};
  assert.equal((await GEO.lookup('Tokyo',get))[0].display_name,'Tokyo');
  assert.deepEqual(await GEO.lookup('Unmatched',async url=>url.includes('photon')?{features:[]}:{}),[]);
  await assert.rejects(GEO.lookup('Unavailable',async url=>{if(url.includes('photon'))throw Error('offline');return {};}),/partly unavailable/);
});
test('invalid GeoJSON coordinates are never offered as locations',()=>{
  const features=[[181,0],[0,91],[0,null],[0,true],[]].map(coordinates=>({geometry:{type:'Point',coordinates},properties:{name:'Bad'}}));
  assert.deepEqual(GEO.photon({features}),[]);
});
