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

    def test_exact_day_point_and_cloud_filter(self):
        q = app.search_parameters(self.params, self.now)
        self.assertEqual(json.loads(q["intersects"]), {"type": "Point", "coordinates": [75.141, 32.916]})
        self.assertEqual(q["datetime"], "2025-09-10T00:00:00+00:00/2025-09-10T23:59:59.999000+00:00")
        self.assertEqual(json.loads(q["query"]), {"eo:cloud_cover": {"lte": 40}})

    def test_expanded_range_never_requests_future_captures(self):
        q = app.search_parameters({**self.params, "window": "7"}, self.now)
        self.assertEqual(q["datetime"], "2025-09-03T00:00:00+00:00/2025-09-12T08:00:00+00:00")

    def test_invalid_search_rejected_before_provider_request(self):
        for key, value in [("lat", "nan"), ("lat", "91"), ("lon", "181"), ("cloud", "101"), ("cloud", "nan"), ("date", "2025-09-13"), ("date", "2025-02-30"), ("window", "1000"), ("collection", "anything"), ("time", "25:00")]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                app.search_parameters({**self.params, key: value}, self.now)

    @patch("app.upstream_json")
    def test_pagination_collects_later_scenes(self, get):
        get.side_effect = [{"features": [{"id": "first-test-scene"}], "links": [{"rel": "next", "href": app.STAC + "?token=second", "method": "GET"}]}, {"features": [{"id": "second-test-scene"}], "links": []}]
        result = app.search_scenes(self.params)
        self.assertEqual(len(result["features"]), 2)
        self.assertFalse(result["truncated"])

    @patch("app.upstream_json")
    def test_foreign_pagination_url_is_not_fetched(self, get):
        get.return_value = {"features": [], "links": [{"rel": "next", "href": "https://example.com/private"}]}
        self.assertTrue(app.search_scenes(self.params)["truncated"])
        self.assertEqual(get.call_count, 1)

    @patch("app.upstream_json")
    def test_page_cap_is_reported(self, get):
        get.return_value = {"features": [], "links": [{"rel": "next", "href": app.STAC + "?token=more"}]}
        self.assertTrue(app.search_scenes(self.params)["truncated"])
        self.assertEqual(get.call_count, 5)


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

    def test_source_and_invalid_queries_are_not_served(self):
        for path, status in [("/app.py", 404), ("/../app.py", 404), ("/api/search?lat=nan", 400)]:
            with self.subTest(path=path), self.assertRaises(HTTPError) as caught:
                urlopen(self.url + path)
            self.assertEqual(caught.exception.code, status)


if __name__ == "__main__":
    unittest.main()
