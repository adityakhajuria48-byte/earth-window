// Sites checks the owner-private audience before dispatching requests here.
export async function handleRequest(request, env, assets = {}) {
  const url = new URL(request.url), path = url.pathname;
  const configured = Boolean(env.EARTH_WINDOW_PROCESSOR_URL && env.EARTH_WINDOW_PROCESSOR_PASSWORD);
  const json = (status, error) => Response.json({error}, {status, headers:{'Cache-Control':'no-store'}});
  if (path.startsWith('/api/')) {
    if (!request.headers.get('oai-authenticated-user-id')) return json(401, 'Sign in to Earth Window to process a crop.');
    if (!['/api/crop', '/api/health'].includes(path)) return json(404, 'Unknown endpoint.');
    if (request.method !== (path === '/api/crop' ? 'POST' : 'GET')) return json(405, 'Method not allowed.');
    if (!configured) return json(503, 'Crop processing is not connected yet.');
    const origin = request.headers.get('Origin');
    if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json(403, 'Start the export from Earth Window.');
    let body;
    if (path === '/api/crop') {
      if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return json(400, 'Expected a JSON crop request.');
      const declared = Number(request.headers.get('Content-Length'));
      if (declared > 8192) return json(413, 'Crop request is too large.');
      // Do not buffer an unbounded request when Content-Length is absent or incorrect.
      const reader = request.body?.getReader();
      if (!reader) return json(400, 'Missing crop request.');
      let size = 0; const chunks = [];
      try {
        while (true) {
          const {done, value} = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 8192) { await reader.cancel(); return json(413, 'Crop request is too large.'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      body = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    }
    try {
      const upstream = new URL(env.EARTH_WINDOW_PROCESSOR_URL);
      if (upstream.protocol !== 'https:' || upstream.username || upstream.password) return json(503, 'Invalid processing service configuration.');
      upstream.pathname = path; upstream.search = '';
      const response = await fetch(upstream, {
        method: request.method, body, redirect:'error', signal:AbortSignal.timeout(145000),
        headers:{'Content-Type':'application/json', Authorization:'Basic '+btoa('earth-window:'+env.EARTH_WINDOW_PROCESSOR_PASSWORD)},
      });
      const contentType = response.headers.get('Content-Type') || '';
      if (!contentType.includes('application/json') && !contentType.includes('image/tiff')) return json(502, 'The crop service is waking up or unavailable. Please retry shortly.');
      const headers = new Headers({'Content-Type':contentType, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
      if (response.ok && contentType.includes('image/tiff')) headers.set('Content-Disposition', 'attachment; filename="earth-window-crop.tif"');
      return new Response(response.body, {status:response.status, headers});
    } catch { return json(504, 'The crop service did not respond in time. Retry or select a smaller area.'); }
  }
  if (!['GET','HEAD'].includes(request.method)) return json(405, 'Method not allowed.');
  if (path === '/backend-config.js') {
    return new Response(request.method === 'HEAD' ? null : `window.EARTH_WINDOW_PYTHON = false; window.EARTH_WINDOW_CROPS = ${configured};`, {headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'}});
  }
  const asset = assets[path === '/' ? '/index.html' : path];
  if (!asset) return new Response('Not found', {status:404});
  const body = request.method === 'HEAD' ? null : asset.binary ? Uint8Array.from(atob(asset.data), c=>c.charCodeAt(0)) : asset.data;
  return new Response(body, {headers:{'Content-Type':asset.type, 'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}});
}
