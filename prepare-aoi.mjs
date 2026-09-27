import {copyFile,readFile,writeFile} from 'node:fs/promises';
await copyFile('node_modules/shpjs/dist/shp.min.js','dist/shp-vendor.js');
await copyFile('node_modules/fflate/umd/index.js','dist/fflate-vendor.js');
await copyFile('node_modules/proj4/dist/proj4.js','dist/proj4-vendor.js');
const notices=[];
for(const [name,file] of [['shpjs','LICENSE.md'],['fflate','LICENSE'],['proj4','LICENSE.md']])notices.push(name+'\n'+await readFile('node_modules/'+name+'/'+file,'utf8'));
await writeFile('dist/boundary-reader-licenses.txt',notices.join('\n\n'));
