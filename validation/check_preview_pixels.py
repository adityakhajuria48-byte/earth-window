"""Probe the exact four failed single-band selections through the preview entry point."""
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
fixtures = json.loads((root / 'validation/new-archive-fixtures.json').read_text())
targets = {'aster', 's1-rtc', 'cbers4-pan5', 'cbers2b-hrc'}
passed = set()
for fixture in fixtures:
    name, item = fixture['source'], fixture['item']
    if name not in targets:
        continue
    w,s,e,n = item['bbox']
    x,y = (w+e)/2,(s+n)/2
    asset = next(k for k,v in item['assets'].items() if 'tiff' in v.get('type',''))
    q = dict(source=name,item=item['id'],asset=asset,band=1,bbox=[x-.005,y-.005,x+.005,y+.005])
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)/'preview.json'
        try:
            run = subprocess.run([sys.executable,'previews.py','--output',str(out)],cwd=root,
                                 input=json.dumps(q),text=True,capture_output=True,timeout=90)
            if run.returncode: raise ValueError('preview generation failed')
            preview = json.loads(out.read_text())
            pixels = preview['data']
            assert len(pixels)==preview['width']*preview['height'] and preview['crs']
            valid = sum(v is not None and math.isfinite(v) for v in pixels)
            assert valid > 0
            passed.add(name)
            print(f'{name}: {valid} valid pixels, {preview["crs"]}',flush=True)
        except (AssertionError, ValueError, subprocess.TimeoutExpired) as exc:
            print(f'{name}: failed ({type(exc).__name__})',flush=True)
sys.exit(0 if passed == targets else 1)
