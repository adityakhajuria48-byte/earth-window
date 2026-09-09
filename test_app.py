"""Bounded checks of search correctness and HTTP behavior. No provider calls."""
from datetime import datetime, timezone
from functools import partial
from http.server import ThreadingHTTPServer
import json
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen
import app


class SearchTests(unittest.TestCase):
    def setUp(self):
        self.params = {"lat": "32.916", "lon": "75.141", "date": "2025-09-10", "time": "12:00", "window": "0", "cloud": "40"}
        self.now = datetime(2025, 9, 12, 8, tzinfo=timezone.utc)
        self.q = app.search_parameters(self.params, self.now)

    def feature(self, cloud=20, source=None, date="2025-09-10T10:00:00Z"):
        return {"id": "synthetic-test-record", "properties": {"datetime": date, "eo:cloud_cover": cloud}, "_earthWindow": source or {"kind": "optical", "period": "scene"}}

    def test_exact_day_and_future_boundary(self):
        self.assertEqual((self.q["lat"], self.q["lon"]), (32.916, 75.141))
        self.assertEqual(self.q["start"], "2025-09-10T00:00:00+00:00")
        self.assertEqual(self.q["end"], "2025-09-10T23:59:59.999000+00:00")
        q = app.search_parameters({**self.params, "window": "7"}, self.now)
        self.assertEqual(q["end"], "2025-09-12T08:00:00+00:00")

    def test_invalid_search_rejected(self):
        for key, value in [("lat", "nan"), ("lat", "91"), ("lon", "181"), ("cloud", "101"), ("cloud", "nan"), ("date", "2025-09-13"), ("date", "2025-02-30"), ("window", "1000"), ("time", "25:00")]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                app.search_parameters({**self.params, key: value}, self.now)

    def test_worldwide_query_has_no_location_filter(self):
        q = app.search_parameters({"date": "2025-09-10", "scope": "world"}, self.now)
        self.assertEqual(q["scope"], "world")
        self.assertEqual(app.spatial_query(q), {})

    def test_any_global_coordinate_and_map_area(self):
        for lat, lon in [(40.7, -74.0), (-33.9, 151.2), (-90, 0), (65, -150)]:
            q = app.search_parameters({**self.params, "scope": "point", "lat": str(lat), "lon": str(lon)}, self.now)
            self.assertEqual(json.loads(app.spatial_query(q)["intersects"])["coordinates"], [lon, lat])
        q = app.search_parameters({"date": "2025-09-10", "scope": "area", "bounds": "170,-25,-170,25"}, self.now)
        geometry = json.loads(app.spatial_query(q)["intersects"])
        self.assertEqual(geometry["type"], "MultiPolygon")
        self.assertEqual(len(geometry["coordinates"]), 2)
        with self.assertRaises(ValueError):
            app.search_parameters({"date": "2025-09-10", "scope": "area", "bounds": "nan,0,10,10"}, self.now)

    @patch("app.upstream_json")
    def test_worldwide_source_request_does_not_send_a_hidden_point(self, get):
        get.return_value = {"features": [], "links": []}
        q = app.search_parameters({"date": "2025-09-10", "scope": "world"}, self.now)
        app.search_source(q, app.SOURCES[0])
        sent = parse_qs(urlparse(get.call_args.args[0]).query)
        self.assertNotIn("intersects", sent)
        self.assertNotIn("bbox", sent)

    def test_radar_and_unknown_clouds_survive_cloud_filter(self):
        self.assertFalse(app.matches(self.feature(90), self.q))
        self.assertTrue(app.matches(self.feature(None), self.q))
        self.assertTrue(app.matches(self.feature(100, {"kind": "radar", "period": "scene"}), self.q))
        self.assertFalse(app.matches(self.feature(20, date="2025-09-09T10:00:00Z"), self.q))

    def test_composites_overlap_the_date_without_exact_capture(self):
        alos = self.feature(None, {"kind": "radar", "period": "annual mosaic"}, "2025-01-01T00:00:00Z")
        modis = self.feature(None, {"kind": "optical", "period": "8-day composite"}, "2025-09-05T00:00:00Z")
        self.assertTrue(app.matches(alos, self.q))
        self.assertTrue(app.matches(modis, self.q))
        self.assertEqual(app.feature_interval(alos)[1].month, 12)
        self.assertIn("2025-01-01", app.source_range(self.q, {"period": "annual mosaic"}))
        self.assertIn("2025-09-03", app.source_range(self.q, {"period": "8-day composite"}))

    @patch("app.upstream_json")
    def test_source_query_and_pagination(self, get):
        get.side_effect = [{"features": [self.feature()], "links": [{"rel": "next", "href": app.STAC + "?token=second", "method": "GET"}]}, {"features": [], "links": []}]
        result = app.search_source(self.q, app.SOURCES[0])
        self.assertEqual(result["status"], "complete")
        self.assertEqual(len(result["features"]), 1)
        query = parse_qs(urlparse(get.call_args_list[0].args[0]).query)
        self.assertEqual(json.loads(query["intersects"][0])["coordinates"], [75.141, 32.916])
        self.assertNotIn("query", query)  # Cloud filtering must not hide radar or unknown values.

    @patch("app.upstream_json")
    def test_foreign_pagination_url_is_not_fetched(self, get):
        get.return_value = {"features": [], "links": [{"rel": "next", "href": "https://example.com/private"}]}
        result = app.search_source(self.q, app.SOURCES[0])
        self.assertEqual(result["status"], "partial")
        self.assertEqual(get.call_count, 1)

    @patch("app.upstream_json")
    def test_page_cap_is_reported(self, get):
        get.return_value = {"features": [], "links": [{"rel": "next", "href": app.STAC + "?token=more"}]}
        self.assertTrue(app.search_source(self.q, app.SOURCES[0])["truncated"])
        self.assertEqual(get.call_count, 3)

    @patch("app.upstream_json")
    def test_partial_provider_failure_preserves_earlier_page(self, get):
        get.side_effect = [{"features": [self.feature()], "links": [{"rel": "next", "href": app.STAC + "?token=more"}]}, TimeoutError()]
        result = app.search_source(self.q, app.SOURCES[0])
        self.assertEqual(result["status"], "partial")
        self.assertEqual(len(result["features"]), 1)

    @patch("app.upstream_json")
    def test_every_source_is_searched_and_failures_are_isolated(self, get):
        def response(url):
            collection = parse_qs(urlparse(url).query)["collections"][0]
            if collection == "sentinel-1-grd":
                raise TimeoutError()
            return {"features": [self.feature()], "links": []}
        get.side_effect = response
        result = app.search_scenes(self.params)
        self.assertEqual(len(result["sources"]), len(app.SOURCES))
        self.assertEqual(len(result["features"]), len(app.SOURCES)-1)
        self.assertEqual(next(x for x in result["sources"] if x["id"] == "s1")["status"], "unavailable")


class GeocodingTests(unittest.TestCase):
    @patch("app.upstream_json", side_effect=AssertionError("No provider call expected"))
    def test_user_volcano_name_resolves_without_external_lookup(self, get):
        for name in ("Mount Anak Krakatau", "  GUNUNG   ANAK KRAKATAU  ", "Anak Krakatoa, Indonesia"):
            place = app.geocode(name)[0]
            self.assertEqual((place["lat"], place["lon"]), (-6.1009, 105.4233))
            q = app.search_parameters({"lat": str(place["lat"]), "lon": str(place["lon"]), "date": "2025-09-10"})
            self.assertEqual(json.loads(app.spatial_query(q)["intersects"])["coordinates"], [105.4233, -6.1009])
        self.assertEqual(app.known_places("Krakatau"), [])
        self.assertEqual(app.known_places("Mount Anak Krakatau Hotel"), [])

    @patch("app.time.sleep")
    @patch("app.upstream_json")
    def test_other_worldwide_landmarks_use_photon_without_country_restriction(self, get, sleep):
        get.return_value = {"features": [{"geometry": {"type": "Point", "coordinates": [-70.01, -32.65]}, "properties": {"name": "Test mountain", "country": "Argentina"}}]}
        place = app.geocode("Test mountain")[0]
        self.assertEqual(place["lon"], -70.01)
        url = urlparse(get.call_args.args[0])
        self.assertEqual(url.hostname, "photon.komoot.io")
        self.assertEqual(set(parse_qs(url.query)), {"q", "limit", "lang"})
        self.assertEqual(get.call_count, 1)

    @patch("app.time.sleep")
    @patch("app.upstream_json")
    def test_city_fallback_and_provider_failure_are_distinct_from_no_match(self, get, sleep):
        get.side_effect = [TimeoutError(), {"results": [{"name": "Tokyo", "latitude": 35.68, "longitude": 139.69}]}]
        self.assertEqual(app.geocode("Tokyo")[0]["display_name"], "Tokyo")
        get.side_effect = [{"features": []}, {}]
        self.assertEqual(app.geocode("Unmatched name"), [])
        get.side_effect = [TimeoutError(), {}]
        with self.assertRaises(app.URLError):
            app.geocode("Unavailable landmark")

    def test_invalid_provider_coordinates_are_rejected(self):
        features = [{"geometry": {"type": "Point", "coordinates": c}, "properties": {"name": "Bad"}} for c in ([181, 0], [0, 91], [0, None], [0, True], [])]
        self.assertEqual(app.photon_places({"features": features}), [])


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(app.Handler, directory=str(app.ROOT)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_home_and_python_mode(self):
        with urlopen(self.url + "/") as r:
            self.assertIn(b"Earth Window", r.read())
        with urlopen(self.url + "/backend-config.js") as r:
            self.assertIn(b"= true", r.read())
        with urlopen(self.url + "/api/health") as r:
            self.assertEqual(json.load(r)["backend"], "python")

    def test_volcano_endpoint_and_browser_resources(self):
        with urlopen(self.url + "/api/geocode?q=Mount%20Anak%20Krakatau") as r:
            self.assertEqual(json.load(r)[0]["display_name"], "Anak Krakatau, Indonesia")
        for path in ("/landmarks.json", "/geocoding.js"):
            with urlopen(self.url + path) as r:
                self.assertEqual(r.status, 200)

    def test_source_and_invalid_queries_are_not_served(self):
        for path, status in [("/app.py", 404), ("/../app.py", 404), ("/api/search?lat=nan", 400)]:
            with self.subTest(path=path), self.assertRaises(HTTPError) as caught:
                urlopen(self.url + path)
            self.assertEqual(caught.exception.code, status)


if __name__ == "__main__":
    unittest.main()
