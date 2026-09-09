"""Earth Window: dependency-free Python imagery search server (Python 3.10+)."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent / "dist"
STAC = "https://earth-search.aws.element84.com/v1/search"
COLLECTIONS = {"sentinel-2-l2a", "landsat-c2-l2"}
_cache: dict[str, tuple[float, object]] = {}
_cache_lock = threading.Lock()
_geocode_lock = threading.Lock()
_last_geocode = 0.0


def upstream_json(url: str) -> object:
    """Only call with URLs built internally or validated STAC pagination links."""
    with _cache_lock:
        hit = _cache.get(url)
        if hit and time.monotonic() - hit[0] < 300:
            return hit[1]
    request = Request(url, headers={"Accept": "application/geo+json, application/json", "User-Agent": "EarthWindow/1.0 (local satellite imagery explorer)"})
    with urlopen(request, timeout=20) as response:
        raw = response.read(20_000_001)
        if len(raw) > 20_000_000:
            raise ValueError("The provider response is too large. Narrow your search.")
        data = json.loads(raw)
    with _cache_lock:
        if len(_cache) >= 32:
            del _cache[next(iter(_cache))]
        _cache[url] = (time.monotonic(), data)
    return data


def search_parameters(params: dict[str, str], now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    lat, lon = float(params["lat"]), float(params["lon"])
    if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("Latitude must be −90 to 90; longitude must be −180 to 180.")
    collection = params.get("collection", "sentinel-2-l2a")
    if collection not in COLLECTIONS:
        raise ValueError("Unsupported satellite collection.")
    days = int(params.get("window", "7"))
    if days not in (0, 7, 30):
        raise ValueError("Search window must be 0, 7, or 30 days.")
    cloud = float(params.get("cloud", "40"))
    if not math.isfinite(cloud) or not 0 <= cloud <= 100:
        raise ValueError("Cloud cover must be 0 to 100.")
    day = datetime.strptime(params["date"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    datetime.strptime(params.get("time", "12:00"), "%H:%M")
    if day.date() > now.date():
        raise ValueError("Future imagery is not available.")
    if day.year < 1982:
        raise ValueError("Choose a date from 1982 onward.")
    start = day - timedelta(days=days)
    end = min(day + timedelta(days=days + 1) - timedelta(milliseconds=1), now)
    return {"collections": collection, "intersects": json.dumps({"type": "Point", "coordinates": [lon, lat]}), "datetime": f"{start.isoformat()}/{end.isoformat()}", "query": json.dumps({"eo:cloud_cover": {"lte": cloud}}), "limit": 100}


def search_scenes(params: dict[str, str]) -> dict:
    url = STAC + "?" + urlencode(search_parameters(params))
    features, truncated = [], False
    for page in range(5):
        data = upstream_json(url)
        if not isinstance(data, dict) or not isinstance(data.get("features"), list):
            raise ValueError("The imagery service returned an unexpected response.")
        features.extend(data["features"])
        next_link = next((link for link in data.get("links", []) if link.get("rel") == "next"), None)
        if not next_link:
            break
        candidate = next_link.get("href", "")
        parsed = urlparse(candidate)
        if parsed.scheme != "https" or parsed.netloc != "earth-search.aws.element84.com" or next_link.get("method", "GET") != "GET":
            truncated = True
            break
        url = candidate
        if page == 4:
            truncated = True
    return {"features": features, "truncated": truncated}


def geocode(query: str) -> object:
    global _last_geocode
    query = query.strip()
    if not 2 <= len(query) <= 150:
        raise ValueError("Place name must contain 2–150 characters.")
    # Throttle place lookups; cache provider responses. No autocomplete.
    with _geocode_lock:
        delay = 1.1 - (time.monotonic() - _last_geocode)
        if delay > 0:
            time.sleep(delay)
        try:
            data = upstream_json("https://geocoding-api.open-meteo.com/v1/search?" + urlencode({"name": query, "format": "json", "count": 5, "language": "en"}))
            return [{"lat": p["latitude"], "lon": p["longitude"], "display_name": ", ".join(str(p[k]) for k in ("name", "admin1", "country") if p.get(k))} for p in data.get("results", [])]
        finally:
            _last_geocode = time.monotonic()


class Handler(SimpleHTTPRequestHandler):
    def json_response(self, status: int, payload: object) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/backend-config.js":
            body = b"window.EARTH_WINDOW_PYTHON = true;"
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path.startswith("/api/"):
            params = {key: values[0] for key, values in parse_qs(parsed.query).items()}
            try:
                if parsed.path == "/api/search":
                    payload = search_scenes(params)
                elif parsed.path == "/api/geocode":
                    payload = geocode(params.get("q", ""))
                elif parsed.path == "/api/health":
                    payload = {"status": "ok", "backend": "python"}
                else:
                    self.json_response(404, {"error": "Unknown API endpoint."})
                    return
                self.json_response(200, payload)
            except (KeyError, ValueError) as exc:
                self.json_response(400, {"error": str(exc)})
            except HTTPError as exc:
                self.json_response(429 if exc.code == 429 else 502, {"error": "Satellite data provider could not complete the request."})
            except (URLError, TimeoutError, OSError):
                self.json_response(502, {"error": "Imagery provider is unreachable. Please retry."})
            return
        if parsed.path not in {"/", "/index.html", "/styles.css", "/app.js"}:
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        if urlparse(self.path).path not in {"/", "/index.html", "/styles.css", "/app.js"}:
            self.send_error(404)
            return
        super().do_HEAD()

    def log_message(self, format: str, *args: object) -> None:
        # Do not retain searched coordinates or place names in access logs.
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=str(ROOT)))
    print(f"Earth Window is ready at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
