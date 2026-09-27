/* Local boundary parser shared by the browser worker and regression runner. */
(function(root){
  'use strict';
  function validateZip(bytes,unzip){
    if(!bytes.length||bytes.length>10*1024*1024)throw Error('Choose a shapefile ZIP smaller than 10 MB.');
    const entries=new Map();let expanded=0,count=0;
    unzip(bytes,{filter:file=>{
      expanded+=file.originalSize;count++;
      if(count>100||expanded>40*1024*1024)throw Error('ZIP is too large when unpacked. Export a smaller layer.');
      const name=file.name.replace(/\\/g,'/').toLowerCase();
      if(name.startsWith('/')||name.split('/').includes('..'))throw Error('The ZIP contains an invalid path.');
      if(name.endsWith('/')||name.split('/').some(p=>p.startsWith('.')||p==='__macosx'))return false;
      if(entries.has(name))throw Error('Duplicate filenames in ZIP.');entries.set(name,file.name);return false;
    }});
    const layers=[...entries.keys()].filter(n=>n.endsWith('.shp'));
    if(layers.length!==1)throw Error('ZIP exactly one polygon layer at a time.');
    const stem=layers[0].slice(0,-4);
    if(['.shx','.dbf','.prj'].some(ext=>!entries.has(stem+ext)))throw Error('Include matching .shp, .shx, .dbf and .prj files in the ZIP.');
    const wanted=new Set([entries.get(stem+'.shp'),entries.get(stem+'.prj')]);
    const data=unzip(bytes,{filter:file=>wanted.has(file.name)});
    const shp=data[entries.get(stem+'.shp')],prj=new TextDecoder().decode(data[entries.get(stem+'.prj')]).trim();
    if(!prj)throw Error('The .prj is empty. Export the layer with its coordinate system.');
    const view=new DataView(shp.buffer,shp.byteOffset,shp.byteLength);let offset=100,vertices=0,features=0;
    if(shp.length<100||view.getInt32(0)!==9994)throw Error('Invalid shapefile header.');
    while(offset<shp.length){
      if(offset+12>shp.length)throw Error('Truncated shapefile record.');
      const size=view.getInt32(offset+4)*2,kind=view.getInt32(offset+8,true);
      if(size<4||offset+8+size>shp.length)throw Error('Truncated shapefile record.');
      if(kind!==0){
        if(![5,15,25].includes(kind)||size<44)throw Error('Choose polygon boundaries; points and lines do not define an image area.');
        const parts=view.getInt32(offset+44,true),points=view.getInt32(offset+48,true);
        vertices+=points;features++;
        if(parts<1||points<parts||size<44+4*parts+16*points)throw Error('Invalid polygon record.');
        if(vertices>20000||features>500)throw Error('Simplify to 20,000 vertices and 500 polygon features or fewer.');
      }
      offset+=8+size;
    }
    if(!features)throw Error('The layer contains no polygon boundaries.');
    return {shp,prj,name:stem.split('/').at(-1)};
  }
  function normalize(collection,name){
    if(Array.isArray(collection))throw Error('Choose one polygon layer.');
    const polygons=[];let features=0,vertices=0,skipped=0;
    const bounds=[Infinity,Infinity,-Infinity,-Infinity];
    for(const f of collection.features||[]){
      const g=f.geometry;if(!g){skipped++;continue;}
      if(!['Polygon','MultiPolygon'].includes(g.type))throw Error('Only polygon boundaries are supported.');
      features++;
      for(const poly of g.type==='Polygon'?[g.coordinates]:g.coordinates){
        if(!poly.length)throw Error('Empty polygon.');
        for(const ring of poly){
          if(ring.length<4)throw Error('A polygon ring has too few coordinates.');
          for(const c of ring){
            vertices++;if(!Number.isFinite(c[0])||!Number.isFinite(c[1])||Math.abs(c[0])>180||Math.abs(c[1])>90)throw Error('Coordinates are outside WGS 84. Check the .prj file.');
            bounds[0]=Math.min(bounds[0],c[0]);bounds[1]=Math.min(bounds[1],c[1]);bounds[2]=Math.max(bounds[2],c[0]);bounds[3]=Math.max(bounds[3],c[1]);
          }
          if(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])throw Error('Unclosed polygon ring. Repair it in GIS.');
        }
        polygons.push(poly.map(r=>r.map(c=>c.slice(0,2))));
      }
    }
    if(!features||vertices>20000||features>500)throw Error('Use 1–500 polygons and at most 20,000 vertices.');
    if(bounds[0]>=bounds[2]||bounds[1]>=bounds[3])throw Error('The boundary has no area.');
    if(bounds[2]-bounds[0]>180)throw Error('Split date-line regions into east and west layers.');
    return {name,geometry:polygons.length===1?{type:'Polygon',coordinates:polygons[0]}:{type:'MultiPolygon',coordinates:polygons},bounds,features,vertices,skipped,sourceCRS:'File CRS',crs:'EPSG:4326'};
  }
  async function parse(bytes,unzip,shp,proj4){
    const input=validateZip(bytes,unzip);let projection;
    try{projection=proj4(input.prj,'EPSG:4326');}catch{throw Error('Unsupported or invalid .prj. Export the layer as WGS 84 (EPSG:4326) in GIS.');}
    const collection=await shp({shp:input.shp});
    function project(coords){return typeof coords[0]==='number'?projection.forward(coords.slice(0,2)):coords.map(project);}
    for(const feature of collection.features||[])if(feature.geometry)feature.geometry.coordinates=project(feature.geometry.coordinates);
    return normalize(collection,input.name);
  }
  const api={validateZip,normalize,parse};root.EWAreaReader=api;if(typeof module!=='undefined')module.exports=api;
})(typeof self!=='undefined'?self:globalThis);
