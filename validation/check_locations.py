#!/usr/bin/env python3
"""Read-only, resumable provider checks; these are NOT browser/GPU render tests.

Run with requests, Pillow, numpy and lerc installed:
  python validation/check_locations.py
Network requests are capped at six per second across six workers. Each of 1,000
locations checks imagery at zooms 8, 14 and 19 plus decoded terrain at zoom 12.
The imagery fallback matches dist/basemaps.js (up to six ancestor levels).
"""
import concurrent.futures as cf
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import threading
import time
from datetime import datetime, timezone

import lerc
import numpy as np
from PIL import Image
import requests

ROOT = Path(__file__).resolve().parent
IMAGERY = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
TERRAIN = 'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer'
LOCK = threading.Lock()
RATE_LOCK = threading.Lock()
LOCAL = threading.local()
CACHE = {}
NEXT_REQUEST = 0.0


def now():
    return datetime.now(timezone.utc).isoformat()


def tile_at(lat, lon, z):
    n = 2 ** z
    x = min(n - 1, max(0, int((lon + 180) / 360 * n)))
    y = min(n - 1, max(0, int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)))
    # Independently check that the requested coordinate lies inside its tile.
    west, east = x / n * 360 - 180, (x + 1) / n * 360 - 180
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    assert west <= lon <= east and south <= lat <= north
    return x, y


def append_json(path, value):
    with path.open('a', encoding='utf-8') as f:
        f.write(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')
        f.flush()


def get_session():
    if not hasattr(LOCAL, 'session'):
        LOCAL.session = requests.Session()
        LOCAL.session.headers['User-Agent'] = 'EarthWindow/1.0 (bounded imagery availability validation)'
    return LOCAL.session


def rate_limit():
    global NEXT_REQUEST
    with RATE_LOCK:
        wait = max(0, NEXT_REQUEST - time.monotonic())
        NEXT_REQUEST = max(NEXT_REQUEST, time.monotonic()) + 1 / 6
    if wait:
        time.sleep(wait)


def fetch_tile(provider, z, x, y):
    key = f'{provider}/{z}/{x}/{y}'
    # Single-flight identical tiles: nearby locations share one network check.
    with LOCK:
        if key in CACHE:
            future, owner = CACHE[key], False
        else:
            future = CACHE[key] = cf.Future()
            owner = True
    if not owner:
        return future.result()
    base = IMAGERY if provider == 'imagery' else TERRAIN
    url = f'{base}/tile/{z}/{y}/{x}' + ('?blankTile=false' if provider == 'imagery' else '')
    result = {'key': key, 'url': url, 'provider': provider, 'z': z, 'x': x, 'y': y, 'checked_at': now(), 'ok': False, 'attempts': []}
    try:
        for attempt in range(3):
            rate_limit()
            start = time.monotonic()
            status = None
            retry_after = 1 + attempt
            try:
                with get_session().get(url, timeout=(8, 20), stream=True, allow_redirects=False) as response:
                    status = response.status_code
                    result['status'] = status
                    if status == 429:
                        try:
                            retry_after = min(30, max(1, float(response.headers.get('Retry-After', '5'))))
                        except ValueError:
                            retry_after = 5
                    response.raise_for_status()
                    if status != 200:
                        raise ValueError(f'Unexpected HTTP {status}')
                    data = bytearray()
                    for chunk in response.iter_content(65536):
                        data.extend(chunk)
                        if len(data) > 2 * 1024 * 1024:
                            raise ValueError('Tile exceeds 2 MiB safety limit')
                    data = bytes(data)
                    result.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest(), content_type=response.headers.get('Content-Type', ''))
                if provider == 'imagery':
                    with Image.open(io.BytesIO(data)) as im:
                        im.load()
                        if im.size != (256, 256) or im.format != 'JPEG':
                            raise ValueError(f'Unexpected imagery format/size: {im.format} {im.size}')
                        result['shape'] = [256, 256]
                else:
                    code, values, mask = lerc.decode(data)
                    if code != 0 or values is None or values.shape != (257, 257):
                        raise ValueError(f'LERC decode failed or unexpected shape: code {code}')
                    valid = np.isfinite(values)
                    if mask is not None:
                        valid &= mask.astype(bool)
                    valid_values = values[valid]
                    if not valid_values.size:
                        raise ValueError('Terrain has no valid elevations')
                    lo, hi = float(valid_values.min()), float(valid_values.max())
                    if lo < -12000 or hi > 10000:
                        raise ValueError(f'Implausible terrain height range: {lo}, {hi}')
                    result.update(shape=list(values.shape), valid_samples=int(valid_values.size), total_samples=int(values.size), min_elevation_m=round(lo, 3), max_elevation_m=round(hi, 3))
                result['ok'] = True
                result['attempts'].append({'status': status, 'seconds': round(time.monotonic() - start, 3)})
                break
            except Exception as exc:
                result['error'] = f'{type(exc).__name__}: {exc}'
                result['attempts'].append({'status': status, 'seconds': round(time.monotonic() - start, 3), 'error': result['error']})
                retryable = status is None or status == 429 or status >= 500
                if not retryable or attempt == 2:
                    break
                time.sleep(retry_after)
        if result['ok']:
            result.pop('error', None)
    except Exception as exc:
        result['error'] = f'{type(exc).__name__}: {exc}'
    with LOCK:
        append_json(ROOT / 'tile-checks.jsonl', result)
    future.set_result(result)
    return result


def imagery_check(lat, lon, z):
    x, y = tile_at(lat, lon, z)
    checked = []
    for depth in range(min(z, 6) + 1):
        tile = fetch_tile('imagery', z - depth, x // 2 ** depth, y // 2 ** depth)
        checked.append(tile['key'])
        if tile['ok']:
            return {'ok': True, 'requested_zoom': z, 'source_zoom': z - depth, 'fallback': depth > 0, 'tile': tile['key'], 'checked_tiles': checked}
    return {'ok': False, 'requested_zoom': z, 'source_zoom': None, 'fallback': False, 'checked_tiles': checked}


def check_location(row):
    lat, lon = float(row['lat']), float(row['lon'])
    result = dict(row, checked_at=now())
    result['imagery'] = [imagery_check(lat, lon, z) for z in (8, 14, 19)]
    x, y = tile_at(lat, lon, 12)
    tile = fetch_tile('terrain', 12, x, y)
    result['terrain'] = {k: tile[k] for k in ('ok', 'key', 'shape', 'valid_samples', 'total_samples', 'min_elevation_m', 'max_elevation_m', 'error') if k in tile}
    result['ok'] = all(t['ok'] for t in result['imagery']) and tile['ok']
    return result


def summarize(results):
    imagery = [t for row in results for t in row['imagery']]
    unique = [future.result() for future in CACHE.values()]
    summary = {
        'generated_at': now(), 'locations': len(results),
        'country_territory_codes': len({r['country'] for r in results}),
        'locations_all_checks_passed': sum(r['ok'] for r in results),
        'imagery_checks': len(imagery), 'imagery_passed': sum(t['ok'] for t in imagery),
        'imagery_native': sum(t['ok'] and not t['fallback'] for t in imagery),
        'imagery_parent_fallback': sum(t['ok'] and t['fallback'] for t in imagery),
        'terrain_checks': len(results), 'terrain_passed': sum(r['terrain']['ok'] for r in results),
        'unique_tiles': len(unique), 'http_attempts': sum(len(t['attempts']) for t in unique),
        'http_404_attempts': sum(a['status'] == 404 for t in unique for a in t['attempts']),
        'http_429_attempts': sum(a['status'] == 429 for t in unique for a in t['attempts']),
        'downloaded_valid_tile_bytes': sum(t.get('bytes', 0) for t in unique if t['ok']),
        'zoom_results': {str(z): {'passed': sum(t['ok'] for t in imagery if t['requested_zoom'] == z), 'native': sum(t['ok'] and not t['fallback'] for t in imagery if t['requested_zoom'] == z), 'parent_fallback': sum(t['ok'] and t['fallback'] for t in imagery if t['requested_zoom'] == z)} for z in (8, 14, 19)},
        'failed_locations': [r['id'] for r in results if not r['ok']],
        'scope': 'Provider tile retrieval, real JPEG/LERC decoding, tile-coordinate containment and ancestor fallback. Not browser rendering, GPU correctness, geocoder coverage, date/band availability, or Google Maps equivalence.'
    }
    (ROOT / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    fields = ['id', 'name', 'country', 'lat', 'lon', 'ok', 'zoom8_source', 'zoom14_source', 'zoom19_source', 'terrain_ok', 'terrain_min_m', 'terrain_max_m']
    with (ROOT / 'results-1000.csv').open('w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for r in sorted(results, key=lambda x: x['id']):
            row = {k: r[k] for k in ('id', 'name', 'country', 'lat', 'lon', 'ok')}
            row.update({f"zoom{t['requested_zoom']}_source": t['source_zoom'] for t in r['imagery']})
            row.update(terrain_ok=r['terrain']['ok'], terrain_min_m=r['terrain'].get('min_elevation_m'), terrain_max_m=r['terrain'].get('max_elevation_m'))
            writer.writerow(row)
    return summary


def main():
    locations = list(csv.DictReader((ROOT / 'locations-1000.csv').open(encoding='utf-8')))
    assert len(locations) == 1000 and len({r['id'] for r in locations}) == 1000
    fingerprint = hashlib.sha256((ROOT / 'locations-1000.csv').read_bytes() + Path(__file__).read_bytes()).hexdigest()
    manifest_path = ROOT / 'run.json'
    if manifest_path.exists():
        assert json.loads(manifest_path.read_text())['fingerprint'] == fingerprint, 'Inputs changed: use a fresh results directory.'
    else:
        manifest_path.write_text(json.dumps({'started_at': now(), 'fingerprint': fingerprint, 'zooms': [8, 14, 19], 'terrain_zoom': 12, 'workers': 6, 'max_requests_per_second': 6, 'max_attempts_per_tile': 3, 'max_parent_depth': 6}, indent=2) + '\n')
    tile_path, location_path = ROOT / 'tile-checks.jsonl', ROOT / 'location-checks.jsonl'
    if tile_path.exists():
        for line in tile_path.read_text().splitlines():
            record = json.loads(line)
            future = CACHE[record['key']] = cf.Future()
            future.set_result(record)
    results = [json.loads(line) for line in location_path.read_text().splitlines()] if location_path.exists() else []
    done = {r['id'] for r in results}
    print(json.dumps({'resuming': len(done), 'total': len(locations), 'cached_tiles': len(CACHE)}), flush=True)
    with cf.ThreadPoolExecutor(max_workers=6) as pool:
        pending = [pool.submit(check_location, row) for row in locations if row['id'] not in done]
        for future in cf.as_completed(pending):
            result = future.result()
            append_json(location_path, result)
            results.append(result)
            if len(results) % 25 == 0:
                print(json.dumps({'completed': len(results), 'passed': sum(r['ok'] for r in results), 'last': result['name']}), flush=True)
    print(json.dumps(summarize(results)), flush=True)


if __name__ == '__main__':
    main()
