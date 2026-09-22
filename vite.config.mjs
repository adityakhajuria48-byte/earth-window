import { defineConfig } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
// Local development uses the same bounded Python importer as the hosted service.
const areaUpload = {name:'local-study-area',configureServer(server){
  server.middlewares.use('/api/aoi',async(req,res)=>{
    const reply=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data));};
    if(req.method!=='POST')return reply(405,{error:'Use the shapefile upload control.'});
    if(req.headers['sec-fetch-site']==='cross-site')return reply(403,{error:'Upload from this website.'});
    if(req.headers['content-type']!=='application/zip')return reply(400,{error:'Expected a ZIP.'});
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>10*1024*1024)return reply(413,{error:'Upload a ZIP smaller than 10 MB.'});chunks.push(chunk);}
    const python=existsSync('.venv/bin/python')?'.venv/bin/python':'python';
    const child=spawn(python,['aoi.py'],{env:{...process.env,PROJ_NETWORK:'OFF'},timeout:30000});
    let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.resume();
    child.stdin.on('error',()=>{});child.stdin.end(Buffer.concat(chunks));
    child.on('error',()=>reply(503,{error:'Install requirements-raster.txt in a .venv to import shapefiles locally.'}));
    child.on('close',code=>{if(res.writableEnded)return;try{reply(code?422:200,JSON.parse(output));}catch{reply(503,{error:'Boundary processing is unavailable. Install requirements-raster.txt in a .venv.'});}});
  });
}};
export default defineConfig({
  plugins:[areaUpload],
  root: 'dist',
  server: {host: '0.0.0.0', allowedHosts: ['terminal.local']},
});
