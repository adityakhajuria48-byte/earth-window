'use strict';
const EWSurface=(()=>{
  let projectionPromise;
  function projection(){
    if(window.proj4)return Promise.resolve(window.proj4);
    if(!projectionPromise)projectionPromise=new Promise((resolve,reject)=>{
      const s=document.createElement('script'),timer=setTimeout(()=>{s.remove();projectionPromise=null;reject(Error('Map projection library timed out.'));},15000);
      s.src='https://cdn.jsdelivr.net/npm/proj4@2.12.1/dist/proj4.js';
      s.onload=()=>{clearTimeout(timer);window.proj4?resolve(window.proj4):reject(Error('Map projection unavailable.'));};
      s.onerror=()=>{clearTimeout(timer);projectionPromise=null;reject(Error('Map projection unavailable.'));};document.head.append(s);
    });return projectionPromise;
  }
  function definition(epsg){
    if(epsg===4326)return '+proj=longlat +datum=WGS84 +no_defs';
    if(epsg===3857)return 'EPSG:3857';
    if(epsg>=32601&&epsg<=32660)return `+proj=utm +zone=${epsg-32600} +datum=WGS84 +units=m +no_defs`;
    if(epsg>=32701&&epsg<=32760)return `+proj=utm +zone=${epsg-32700} +south +datum=WGS84 +units=m +no_defs`;
    throw Error('This image uses a projection the globe cannot yet reproject. Its band files and local preview remain available.');
  }
  function sharedStretch(a,b){
    if(a.length!==b.length)throw Error('Choose the same display channels for a shared stretch.');
    return a.map((r,i)=>({lo:Math.min(r.lo,b[i].lo),hi:Math.max(r.hi,b[i].hi)}));
  }
  async function project(rasters,limits,signal){
    if(signal.aborted)throw Error('Image loading cancelled.');
    const r=rasters[0];if(!r.mapSafe)throw Error('This raster has a rotated or unsupported grid. Use the source file for accurate mapping.');const proj=await projection(),def=definition(r.epsg);
    const native=proj('EPSG:4326',def),geo=proj(def,'EPSG:4326');
    const [xmin,ymin,xmax,ymax]=r.bbox,edge=[];
    // Densify every edge: projected tile edges are curved in geographic space.
    for(let i=0;i<=32;i++){const t=i/32;edge.push([xmin+(xmax-xmin)*t,ymin],[xmin+(xmax-xmin)*t,ymax],[xmin,ymin+(ymax-ymin)*t],[xmax,ymin+(ymax-ymin)*t]);}
    const ll=edge.map(p=>geo.forward(p));
    if(ll.some(p=>!p.every(Number.isFinite)))throw Error('Invalid image georeferencing.');
    const west=Math.min(...ll.map(p=>p[0])),east=Math.max(...ll.map(p=>p[0])),south=Math.max(-90,Math.min(...ll.map(p=>p[1]))),north=Math.min(90,Math.max(...ll.map(p=>p[1])));
    if(east-west>180||west< -180||east>180||east<=west||north<=south)throw Error('This image crosses a projection boundary. Use its source file for accurate mapping.');
    const stretched=EW.stretch(rasters.map((r,i)=>limits?{...r,...limits[i]}:r));
    const size=768,width=size,height=Math.max(1,Math.min(size,Math.round(size*(north-south)/(east-west))));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(width,height);
    for(let y=0;y<height;y++){
      if(y%64===0){await new Promise(resolve=>setTimeout(resolve,0));if(signal.aborted)throw Error('Image loading cancelled.');}
      const lat=north-(y+.5)*(north-south)/height;
      for(let x=0;x<width;x++){
        const [px,py]=native.forward([west+(x+.5)*(east-west)/width,lat]);
        const sx=Math.floor((px-xmin)/(xmax-xmin)*r.width),sy=Math.floor((ymax-py)/(ymax-ymin)*r.height);
        if(!Number.isFinite(sx)||!Number.isFinite(sy)||sx<0||sy<0||sx>=r.width||sy>=r.height)continue;
        const from=4*(sy*r.width+sx),to=4*(y*width+x);pixels.data.set(stretched.pixels.subarray(from,from+4),to);
      }
    }
    ctx.putImageData(pixels,0,0);
    return {url:canvas.toDataURL('image/png'),bounds:[west,south,east,north],width,height};
  }
  return {definition,sharedStretch,project};
})();
if(typeof module!=='undefined')module.exports=EWSurface;
