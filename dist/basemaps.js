'use strict';
const EWBasemaps=(()=>{
  const worldImagery='https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
  const worldTerrain='https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer';
  function layer(kind,date){
    if(kind==='detailed')return {url:worldImagery+'/tile/{z}/{y}/{x}?blankTile=false',maxLevel:19,credit:'Esri, Vantor, Earthstar Geographics, and the GIS User Community',title:'Esri World Imagery · Reference',note:'Mixed acquisition dates · Detail varies by location · Not your selected capture'};
    if(kind==='streets')return {url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',maxLevel:19,credit:'© OpenStreetMap contributors',title:'OpenStreetMap · Reference map',note:'Reference only · Not capture-date imagery'};
    if(kind==='reference')return {url:'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',maxLevel:8,credit:'NASA GIBS · Blue Marble reference mosaic',title:'NASA Blue Marble · Reference mosaic',note:'Global reference · Not capture-date imagery'};
    if(kind==='nasa')return {url:`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,maxLevel:9,credit:'NASA GIBS · Terra / MODIS',title:'Terra / MODIS · Daily overview',note:date+' · Daily mosaic · Not a selected scene'};
    throw Error('Unknown map layer.');
  }
  function parentTile(coords,depth){
    const scale=2**depth;
    return {z:coords.z-depth,x:Math.floor(coords.x/scale),y:Math.floor(coords.y/scale),sx:(coords.x%scale)/scale,sy:(coords.y%scale)/scale,fraction:1/scale};
  }
  function detailedLayer(L,options){
    // Missing fine tiles must retain real coarser imagery, not provider placeholder squares.
    const Tiles=L.GridLayer.extend({createTile(coords,done){
      const canvas=document.createElement('canvas');canvas.width=canvas.height=256;canvas.dataset.requestedZoom=String(coords.z);
      let img,timer,depth=0,stopped=false;
      const cancelLoad=()=>{clearTimeout(timer);if(img){img.onload=img.onerror=null;img.removeAttribute('src');}};
      canvas._ewCancel=()=>{stopped=true;cancelLoad();};
      const load=()=>{
        cancelLoad();
        const p=parentTile(coords,depth),current=img=new Image();current.crossOrigin='anonymous';
        const failed=()=>{
          if(stopped||current!==img)return;
          if(depth<Math.min(coords.z,6)){depth++;load();}
          else{canvas._ewCancel();done(Error('Reference imagery unavailable'),canvas);}
        };
        current.onload=()=>{
          if(stopped||current!==img)return;
          clearTimeout(timer);
          const ctx=canvas.getContext('2d');
          // Scale the whole parent and let the canvas clip it. Cropping first clamps
          // the interpolation at child edges and creates seams at large overzoom.
          const size=256/p.fraction;
          ctx.drawImage(current,-p.sx*size,-p.sy*size,size,size);
          canvas.dataset.sourceZoom=String(p.z);stopped=true;done(null,canvas);
        };
        current.onerror=failed;
        // A stalled request must not prevent a real parent tile from filling the map.
        timer=setTimeout(failed,12000);
        current.src=L.Util.template(layer('detailed').url,p);
      };
      load();return canvas;
    }});
    const tiles=new Tiles(options);
    tiles.on('tileunload',e=>e.tile._ewCancel?.());
    return tiles;
  }
  return {worldImagery,worldTerrain,layer,parentTile,detailedLayer};
})();
if(typeof module!=='undefined')module.exports=EWBasemaps;
