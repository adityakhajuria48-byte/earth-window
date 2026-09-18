import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.zip':'application/zip'};
const assets={};
for(const file of await readdir('dist')) {
  const ext=path.extname(file); if(!types[ext] || file==='backend-config.js') continue;
  const data=await readFile(path.join('dist',file)), binary=ext==='.zip';
  assets['/'+file]={type:types[ext],binary,data:data.toString(binary?'base64':'utf8')};
}
await mkdir('dist/server',{recursive:true});
await writeFile('dist/server/index.js',await readFile('processor-worker.mjs','utf8')+'\nconst assets = '+JSON.stringify(assets)+';\nexport default {fetch(request,env){return handleRequest(request,env,assets);}};\n');
console.log('Built authenticated crop gateway and '+Object.keys(assets).length+' website assets.');
