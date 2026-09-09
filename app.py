"""Earth Window: dependency-free Python imagery search server (Python 3.10+)."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import unicodedata
from pathlib import Path
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent / "dist"
STAC = "https://earth-search.aws.element84.com/v1/search"
SOURCES = json.loads((ROOT / "sources.json").read_text())
LANDMARKS = json.loads((ROOT / "landmarks.json").read_text())
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
    scope = params.get("scope", "point" if "lat" in params or "lon" in params else "world")
    if scope not in {"world", "point", "area"}:
        raise ValueError("Invalid search scope.")
    geo = {"scope": scope}
    if scope == "point":
        lat, lon = float(params["lat"]), float(params["lon"])
        if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError("Latitude must be −90 to 90; longitude must be −180 to 180.")
        geo.update(lat=lat, lon=lon)
    elif scope == "area":
        bounds = [float(v) for v in params.get("bounds", "").split(",")]
        if len(bounds) != 4 or not all(math.isfinite(v) for v in bounds):
            raise ValueError("Invalid map bounds.")
        w, south, e, north = bounds
        if not (-180 <= w <= 180 and -180 <= e <= 180 and -90 <= south < north <= 90) or w == e:
            raise ValueError("Invalid map bounds.")
        geo["bounds"] = bounds
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
    return {**geo, "start": start.isoformat(), "end": end.isoformat(), "cloud": cloud}


def source_range(q: dict, source: dict) -> str:
    start, end = datetime.fromisoformat(q["start"]), datetime.fromisoformat(q["end"])
    if source["period"] == "8-day composite":
        start -= timedelta(days=7)
    elif source["period"] == "annual mosaic":
        start = datetime(start.year, 1, 1, tzinfo=timezone.utc)
        end = datetime(end.year + 1, 1, 1, tzinfo=timezone.utc) - timedelta(milliseconds=1)
    return f"{start.isoformat()}/{end.isoformat()}"


def spatial_query(q: dict) -> dict:
    if q.get("scope") == "world":
        return {}
    if q.get("scope") == "area":
        w, south, e, north = q["bounds"]
        if w < e:
            return {"bbox": ",".join(str(x) for x in q["bounds"])}
        def ring(a, z):
            return [[a, south], [z, south], [z, north], [a, north], [a, south]]
        polygons = [[ring(a, z)] for a, z in [(w, 180), (-180, e)] if a != z]
        return {"intersects": json.dumps({"type": "MultiPolygon", "coordinates": polygons})}
    return {"intersects": json.dumps({"type": "Point", "coordinates": [q["lon"], q["lat"]]})}


def search_source(q: dict, source: dict) -> dict:
    search = {"collections": source["collection"], **spatial_query(q), "datetime": source_range(q, source), "limit": 100, "sortby": "-datetime"}
    # Cloud filtering is applied after aggregation in the client. Radar and
    # optical scenes with unreported cloud cover must remain discoverable.
    url = source["endpoint"] + "?" + urlencode(search)
    features, truncated, complete = [], False, False
    started = time.monotonic()
    try:
        for page in range(3):
            if time.monotonic() - started > 35:
                truncated = True
                break
            data = upstream_json(url)
            if not isinstance(data, dict) or not isinstance(data.get("features"), list):
                raise ValueError("Unexpected catalogue response.")
            meta = {"sourceId": source["id"], **{k: source.get(k) for k in ("name", "family", "agency", "region", "kind", "period", "gsd")}}
            features.extend({**f, "_earthWindow": meta} for f in data["features"])
            next_link = next((link for link in data.get("links", []) if link.get("rel") == "next"), None)
            if not next_link:
                complete = True
                break
            candidate = next_link.get("href", "")
            parsed, expected = urlparse(candidate), urlparse(source["endpoint"])
            if parsed.scheme != "https" or parsed.netloc != expected.netloc or not parsed.path.startswith(expected.path.rsplit("/", 1)[0] + "/") or next_link.get("method", "GET") != "GET":
                truncated = True
                break
            url = candidate
            if page == 2:
                truncated = True
        return {"id": source["id"], "name": source["name"], "status": "complete" if complete else "partial", "features": features, "truncated": truncated}
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, KeyError):
        return {"id": source["id"], "name": source["name"], "status": "partial" if features else "unavailable", "features": features, "truncated": bool(features), "error": "This archive could not finish the search. Retry to check its coverage."}


def feature_interval(feature: dict) -> tuple[datetime, datetime] | None:
    p, source = feature.get("properties", {}), feature.get("_earthWindow", {})
    try:
        start = datetime.fromisoformat((p.get("start_datetime") or p["datetime"]).replace("Z", "+00:00")).astimezone(timezone.utc)
        end = datetime.fromisoformat((p.get("end_datetime") or p.get("datetime") or p["start_datetime"]).replace("Z", "+00:00")).astimezone(timezone.utc)
        if source.get("period") == "annual mosaic" and not p.get("start_datetime"):
            start = datetime(start.year, 1, 1, tzinfo=timezone.utc)
            end = datetime(start.year + 1, 1, 1, tzinfo=timezone.utc) - timedelta(milliseconds=1)
        elif source.get("period") == "8-day composite" and not p.get("end_datetime"):
            end = min(start + timedelta(days=8) - timedelta(milliseconds=1), datetime(start.year + 1, 1, 1, tzinfo=timezone.utc) - timedelta(milliseconds=1))
        return (start, end) if end >= start else None
    except (KeyError, ValueError, TypeError):
        return None


def matches(feature: dict, q: dict) -> bool:
    period = feature_interval(feature)
    if not period or period[1] < datetime.fromisoformat(q["start"]) or period[0] > datetime.fromisoformat(q["end"]):
        return False
    cloud = feature.get("properties", {}).get("eo:cloud_cover")
    return feature.get("_earthWindow", {}).get("kind") == "radar" or not isinstance(cloud, (int, float)) or not math.isfinite(cloud) or not 0 <= cloud <= 100 or cloud <= q["cloud"]


def search_scenes(params: dict[str, str]) -> dict:
    q = search_parameters(params)
    with ThreadPoolExecutor(max_workers=len(SOURCES)) as pool:
        results = list(pool.map(partial(search_source, q), SOURCES))
    return {"features": [f for r in results for f in r["features"] if matches(f, q)], "sources": [{k: v for k, v in r.items() if k != "features"} for r in results], "truncated": any(r["truncated"] for r in results)}


def valid_place(p):
    return all(isinstance(p.get(k), (int, float)) and not isinstance(p[k], bool) and math.isfinite(p[k]) and abs(p[k]) <= limit for k, limit in (("lat", 90), ("lon", 180))) and bool(p.get("display_name"))


def known_places(query):
    def normalize(s):
        return " ".join(unicodedata.normalize("NFKC", s).lower().split())
    q = normalize(query)
    return [p for p in LANDMARKS if valid_place(p) and any(q == normalize(name) for alias in p["aliases"] for name in (alias, alias + ", " + p["country"], alias + " " + p["country"]))]


def photon_places(data):
    if not isinstance(data, dict) or not isinstance(data.get("features"), list):
        raise ValueError("Unexpected place-search response.")
    places = []
    for f in data["features"]:
        if not isinstance(f, dict):
            continue
        g, p = f.get("geometry") or {}, f.get("properties") or {}
        coords = g.get("coordinates")
        if g.get("type") != "Point" or not isinstance(coords, list) or len(coords) < 2:
            continue
        name = ", ".join(dict.fromkeys(p[k] for k in ("name", "city", "state", "country") if isinstance(p.get(k), str) and p[k].strip()))
        place = {"lat": coords[1], "lon": coords[0], "display_name": name, "provider": "Photon / OpenStreetMap"}
        if valid_place(place):
            places.append(place)
    return places[:5]


def city_places(data):
    if not isinstance(data, dict) or not isinstance(data.get("results", []), list):
        raise ValueError("Unexpected city-search response.")
    places = [{"lat": p.get("latitude"), "lon": p.get("longitude"), "display_name": ", ".join(dict.fromkeys(p[k] for k in ("name", "admin1", "country") if isinstance(p.get(k), str) and p[k].strip())), "provider": "Open-Meteo / GeoNames"} for p in data.get("results", []) if isinstance(p, dict)]
    return [p for p in places if valid_place(p)][:5]


def geocode(query: str) -> object:
    global _last_geocode
    query = query.strip()
    if not 2 <= len(query) <= 150:
        raise ValueError("Place name must contain 2–150 characters.")
    local = known_places(query)
    if local:
        return local
    providers = [
        ("https://photon.komoot.io/api/?" + urlencode({"q": query, "limit": 5, "lang": "en"}), photon_places),
        ("https://geocoding-api.open-meteo.com/v1/search?" + urlencode({"name": query, "format": "json", "count": 5, "language": "en"}), city_places),
    ]
    failed = False
    # Manual queries only, cached by upstream_json; serialize and throttle each call.
    with _geocode_lock:
        for url, parse in providers:
            delay = 1.1 - (time.monotonic() - _last_geocode)
            if delay > 0:
                time.sleep(delay)
            try:
                results = parse(upstream_json(url))
                if results:
                    return results
            except (HTTPError, URLError, TimeoutError, OSError, ValueError):
                failed = True
            finally:
                _last_geocode = time.monotonic()
    if failed:
        raise URLError("Place lookup unavailable")
    return []


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
                self.json_response(502, {"error": "Place search is partly unavailable. Retry, enter latitude, longitude, or click the map." if parsed.path == "/api/geocode" else "Imagery provider is unreachable. Please retry."})
            return
        if parsed.path not in {"/", "/index.html", "/styles.css", "/app.js", "/catalog.js", "/bands.js", "/sources.json", "/landmarks.json", "/geocoding.js"}:
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        if urlparse(self.path).path not in {"/", "/index.html", "/styles.css", "/app.js", "/catalog.js", "/bands.js", "/sources.json", "/landmarks.json", "/geocoding.js"}:
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
