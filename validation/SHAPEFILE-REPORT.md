# Shapefile regression report — 24 September 2026

## Result

- **100 distinct valid shapefile ZIPs passed** in both the Python reader and the exact shipped JavaScript reader/projection libraries.
- **20 invalid ZIPs were correctly rejected** by both readers.
- **100 upload-to-map application checks passed**, one per decoded valid ZIP, within the overall **152 passing JavaScript tests**.
- **42 existing Python regression tests passed**.

The 100 fixtures cover 25 geographic centres, including Udhampur and Anak Krakatau, with four variants each: WGS 84 polygon, polygon with a hole, multipart UTM (northern and southern zones), and a 33-vertex Web Mercator polygon. Longitude/latitude bounds agree with the independent Python/GDAL result to within 0.000001 degrees. Feature counts, vertex counts, holes, multipart structure and map bounds are checked. The invalid cases exercise missing .prj/.shx/.dbf, empty CRS and corrupt shapefile contents.

Fixtures are synthetic boundary geometries, not satellite observations or user files. The source ZIP bundle and per-case results are included for reproduction. These are not 100 browser screenshots, 100 live catalogue searches, or 100 real-world user files.

## Changes and evidence

1. Local ZIP parsing runs in a dedicated browser worker. Loading a boundary no longer depends on Render waking up or an API sign-in session. The existing protected Python raster/export service is unchanged. Attributes are not read by the new boundary reader.
2. Projection parsing is explicit with Proj4: unsupported/invalid CRS must fail instead of silently treating projected metres as longitude/latitude. Bounds and finite coordinates are validated after projection. ZIP compressed/expanded sizes, entry counts, polygon/vertex counts and a 30-second worker lifetime are bounded.
3. Map clicks previously called point selection, which cleared the uploaded boundary. Clicking either map now preserves an active study area; explicit place selection, Visible area, Whole world or Remove boundary can replace it.
4. A dedicated map pane keeps the amber boundary above scene footprints. Fit-to-area accounts for open desktop panels. A Zoom to boundary control restores its view. Mobile search controls close after a successful import.
5. A clearly named Udhampur sample ZIP lets users exercise the same reader without constructing their own ZIP. Search remains polygon-intersection discovery, not guaranteed complete coverage. Crops remain bounding rectangles, not polygon masks.

## Browser and hosted limits

The existing upload panel opened successfully in the browser. The browser tool repeatedly hung at its file-chooser `setFiles` operation; its subsequent connection/reset also stalled. Consequently, the revised visible browser flow and GPU rendering remain **unverified** in this environment. The application tests use a DOM/map adapter and execute real app logic, but do not prove pixel rendering in Leaflet/Cesium.

A signed service-access request to the prior hosted API returned HTTP 401 without forwarded visitor identity, and another health request timed out. A service token is not a signed-in browser session, so this does not prove that all users' uploads fail for that reason. The new client reader removes the API from boundary display without weakening server authentication. No user-supplied failing ZIP was available; this report cannot identify defects specific to that file.

No scientific accuracy, cloud-free coverage, provider availability, whole-AOI mosaic or polygon-masked raster claim is made. Unsupported date-line-spanning polygons still require splitting in GIS. Browser structural validation does not repair invalid topology; repair invalid polygons in GIS.

## Reproduce

```sh
.venv/bin/python validation/check_shapefiles.py
node validation/check_shapefiles.cjs
npm test
.venv/bin/python -m unittest test_aoi test_app test_crops -q
```

The first command recreates 120 actual ZIP files inside `shapefile-fixtures.zip`; the second parses those ZIP bytes using the shipped browser vendor scripts and writes `shapefile-results.json`; the application tests drive the 100 valid results through the upload, map fitting, search geometry, click-preservation and clearing path.
