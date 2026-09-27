importScripts('/shp-vendor.js','/fflate-vendor.js','/proj4-vendor.js','/aoi-reader.js');
self.onmessage=async event=>{
  try { self.postMessage({result:await EWAreaReader.parse(new Uint8Array(event.data),fflate.unzipSync,shp,proj4)}); }
  catch(error){self.postMessage({error:'Could not read this boundary: '+error.message});}
};
