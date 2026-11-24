"""Run the shipped globe in Chrome and check visible overlay pixels through zoom."""
import io
import time
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from PIL import Image
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(root/'dist')))
Thread(target=server.serve_forever, daemon=True).start()
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width':1200,'height':800}, reduced_motion='reduce')
    errors = []
    page.on('pageerror',lambda error: errors.append(str(error)))
    page.goto(f'http://127.0.0.1:{server.server_port}',wait_until='domcontentloaded',timeout=90000)
    page.wait_for_function("typeof EWGlobe !== 'undefined' && EWGlobe.active", timeout=90000)
    page.wait_for_function("document.querySelector('#terrain-status').textContent.includes('Esri World Elevation') || document.querySelector('#terrain-status').textContent.startsWith('Fallback')", timeout=60000)
    print('Terrain:',page.locator('#terrain-status').inner_text(),flush=True)
    page.evaluate("""async () => {
      const tile=document.createElement('canvas');tile.width=tile.height=32;
      const ctx=tile.getContext('2d');ctx.fillStyle='#ff00ff';ctx.fillRect(0,0,32,32);
      await EWGlobe.showSurfaces([{url:tile.toDataURL(),bounds:[75,32.8,75.2,33],credit:'QA marker'}]);
    }""")
    canvas=page.locator('#globe canvas').first
    def check(label):
        deadline=time.monotonic()+45
        while time.monotonic()<deadline:
            im=Image.open(io.BytesIO(canvas.screenshot())).convert('RGB')
            cx,cy=im.width//2,im.height//2
            samples=[im.getpixel((x,y)) for x in range(cx-40,cx+40,8) for y in range(cy-40,cy+40,8)]
            if sum(r>175 and b>175 and g<80 for r,g,b in samples)>70:
                print(label,'overlay visible at center',flush=True)
                return
            page.wait_for_timeout(500)
        raise AssertionError(label+' overlay was missing from the expected map center')
    check('Initial')
    before=page.evaluate('EWGlobe.bounds()')
    page.locator('#globe-in').dispatch_event('click')
    page.wait_for_function('previous=>JSON.stringify(EWGlobe.bounds())!==JSON.stringify(previous)',arg=before)
    check('Zoomed')
    page.locator('#view-2d').dispatch_event('click')
    assert not page.evaluate('EWGlobe.active')
    page.locator('#view-3d').dispatch_event('click')
    check('Restored 3D')
    assert not errors,errors
    browser.close()
server.shutdown()
