(function(root){
  root.EWArea={read(file,signal){return new Promise((resolve,reject)=>{
    const worker=new Worker('/aoi-worker.js');let finished=false;
    const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);worker.terminate();error?reject(error):resolve(result);};
    const cancel=()=>finish(Error('Boundary import cancelled.'));
    const timer=setTimeout(()=>finish(Error('Boundary took too long to read. Simplify it in GIS and retry.')),30000);
    signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted){cancel();return;}
    worker.onerror=()=>finish(Error('The boundary reader could not load. Refresh the page and retry.'));
    worker.onmessage=e=>finish(e.data.error?Error(e.data.error):null,e.data.result);
    file.arrayBuffer().then(bytes=>{if(!finished)worker.postMessage(bytes,[bytes]);},error=>finish(error));
  });}};
})(window);
