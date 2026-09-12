'use strict';
const EWTerrain=(()=>{
  const decode=(r,g,b)=>r*256+g+b/256-32768;
  function grid(pixels,width,height,size=65){
    const buffer=new Float32Array(size*size);
    // Decode original PNG pixels before sampling: interpolating RGB would corrupt heights.
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const i=4*(Math.round(y*(height-1)/(size-1))*width+Math.round(x*(width-1)/(size-1)));
      buffer[y*size+x]=decode(pixels[i],pixels[i+1],pixels[i+2]);
    }
    return buffer;
  }
  function create(C,onStatus){
    const scheme=new C.WebMercatorTilingScheme(),errorEvent=new C.Event(),size=65,maxLevel=13;
    const error=C.TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(scheme.ellipsoid,size,scheme.getNumberOfXTilesAtLevel(0));
    let good=false,failed=false;
    return {
      tilingScheme:scheme,errorEvent,hasWaterMask:false,hasVertexNormals:false,availability:undefined,
      credit:new C.Credit('<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank">Terrain: Mapzen / USGS and other providers</a>'),
      getLevelMaximumGeometricError:level=>error/Math.pow(2,level),
      getTileDataAvailable:(x,y,level)=>level<=maxLevel,
      loadTileDataAvailability:()=>undefined,
      requestTileGeometry(x,y,level,request){
        const resource=new C.Resource({url:`https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${level}/${x}/${y}.png`,request});
        const pending=resource.fetchImage({preferImageBitmap:true});if(!pending)return undefined;
        return pending.then(image=>{
          const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
          const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
          const values=grid(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,size);
          image.close?.();
          if(!good){good=true;onStatus('Terrain on · Mapzen elevation');}
          return new C.HeightmapTerrainData({buffer:values,width:size,height:size,childTileMask:level<maxLevel?15:0});
        }).catch(e=>{
          if(!failed){failed=true;onStatus('Terrain tiles unavailable · Turn terrain off to use the ellipsoid.');}
          errorEvent.raiseEvent({message:'Terrain tile unavailable',x,y,level,error:e});throw e;
        });
      }
    };
  }
  return {decode,grid,create};
})();
if(typeof module!=='undefined')module.exports=EWTerrain;
