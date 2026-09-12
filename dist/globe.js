'use strict';
/* Cesium globe adapter. All imagery and outlines retain their source metadata. */
const EWGlobe = (() => {
  const CDN = 'https://cesium.com/downloads/cesiumjs/releases/1.127/Build/Cesium/';
  let viewer, config, ready=false, active=false, requested=true, loading;
  let place, scenes=[], selected, layerKey='', point, shapes=[];
  let tilted=false, observer, baseLayer, terrainProvider;
  let surfaceLayers=[],surfaceRevision=0;
  const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const status=message=>{const el=document.getElementById('globe-status');el.textContent=message;el.hidden=!message;};
  function rings(geometry) {
    const polygons=!Array.isArray(geometry?.coordinates)?[]:geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.type==='MultiPolygon'?geometry.coordinates:[];
    return polygons.flatMap(p=>Array.isArray(p)?p:[]).filter(r=>Array.isArray(r)&&r.length>=4&&r.every(c=>Array.isArray(c)&&Number.isFinite(c[0])&&Number.isFinite(c[1])&&Math.abs(c[0])<=180&&Math.abs(c[1])<=90));
  }
  function load() {
    if(window.Cesium)return Promise.resolve();
    if(loading)return loading;
    window.CESIUM_BASE_URL=CDN;
    loading=new Promise((resolve,reject)=>{
      const css=document.createElement('link');css.rel='stylesheet';css.href=CDN+'Widgets/widgets.css';document.head.append(css);
      const script=document.createElement('script');script.src=CDN+'Cesium.js';script.async=true;
      const timeout=setTimeout(()=>reject(Error('The 3D globe took too long to load.')),60000);
      script.onload=()=>{clearTimeout(timeout);window.Cesium?resolve():reject(Error('The 3D globe could not start.'));};
      script.onerror=()=>{clearTimeout(timeout);reject(Error('The 3D globe could not download.'));};
      document.head.append(script);
    });
    return loading;
  }
  function render(){if(ready&&active)viewer.scene.requestRender();}
  function move(destination, fly=true, orientation) {
    if(!ready)return;
    viewer.camera.cancelFlight();
    if(fly&&!reduced())viewer.camera.flyTo({destination,orientation,duration:1.5});
    else viewer.camera.setView({destination,orientation});
    render();
  }
  function home(fly=true){
    if(!ready)return;
    tilted=false;document.getElementById('globe-tilt').setAttribute('aria-pressed','false');
    move(Cesium.Cartesian3.fromDegrees(0,15,23000000),fly,{heading:0,pitch:-Math.PI/2,roll:0});
  }
  function setPosition(value, fly=true){
    place=value;
    if(!ready)return;
    if(point)viewer.entities.remove(point);point=null;
    if(value.scope==='point'){
      point=viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(value.lon,value.lat),point:{heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,pixelSize:12,color:Cesium.Color.fromCssColorString('#b8f56b'),outlineColor:Cesium.Color.WHITE,outlineWidth:3,disableDepthTestDistance:0}});
      if(fly)move(Cesium.Cartesian3.fromDegrees(value.lon,value.lat,45000),true,{heading:0,pitch:-Math.PI/2,roll:0});
    }else if(value.scope==='world'&&fly)home();
    else if(value.scope==='area'&&fly&&value.bounds)move(Cesium.Rectangle.fromDegrees(...value.bounds));
    if(fly){tilted=false;document.getElementById('globe-tilt').setAttribute('aria-pressed','false');}
    render();
  }
  function setLayer(kind,date){
    if(!ready)return;
    const key=kind+date;if(key===layerKey)return;layerKey=key;
    status('');if(baseLayer)viewer.imageryLayers.remove(baseLayer,true);
    const street=kind==='streets';
    const provider=new Cesium.UrlTemplateImageryProvider({
      url:street?'https://tile.openstreetmap.org/{z}/{x}/{y}.png':`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
      tilingScheme:new Cesium.WebMercatorTilingScheme(),maximumLevel:street?19:9,
      credit:street?'© OpenStreetMap contributors':'NASA GIBS · Terra / MODIS',enablePickFeatures:false
    });
    provider.errorEvent.addEventListener(()=>{if(key===layerKey)status('Overview tiles could not load. Try another map layer. Archive search is separate.');});
    baseLayer=viewer.imageryLayers.addImageryProvider(provider,0);
    if(!street&&date<'2000-02-24')status('This date predates Terra/MODIS. Choose Street map to locate historical scenes.');
    render();
  }
  function footprints(features,selection){
    scenes=features;selected=selection;if(!ready)return;
    for(const entity of shapes)viewer.entities.remove(entity);shapes=[];
    for(const f of features){
      const isSelected=EW.identity(f)===selection;
      for(const ring of rings(f.geometry)){
        const entity=viewer.entities.add({polyline:{clampToGround:true,positions:Cesium.Cartesian3.fromDegreesArray(ring.flatMap(c=>[c[0],c[1]])),width:isSelected?3:1.5,material:Cesium.Color.fromCssColorString(isSelected?'#ffffff':EW.source(f).kind==='radar'?'#78cef1':'#b8f56b'),arcType:Cesium.ArcType.GEODESIC}});
        entity._ewFeature=f;shapes.push(entity);
      }
    }
    render();
  }
  function bounds(){
    if(!ready||!active)return null;
    const rect=viewer.camera.computeViewRectangle();
    if(!rect)return null;
    return [rect.west,rect.south,rect.east,rect.north].map(Cesium.Math.toDegrees);
  }
  function useMode(is3D){
    requested=is3D;active=is3D&&ready;
    document.getElementById('globe').hidden=!active;
    document.getElementById('map').hidden=active;
    document.getElementById('globe-controls').hidden=!active;
    document.getElementById('globe-guide').hidden=!active;
    document.getElementById('view-3d').setAttribute('aria-pressed',String(active));
    document.getElementById('view-2d').setAttribute('aria-pressed',String(!active));
    document.getElementById('view-label').textContent=active?'3D GLOBE':'2D MAP';
    if(ready){viewer.useDefaultRenderLoop=active&&!document.hidden;if(active){viewer.resize();render();}}
    config.onMode(active);
    if(window.EWStudio)EWStudio.onMode(active);
  }
  function setTerrain(enabled){
    if(!ready)return;
    const note=document.getElementById('terrain-status');
    if(enabled){
      note.textContent='Loading terrain elevation…';
      terrainProvider=EWTerrain.create(Cesium,message=>{if(viewer.terrainProvider===terrainProvider)note.textContent=message;});
      viewer.terrainProvider=terrainProvider;
    }else{viewer.terrainProvider=new Cesium.EllipsoidTerrainProvider();note.textContent='Terrain off · Smooth ellipsoid';}
    render();
  }
  function setExaggeration(value){if(ready){viewer.scene.verticalExaggeration=Number(value);render();}}
  function clearSurfaces(){
    surfaceRevision++;
    if(ready)for(const layer of surfaceLayers)viewer.imageryLayers.remove(layer,true);
    surfaceLayers=[];
    document.getElementById('swipe-line').hidden=true;
    document.getElementById('swipe-labels').hidden=true;render();
  }
  function setSplit(value){if(ready){viewer.scene.splitPosition=Number(value)/100;render();}document.getElementById('swipe-line').style.left=value+'%';}
  function setComparison(enabled){
    if(!ready)return;
    surfaceLayers.forEach((layer,i)=>{layer.splitDirection=enabled?(i===0?Cesium.SplitDirection.LEFT:Cesium.SplitDirection.RIGHT):Cesium.SplitDirection.NONE;layer.show=enabled||i===0;});
    document.getElementById('swipe-line').hidden=!enabled||surfaceLayers.length<2;
    document.getElementById('swipe-labels').hidden=!enabled||surfaceLayers.length<2;render();
  }
  async function showSurfaces(entries,compare,fly=true){
    if(!ready)throw Error('The 3D globe is unavailable. Try refreshing or open the original band files.');
    useMode(true);clearSurfaces();const revision=surfaceRevision;
    try{
      for(const entry of entries){
        let provider;
        if(entry.kind==='overview'){
          provider=new Cesium.UrlTemplateImageryProvider({url:`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${entry.date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,maximumLevel:9,tilingScheme:new Cesium.WebMercatorTilingScheme(),credit:'NASA GIBS · Terra/MODIS '+entry.date,enablePickFeatures:false});
        }else provider=await Cesium.SingleTileImageryProvider.fromUrl(entry.url,{rectangle:Cesium.Rectangle.fromDegrees(...entry.bounds),credit:entry.credit});
        if(revision!==surfaceRevision)return;
        provider.errorEvent.addEventListener(()=>{if(revision===surfaceRevision)document.getElementById('overlay-status').textContent='An image layer could not load. Availability for this comparison is incomplete.';});
        surfaceLayers.push(viewer.imageryLayers.addImageryProvider(provider));
      }
      if(revision!==surfaceRevision)return;
      setComparison(compare);setSplit(document.getElementById('swipe').value);
      if(fly&&entries[0]?.bounds)move(Cesium.Rectangle.fromDegrees(...entries[0].bounds));
      render();
    }catch(e){if(revision===surfaceRevision)clearSurfaces();throw e;}
  }
  async function init(options){
    config=options;
    document.getElementById('view-2d').onclick=()=>{status('');useMode(false);};
    document.getElementById('view-3d').onclick=()=>{if(ready){status('');useMode(true);}else init(config);};
    document.getElementById('view-3d').disabled=true;status('Preparing the 3D globe…');
    try{
      await load();
      document.getElementById('globe').hidden=false;
      const viewerOptions={animation:false,timeline:false,baseLayerPicker:false,baseLayer:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,fullscreenButton:false,selectionIndicator:false,infoBox:false,terrainProvider:new Cesium.EllipsoidTerrainProvider(),requestRenderMode:true,maximumRenderTimeChange:Infinity,shouldAnimate:false,skyBox:false,skyAtmosphere:new Cesium.SkyAtmosphere(),showRenderLoopErrors:false};
      try{viewer=new Cesium.Viewer('globe',viewerOptions);}catch(error){
        if(!/WebGL/.test(error.message))throw error;
        document.getElementById('globe').replaceChildren();
        viewer=new Cesium.Viewer('globe',{...viewerOptions,contextOptions:{requestWebgl1:true,webgl:{antialias:false}}});
      }
      ready=true;
      viewer.scene.backgroundColor=Cesium.Color.fromCssColorString('#050d16');
      viewer.scene.globe.baseColor=Cesium.Color.fromCssColorString('#183a4b');
      viewer.scene.globe.enableLighting=false;
      viewer.scene.screenSpaceCameraController.minimumZoomDistance=250;
      viewer.scene.screenSpaceCameraController.maximumZoomDistance=40000000;
      viewer.scene.screenSpaceCameraController.enableCollisionDetection=true;
      viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      viewer.screenSpaceEventHandler.setInputAction(event=>{
        const hit=viewer.scene.pick(event.position);
        if(hit?.id?._ewFeature){config.onScene(hit.id._ewFeature);return;}
        const ray=viewer.camera.getPickRay(event.position);const p=ray&&viewer.scene.globe.pick(ray,viewer.scene);if(!p)return;
        const c=Cesium.Cartographic.fromCartesian(p);config.onPoint(Cesium.Math.toDegrees(c.latitude),Cesium.Math.toDegrees(c.longitude));
      },Cesium.ScreenSpaceEventType.LEFT_CLICK);
      viewer.scene.renderError.addEventListener(()=>{useMode(false);status('3D rendering stopped. The 2D map and imagery search remain available.');});
      viewer.canvas.setAttribute('aria-label','3D Earth. Drag to rotate, scroll to zoom. Use the buttons for keyboard navigation.');
      viewer.canvas.addEventListener('webglcontextlost',()=>{useMode(false);status('3D graphics became unavailable. Continue in 2D or refresh to retry.');});
      document.getElementById('globe-home').onclick=()=>home();
      document.getElementById('globe-in').onclick=()=>{viewer.camera.zoomIn(viewer.camera.positionCartographic.height*.4);render();};
      document.getElementById('globe-out').onclick=()=>{viewer.camera.zoomOut(viewer.camera.positionCartographic.height*.6);render();};
      document.getElementById('globe-tilt').onclick=()=>{
        const center=new Cesium.Cartesian2(viewer.canvas.clientWidth/2,viewer.canvas.clientHeight/2);
        const ray=viewer.camera.getPickRay(center);const target=ray&&viewer.scene.globe.pick(ray,viewer.scene);if(!target)return;
        tilted=!tilted;document.getElementById('globe-tilt').setAttribute('aria-pressed',String(tilted));
        const range=Cesium.Cartesian3.distance(viewer.camera.positionWC,target);
        viewer.camera.lookAt(target,new Cesium.HeadingPitchRange(0,tilted?-Math.PI/4:-Math.PI/2,range));
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);render();
      };
      for(const [id,direction] of [['globe-west',-1],['globe-east',1]])document.getElementById(id).onclick=()=>{viewer.camera.rotateRight(direction*Math.PI/12);render();};
      document.addEventListener('visibilitychange',()=>{viewer.useDefaultRenderLoop=active&&!document.hidden;render();});
      observer=new ResizeObserver(()=>{if(active){viewer.resize();render();}});observer.observe(document.getElementById('globe'));
      home(false);if(place)setPosition(place,place.scope!=='world');footprints(scenes,selected);
      status('');useMode(requested);
      setTerrain(document.getElementById('terrain-toggle').checked);
      document.getElementById('terrain-toggle').onchange=e=>setTerrain(e.target.checked);
      document.getElementById('terrain-scale').onchange=e=>setExaggeration(e.target.value);
      config.onReady();
    }catch(error){console.error('Earth Window globe: '+error.message+' '+error.stack);if(viewer&&!viewer.isDestroyed())viewer.destroy();viewer=null;ready=false;loading=null;useMode(false);status('3D could not load. Select 3D globe to retry, or continue with the 2D map.');document.getElementById('terrain-status').textContent='Terrain unavailable until 3D loads.';}
    finally{document.getElementById('view-3d').disabled=false;}
  }
  return {init,setPosition,setLayer,footprints,bounds,home,rings,showSurfaces,clearSurfaces,setComparison,setSplit,get active(){return active;}};
})();
if(typeof module!=='undefined')module.exports=EWGlobe;
