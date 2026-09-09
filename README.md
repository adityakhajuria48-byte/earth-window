# Earth Window

A Python website for finding real satellite images by location and capture date. The map-first interface has an image gallery, cloud filters, capture-time ranking, scene footprints, source links, and GeoJSON export. It opens at Udhampur, India; search any city, enter coordinates, or click the map.

## Run on your laptop

Install **Python 3.10 or newer**, extract this folder, then open a terminal inside it:

```bash
python app.py
```

On Windows you can also use `py app.py`. Open **http://127.0.0.1:8000** in your browser. Stop with Ctrl+C. No pip packages or API keys are required for the included personal-use configuration. An internet connection is required for imagery, place names, map tiles, fonts, and Leaflet.

Choose another local port with `python app.py --port 8080`.

## Development steps

1. **Define availability rules.** Support archived observations, not arbitrary live or future photography. Keep the requested time separate from the actual capture time. Apply UTC consistently.
2. **Connect imagery catalogues.** Query Element 84 Earth Search for Sentinel-2 L2A and Landsat Collection 2 L2 scenes intersecting the selected point. Pass the date interval and maximum scene cloud cover. Follow pagination up to 500 records and clearly report partial results.
3. **Build the Python service.** Validate inputs, constrain provider URLs, cache results for five minutes, throttle geocoding, add timeouts, and return useful HTTP errors. Serve the interface from the same origin.
4. **Create the interactive map.** Add Leaflet, point selection, recentering, street-map context, and a dated NASA Terra/MODIS daily overview. Keep the map source and date visible.
5. **Build the scene experience.** Show satellite names from provider metadata, UTC capture times, cloud percentages, RGB pixel size, preview images where available, and original asset links. Sort by nearest time, clarity, or newest capture. Highlight the selected scene's footprint.
6. **Polish accessibility and responsiveness.** Provide labelled controls, keyboard focus, native dialogs, responsive cards, hover transitions, reduced-motion support, and explicit loading, empty, and failure states.
7. **Validate and release.** Check date boundaries, filters, pagination, local HTTP serving, invalid requests, JavaScript syntax, and local asset references. Verify live providers and desktop/mobile browser behavior on an unrestricted connection before relying on the application.

Steps 1–6 are implemented. Step 7's automated local checks pass; live provider retrieval and visual browser QA were not completed in the build environment because external API/CDN requests timed out and browser testing was not requested.

## How to use

1. Enter a city or `latitude, longitude`; click the search icon and choose the correct location. You can also click the map.
2. Choose a day and preferred UTC time. For Indian Standard Time, subtract 5 hours 30 minutes, adjusting the date when necessary.
3. Choose exact day, ±7 days, or ±30 days. Future search boundaries are clipped to the present.
4. Choose Sentinel-2 or Landsat and maximum cloud cover. Select **Find satellite images**.
5. Inspect a scene for its satellite name, true capture time, offset from the requested time, footprint, preview, and original assets.
6. Export result metadata as GeoJSON or open an available preview/GeoTIFF. A GeoTIFF is an original raster asset, not a rendered browser image; use QGIS to inspect it at full resolution.

## What the images mean

| Source | What the app uses it for | Limits |
| --- | --- | --- |
| Copernicus / ESA Sentinel-2 | Optical scene search; 10 m RGB bands | Not every place or every day; clouds and no-data areas; L2A archive coverage varies, with global availability from December 2018 in the documented dataset |
| USGS / NASA Landsat | Historical optical scenes; 30 m RGB bands | Acquisition dates vary by satellite; some asset links require provider access; not every scene has a browser preview |
| NASA Terra / MODIS through GIBS | Dated daily regional overview | Coarse daily mosaic, not a selected Sentinel/Landsat image; gaps may occur; cannot establish an exact capture instant |
| OpenStreetMap | Reference street map | Not satellite imagery and not tied to the search date |
| Open-Meteo / GeoNames | City and postal-code lookup | Not a full address or landmark search; use coordinates or the map for precise points |

Scene cloud cover applies to the whole scene, not specifically to your chosen point. A footprint intersection does not guarantee valid cloud-free pixels at that point. Previews show complete source tiles and are not reprojected or cropped to your point. Pixel resolution does not mean people or small details can be identified. The Web Mercator map cannot display the poles, although coordinate search accepts geographic latitude −90 to 90.

An exact-time image cannot be guaranteed. Future imagery, satellite tasking, pass predictions, commercial high-resolution images, and tracking people are not part of this version.

## Architecture and files

```text
app.py                  Python HTTP service and satellite queries
test_app.py             Bounded server and search correctness tests
dist/index.html         Interface and accessible dialogs
dist/styles.css         Responsive layout and visual design
dist/app.js             Map, catalogue browsing, image details, export
dist/backend-config.js  Static-host mode flag; Python overrides this route
```

The downloadable edition runs its search and geocoding through **Python**. The hosted Sites edition serves the same interface as static assets and contacts public APIs from the browser. **The hosted edition does not execute Python.** This preserves the Python implementation while allowing a private hosted interface on the available platform.

The included standard-library server is intended for local/personal use. For a public production Python deployment, port its request functions into an ASGI framework, add shared rate limits and caching, configure HTTPS, and choose provider plans appropriate to traffic. Open-Meteo's free endpoint is intended for non-commercial use; commercial deployments require the appropriate service plan. This project has no application database or analytics; queries are sent to the selected data providers. The Python server keeps only a short-lived in-memory cache and does not log search coordinates.

## Verification

```bash
python -m unittest -v test_app.py
node --check dist/app.js
```

The tests use explicitly synthetic test records only inside test code; the website never displays fixture scenes or substitutes sample imagery after a provider error.

## Next development phase

For detailed analysis, add a Python raster service (Rasterio/rio-tiler) that clips and reprojects a selected COG into map tiles. Then add authenticated providers if higher-resolution commercial imagery is needed. Pass forecasts would be a separate feature based on orbital data and acquisition planning, not evidence that an image will be captured.

## Sources and service documentation

- Earth Search: https://element84.com/earth-search/
- Earth Search API: https://earth-search.aws.element84.com/v1/api.html
- Sentinel-2 dataset: https://registry.opendata.aws/sentinel-2-l2a-cogs/
- Landsat: https://www.usgs.gov/landsat-missions/landsat-collection-2-level-2-science-products
- NASA GIBS: https://nasa-gibs.github.io/gibs-api-docs/access-basics/
- Open-Meteo geocoding: https://open-meteo.com/en/docs/geocoding-api
- Leaflet: https://leafletjs.com/

Provider documentation was checked on 9 September 2026. Service availability and terms can change.
