import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from './processor-worker.mjs';
const env={EARTH_WINDOW_PROCESSOR_URL:'https://processor.example',EARTH_WINDOW_PROCESSOR_PASSWORD:'test-secret'};
const request=(path,options={})=>new Request('https://site.example'+path,options);
test('crop gateway requires signed-in identity and refuses cross-origin requests',async()=>{
  assert.equal((await handleRequest(request('/api/crop',{method:'POST'}),env)).status,401);
  assert.equal((await handleRequest(request('/api/crop',{method:'POST',headers:{'oai-authenticated-user-id':'test','Origin':'https://other.example'}}),env)).status,403);
});
test('gateway bounds chunked request bodies before contacting processor',async()=>{
  const response=await handleRequest(request('/api/crop',{method:'POST',headers:{'oai-authenticated-user-id':'test','Content-Type':'application/json'},body:'x'.repeat(8193)}),env);
  assert.equal(response.status,413);
});
test('gateway forwards only its service credential and streams GeoTIFF response',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    assert.equal(url.href,'https://processor.example/api/crop');
    assert.equal(options.headers.Authorization,'Basic '+btoa('earth-window:test-secret'));
    assert.equal(options.headers.Cookie,undefined); assert.equal(options.headers.Origin,undefined);
    assert.equal(new TextDecoder().decode(options.body),'{}');
    return new Response(new Uint8Array([73,73,42,0]),{headers:{'Content-Type':'image/tiff','Set-Cookie':'untrusted=1'}});
  };
  try {
    const response=await handleRequest(request('/api/crop',{method:'POST',headers:{'oai-authenticated-user-id':'test',Origin:'https://site.example','Content-Type':'application/json',Cookie:'private=1'},body:'{}'}),env);
    assert.equal(response.status,200);assert.equal(response.headers.get('Set-Cookie'),null);
    assert.match(response.headers.get('Content-Disposition'),/attachment/); assert.equal((await response.arrayBuffer()).byteLength,4);
  } finally {globalThis.fetch=original;}
});
test('static assets and config never contain the processing password',async()=>{
  const response=await handleRequest(request('/backend-config.js'),env);
  const text=await response.text();assert.match(text,/CROPS = true/);assert.ok(!text.includes('test-secret'));
  const page=await handleRequest(request('/'),env,{'/index.html':{data:'Earth Window',type:'text/html'}});
  assert.equal(await page.text(),'Earth Window');
  assert.equal((await handleRequest(request('/processor-worker.mjs'),env)).status,404);
});

test('area preview uses the same authenticated bounded gateway',async()=>{
 assert.equal((await handleRequest(request('/api/preview',{method:'POST'}),env)).status,401);
 assert.equal((await handleRequest(request('/api/preview',{method:'POST',headers:{'oai-authenticated-user-id':'test',Origin:'https://other.example'}}),env)).status,403);
 assert.equal((await handleRequest(request('/api/preview',{method:'POST',headers:{'oai-authenticated-user-id':'test','Content-Type':'application/json'},body:'x'.repeat(8193)}),env)).status,413);
 const old=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{assert.equal(url.pathname,'/api/preview');assert.equal(options.method,'POST');return Response.json({width:1,height:1,data:[42]});};
 try{const r=await handleRequest(request('/api/preview',{method:'POST',headers:{'oai-authenticated-user-id':'test','Content-Type':'application/json'},body:'{}'}),env);assert.equal(r.status,200);assert.deepEqual((await r.json()).data,[42]);}finally{globalThis.fetch=old;}
});
