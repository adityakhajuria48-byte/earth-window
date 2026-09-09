# Earth Window

**Explore any location in the world. Earth Window searches connected satellite archives automatically and tells you which satellites have data.** There is no satellite-selection step.

The app includes an interactive map, actual capture times, labelled composite periods, optical cloud filters, original data links, metadata export, and band controls specific to each image. It opens on the whole-world map with no preselected city and a recent date. Search any city, enter any valid `latitude, longitude`, or click anywhere on the map for local imagery and bands. Use **Search map area** for a region or **Whole world** to remove the geographic filter.

## Run the Python website

Install **Python 3.10+**, open a terminal inside this folder, then run:

```bash
python app.py
```

On Windows, `py app.py` also works. Open **http://127.0.0.1:8000**. Stop with Ctrl+C. There are no Python packages to install. Internet access is needed for satellite archives, map tiles, geocoding, Leaflet, fonts, and the optional raster viewer.

## Automatically searched archives

All six configured collections are queried for every search; users do not have to choose a satellite. The agency countries identify who operates the satellites, not where imagery can be searched. Locations in other countries are fully supported wherever those archives have acquisitions.

| Satellite family | Operator / programme | Data | Time handling |
| --- | --- | --- | --- |
| Sentinel-2 | ESA / Copernicus, Europe | L2A optical imagery, including the newer Collection 1 archive | Individual capture times; duplicate reprocessing is collapsed when platform, time, and tile match |
| Landsat | USGS / NASA, United States | Collection 2 Level 2 optical and available thermal data | Individual capture times |
| Sentinel-1 | ESA / Copernicus, Europe | GRD radar and available polarizations | Individual capture times; cloud filter does not exclude radar |
| Terra / Aqua MODIS | NASA, United States | 500 m surface reflectance and data layers | Explicit 8-day composite period |
| ALOS / ALOS-2 PALSAR | JAXA, Japan | 25 m annual radar mosaics | Explicit annual period, never a fabricated capture time |

The catalogue hosts are **Element 84 Earth Search** and **Microsoft Planetary Computer**. Individual platform names come from each result's metadata. If the platform is missing, the interface says so instead of guessing which satellite captured it.

These archives cover many parts of the world, not every satellite or every place. Mission coverage, historical availability, clouds, processing delays, and provider access determine whether data exists. Optical imagery cannot show the ground through clouds. A footprint intersection does not guarantee valid pixels at the selected point. Commercial, restricted, and unconnected national archives are not advertised as available.

## Band options

Open any result to inspect the **bands and data layers actually listed in that record**:

- Select an individual band or data layer and open its original file.
- Render a downsampled grayscale preview from an accessible GeoTIFF.
- Use true colour (red / green / blue), vegetation false colour (NIR / red / green), or SWIR false colour (SWIR1 / NIR / red) only when all required bands are exposed.
- Radar assets can expose VV, VH, HH, or HV polarizations; the UI lists only the polarizations actually present.
- Save a rendered preview as PNG. Provider-supplied thumbnails remain labelled separately.

Band names, wavelengths, and data links are read from STAC asset metadata. Quality flags, observation angles, and other raster data layers can also appear. The original file is the authoritative data product.

The GeoTIFF preview uses a suitable small overview, a maximum display dimension of 512 pixels, nearest-neighbour sampling, transparent no-data, and a separate 2–98% contrast stretch for each display channel. It rejects mixed grids and oversized rasters without a usable overview. **These previews are display products, not calibrated quantitative analyses or crops of the selected point.** An RGB combination does not add resolution. GeoTIFFs blocked by browser access rules and HDF/NetCDF assets can be opened in geospatial software instead. No NDVI or other scientific index is claimed.

For Azure assets, the viewer requests short-lived access links from Microsoft Planetary Computer when the user opens or renders the data. It does not embed credentials or save those access links in exports.

## Search correctness and reliability

- Worldwide mode sends no geographic filter. Point mode accepts any latitude/longitude, and area mode supports map bounds, including regions crossing the date line.
- Exact-day, ±7-day, and ±30-day windows use UTC. Single-capture searches are clipped to the current time.
- Composite searches expand the provider query to find periods overlapping the requested dates, then filter those periods for overlap. They are labelled as composites and ranked after individual captures in the default time sort.
- The optical cloud filter retains unreported cloud values with an explicit label. Radar is always retained regardless of cloud cover.
- Each source reports complete, partial, or unavailable status. A failed archive never becomes a claim of no coverage.
- Hosted searches show results as each source finishes. The Python server queries the sources concurrently and returns their combined result.
- Pagination is limited to three pages of 100 records per collection, requested newest first. Worldwide and broad-area results are limited catalogue pages, not an exhaustive world inventory. Time sorting orders the loaded results; it does not guarantee the globally nearest acquisition. Zoom into a region or select a point for focused coverage. Partial results are clearly reported; narrow the time window when necessary.
- Result rendering is limited to 30 cards at a time, with a Show more button. Export includes all returned matching records, along with search settings and archive status.
- Dates and inputs are validated. Source URLs and pagination hosts are constrained. Python caches JSON responses for five minutes and avoids logging searched coordinates.

## Map context

The selectable map layers are **NASA Terra/MODIS daily overview** and **OpenStreetMap reference map**. These are map context, not satellite search filters. The NASA layer is a coarse daily mosaic, not the selected Sentinel, Landsat, or radar image. Footprints for the currently displayed result cards appear on the map and can be clicked; thumbnails and band previews display full tiles in the details panel. The Web Mercator map cannot display the poles, but geographic coordinate search accepts latitude −90 to 90.

## Development steps

1. Define the search around location, UTC time, and availability rather than a mandatory satellite choice.
2. Maintain a shared registry of verified public catalogue collections in `dist/sources.json`.
3. Query every collection, paginate within limits, isolate provider failures, and combine results.
4. Normalize satellite identities and distinguish capture timestamps from composite periods.
5. Discover per-item assets and expose only real bands, with original-file access and bounded raster previews.
6. Add clear availability summaries, responsive controls, keyboard-accessible dialogs, loading/error states, and progressive results.
7. Test temporal overlap, cloud/radar behavior, failure isolation, band metadata, pixel rendering, HTTP serving, and local asset wiring.
8. Publish the static interface and keep the Python edition and GitHub source synchronized.

## Code layout

| File | Responsibility |
| --- | --- |
| `app.py` | Python HTTP server, validation, concurrent catalogue search, time ranges, cloud filtering, caching, geocoding |
| `dist/sources.json` | Shared satellite archive registry |
| `dist/catalog.js` | Pure catalogue normalization, deduplication, band discovery, temporal matching, preview pixel stretch |
| `dist/bands.js` | Band controls, provider asset authorization, GeoTIFF reading, preview and PNG export |
| `dist/app.js` | Map, automatic search, result cards, source availability and details |
| `dist/index.html`, `dist/styles.css` | Responsive interface and accessible controls |
| `dist/backend-config.js` | Static mode flag; Python overrides this route to enable its API |
| `test_app.py`, `test_catalog.cjs` | Python and JavaScript correctness tests |

The **Python edition** runs catalogue and city queries through the local Python server. The **hosted Sites edition** serves the same interface as static assets and calls public APIs directly; it does not execute Python. The included Python server is for local/personal use. A public Python service should use a production HTTP stack, HTTPS, shared rate limits, and provider plans appropriate to traffic. Open-Meteo's free geocoding endpoint is for non-commercial use.

## Validation

```bash
python -m unittest -v test_app.py
node --test test_catalog.cjs
node --check dist/app.js
node --check dist/bands.js
```

The 27 correctness tests cover worldwide and regional queries, locations on multiple continents, date-line geometry, cloud/radar filtering, date validation, composite overlap, pagination, provider failure isolation, metadata-driven bands, RGB channel order, grid compatibility, no-data transparency, and local HTTP behavior. Test fixtures are synthetic and are never displayed by the website.

External API/CDN requests were blocked or timed out in the build environment. Live provider retrieval and remote raster rendering therefore remain unverified end to end. No browser or visual QA is claimed. Errors are surfaced in the interface without replacing them with sample images.

## Source documentation

- Earth Search: https://github.com/Element84/earth-search
- Earth Search collections: https://earth-search.aws.element84.com/v1/collections
- Microsoft Planetary Computer catalogue: https://planetarycomputer.microsoft.com/catalog
- MODIS collection and bands: https://planetarycomputer.microsoft.com/api/stac/v1/collections/modis-09A1-061
- ALOS collection: https://planetarycomputer.microsoft.com/api/stac/v1/collections/alos-palsar-mosaic
- Planetary Computer asset access: https://planetarycomputer.microsoft.com/docs/concepts/sas/
- NASA GIBS: https://nasa-gibs.github.io/gibs-api-docs/access-basics/
- Open-Meteo geocoding: https://open-meteo.com/en/docs/geocoding-api
- GeoTIFF.js: https://github.com/geotiffjs/geotiff.js

Documentation checked on 9 September 2026. Availability and service terms can change.
