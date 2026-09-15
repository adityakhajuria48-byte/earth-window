# Earth Window

**Explore any location in the world. Earth Window searches connected satellite archives automatically and tells you which satellites have data.** There is no satellite-selection step.

The app includes a full-screen 3D terrain workspace, globe imagery and before/after comparison, actual capture times, labelled composite periods, optical cloud filters, original data links, metadata export, and band controls specific to each image. It opens on the whole-world map with no preselected city and a recent date. Search any city, enter any valid `latitude, longitude`, or click anywhere on the map for local imagery and bands. Use **Search map area** for a region or **Whole world** to remove the geographic filter.

## Run the Python website

Install **Python 3.10+**, open a terminal inside this folder, then run:

```bash
python app.py
```

On Windows, `py app.py` also works. Open **http://127.0.0.1:8000**. Stop with Ctrl+C. There are no Python packages to install. Internet access is needed for satellite archives, map tiles, geocoding, CesiumJS, Leaflet, fonts, and the optional raster viewer.

## Automatically searched archives

All 17 configured collections are queried for every search; users do not have to choose a satellite. The agency countries identify who operates the satellites, not where imagery can be searched. Locations in other countries are fully supported wherever those archives have acquisitions.

| Satellite family | Operator / programme | Data | Time handling |
| --- | --- | --- | --- |
| Sentinel-2 | ESA / Copernicus, Europe | L2A optical imagery, including the newer Collection 1 archive | Individual capture times; duplicate reprocessing is collapsed when platform, time, and tile match |
| Landsat | USGS / NASA, United States | Collection 2 Level 2 optical and available thermal data | Individual capture times |
| Sentinel-1 | ESA / Copernicus, Europe | GRD radar and available polarizations | Individual capture times; cloud filter does not exclude radar |
| Terra / Aqua MODIS | NASA, United States | 500 m surface reflectance and data layers | Explicit 8-day composite period |
| ALOS / ALOS-2 PALSAR | JAXA, Japan | 25 m annual radar mosaics | Explicit annual period, never a fabricated capture time |
| Resourcesat-1 | ISRO, India; hosted by INPE | LISS-III and AWiFS original band files, regional holdings | Acquisition day only; exact time unreported |
| CBERS-4 / CBERS-4A | China / Brazil; hosted by INPE | MUX surface reflectance and WPM original bands, regional holdings | MUX uses day precision; WPM uses the supplied acquisition time |
| Sentinel-1 SLC / Sentinel-2 L1C | Copernicus / CDSE | Searchable complex SAR and optical records; provider account required for files | Supplied acquisition time / interval |
| Sentinel-3 | Copernicus / CDSE | OLCI full-resolution radiance and SLSTR radiance / brightness temperature, NTC products; account required | Acquisition intervals; time at an exact ground point is not determined |
| Sentinel-5P | Copernicus / CDSE | Offline sulphur dioxide and nitrogen dioxide NetCDF products; account required | Atmospheric observations, not detailed ground photographs |
| Sentinel-6 | Copernicus / CDSE | P4 Level 2 NTC altimetry products; account required | Track observations with acquisition intervals, not full ground imagery |

The catalogue hosts are **Element 84 Earth Search**, **Microsoft Planetary Computer**, **INPE**, and **Copernicus Data Space (CDSE)**. Individual platform names come from each result’s metadata, with a documented single-platform collection label used for INPE records when the item omits it. If the platform is missing, the interface says so instead of guessing which satellite captured it.

These archives cover many parts of the world, not every satellite or every place. Mission coverage, historical availability, clouds, processing delays, and provider access determine whether data exists. Optical imagery cannot show the ground through clouds. A footprint intersection does not guarantee valid pixels at the selected point. The Guide lists official routes to wider ISRO Bhoonidhi holdings, China’s CRESDA, Japan’s G-Portal, early Landsat MSS through EarthExplorer, and additional Copernicus products. These portal links are **not automatic connections** and are excluded from search-completion counts. Bhoonidhi API access needs an approved provider account; no credentials are configured or collected by this static website. Sentinel-4/5, the complete Sentinel product catalogue, the entire Landsat historical series, and all national missions are not claimed as connected.

INPE supplies regional holdings, mainly in South America. Indian satellite ownership does not mean these particular holdings cover India. All searches still use the requested geometry without a country restriction. Searches of new INPE collections returned records at their real footprints and no results at a distant unrelated point. Original raster byte-range requests succeeded; the tested raster responses did not allow browser cross-origin access. Original file download links are offered, with browser rendering disabled for these collections. Open the downloaded data in GIS software. Large non-COG rasters are not falsely labelled as browser-ready.

CDSE catalogue searches are public. Its asset metadata declares authentication requirements; S3 assets expose provider-supplied HTTPS alternatives. These are listed with their real band / file names, but download and rendering controls remain disabled until accessed through the provider. No authenticated data access or token handling is claimed. Scene IDs and original metadata links allow users to locate the exact product there.

## Band options

Open any result to inspect the **bands and data layers actually listed in that record**:

- Select an individual band or data layer and open its original file.
- Render a downsampled grayscale preview from an accessible GeoTIFF.
- Use true colour (red / green / blue), vegetation false colour (NIR / red / green), or SWIR false colour (SWIR1 / NIR / red) only when all required bands are exposed.
- Radar assets can expose VV, VH, HH, or HV polarizations; the UI lists only the polarizations actually present.
- Save a rendered preview as PNG. Provider-supplied thumbnails remain labelled separately.

Band names, wavelengths, and data links are read from STAC asset metadata, including provider-supplied HTTPS alternatives and INPE band-level no-data / pixel spacing. Provider spectral metadata can contain inaccuracies; original documentation remains authoritative. Quality flags, observation angles, and other raster data layers can also appear. The original file is the authoritative data product.

The GeoTIFF preview uses a suitable small overview, a maximum display dimension of 512 pixels, nearest-neighbour sampling, transparent no-data, and a separate 2–98% contrast stretch for each display channel. It rejects mixed grids and oversized rasters without a usable overview. **These previews are display products, not calibrated quantitative analyses or crops of the selected point.** An RGB combination does not add resolution. GeoTIFFs blocked by browser access rules and HDF/NetCDF assets can be opened in geospatial software instead. Exploratory NDVI, green–NIR NDWI, and NBR previews are offered only for supported Level-2 surface-reflectance collections with explicit band calibration. See the discovery workspace notes below.

For Azure assets, the viewer requests short-lived access links from Microsoft Planetary Computer when the user opens or renders the data. It does not embed credentials or save those access links in exports.

## Search correctness and reliability

- Worldwide mode sends no geographic filter. Point mode accepts any latitude/longitude, and area mode supports map bounds, including regions crossing the date line.
- Exact-day, ±7-day, and ±30-day windows use UTC. Single-capture searches are clipped to the current time.
- Composite searches expand the provider query to find periods overlapping the requested dates, then filter those periods for overlap. They are labelled as composites and ranked after individual captures in the default time sort.
- The optical cloud filter retains unreported cloud values with an explicit label. Radar is always retained regardless of cloud cover.
- Each source reports complete, partial, or unavailable status. A failed archive never becomes a claim of no coverage.
- Hosted searches show results as each source finishes. The Python server queries the sources concurrently and returns their combined result.
- Pagination is limited to three pages of 100 records per collection (20 per page for CDSE), requested in provider order (newest first where the sort extension is supported). Worldwide and broad-area results are limited catalogue pages, not an exhaustive world inventory. Time sorting orders the loaded results; it does not guarantee the globally nearest acquisition. Zoom into a region or select a point for focused coverage. Partial results are clearly reported; narrow the time window when necessary.
- Result rendering is limited to 30 cards at a time, with a Show more button. Export includes all returned matching records, along with search settings and archive status.
- Dates and inputs are validated. Source URLs and pagination hosts are constrained. Python caches JSON responses for five minutes and avoids logging searched coordinates.

## Map context

The selectable map layers are **NASA Blue Marble reference mosaic**, **NASA Terra/MODIS daily overview**, and **OpenStreetMap reference map**. These are map context, not satellite search filters. Blue Marble is the default and is explicitly labelled as reference imagery, independent of the selected search date. The initial 2D view fills the workspace instead of showing a small isolated world tile. The NASA layer is a coarse daily mosaic, not the selected Sentinel, Landsat, or radar image. Footprints for the currently displayed result cards appear on the map and can be clicked. Pin results as Before A and After B, select bands, and choose Display on globe to drape supported source pixels over terrain. Thumbnails and local band previews remain available in the details panel. The Web Mercator map cannot display the poles, but geographic coordinate search accepts latitude −90 to 90.

## Development steps

1. Define the search around location, UTC time, and availability rather than a mandatory satellite choice.
2. Maintain a shared registry of verified public catalogue collections in `dist/sources.json`.
3. Query every collection, paginate within limits, isolate provider failures, and combine results.
4. Normalize satellite identities and distinguish capture timestamps from composite periods.
5. Discover per-item assets and expose only real bands, with original-file access and bounded raster previews.
6. Add clear availability summaries, responsive controls, keyboard-accessible dialogs, loading/error states, and progressive results.
7. Decode Mapzen Terrarium heights into Cesium heightmaps, with terrain-aware picking and optional elevation exaggeration.
8. Reproject supported GeoTIFF grids into geographic image overlays; preserve no-data transparency and reject unsupported georeferencing.
9. Pin dated captures, validate chronology and overlap, and compare split imagery on one terrain surface. Use common display limits for matching band choices within a satellite family.
10. Make search, results, and imagery controls collapsible over a full-screen workspace.
11. Run correctness tests and browser checks with actual archive data; record graphics and provider limitations explicitly.
12. Publish the static interface and keep the Python edition and GitHub source synchronized.

## Code layout

| File | Responsibility |
| --- | --- |
| `app.py` | Python HTTP server, validation, concurrent catalogue search, time ranges, cloud filtering, caching, geocoding |
| `dist/globe.js` | Cesium globe, terrain-aware navigation, footprints, imagery layers, swipe splitting and 2D fallback |
| `dist/terrain.js` | Open elevation tile decoding and Cesium heightmap provider |
| `dist/surface.js` | Source-grid reprojection and shared display limits |
| `dist/studio.js` | Capture pinning, band selection, dates, comparison and panel state |
| `dist/geocoding.js`, `dist/landmarks.json` | Worldwide Photon place search, city fallback, and sourced exact landmark aliases |
| `dist/sources.json` | Shared satellite archive registry |
| `dist/catalog.js` | Pure catalogue normalization, deduplication, band discovery, temporal matching, preview pixel stretch |
| `dist/bands.js` | Band controls, provider asset authorization, GeoTIFF reading, preview and PNG export |
| `dist/app.js` | Map, automatic search, result cards, source availability and details |
| `dist/index.html`, `dist/styles.css`, `dist/workspace.css` | Responsive interface and accessible controls |
| `dist/backend-config.js` | Static mode flag; Python overrides this route to enable its API |
| `test_app.py`, `test_catalog.cjs`, `test_globe.cjs`, `test_surface.cjs` | Python and JavaScript correctness tests |

The **Python edition** runs catalogue and place queries through the local Python server. The **hosted Sites edition** serves the same interface as static assets and calls public APIs directly; it does not execute Python. The included Python server is for local/personal use. A public Python service should use a production HTTP stack, HTTPS, shared rate limits, and provider plans appropriate to traffic. Open-Meteo's free geocoding endpoint is for non-commercial use.

## 3D Earth explorer

Earth Window opens a rotatable CesiumJS globe, with zoom, whole-Earth view, an oblique-view toggle, and keyboard-accessible navigation buttons. Click Earth to select coordinates; search names (including Mount Anak Krakatau) to fly to a location. Search map area uses the 3D camera's geographic bounding rectangle, which can include space outside the visible curved region. The existing 2D map remains available from the view switch and is selected automatically if 3D loading or graphics fail.

The globe uses real **Mapzen Terrarium elevation tiles**, sampled into heightmaps. Mountains, valleys and volcano relief come from reference elevation data. Terrain age and resolution vary; it does not represent the chosen capture date or guarantee recent volcanic changes. Terrain can be disabled or exaggerated at 2× / 3×, with actual scale as the default. Provider credits are available under Imagery → Terrain & elevation. This visual terrain is not a surveyed elevation analysis.

### Put imagery on terrain

1. Search a place, coordinates, region, or the whole world and choose a capture window.
2. Pin an earlier result with **Before A** and a later result with **After B**.
3. In **Imagery**, choose each image's real bands or an available colour combination.
4. Select **Display on globe**, then move the comparison slider. Uncheck **Compare A and B** to show A alone.
5. To compare coarse daily coverage without selecting archive captures, choose **Daily overview dates** and two Terra/MODIS dates.

Source bands are decoded into bounded previews, reprojected to geographic coordinates, and draped directly over the globe. Supported grids are north-up WGS84 geographic, Web Mercator, and WGS84 UTM in either hemisphere. Rotated grids, unsupported projections (including MODIS sinusoidal archive grids), and tiles crossing the date line are rejected explicitly; original files and local previews remain available. NASA's geographic daily overview comparison is available independently. Globe preview textures are at most 768 pixels per side and derive from source previews of at most 512 pixels per side; no extra source detail is created.

Before/after requires chronological, non-overlapping product periods and intersecting image bounds. Matching band choices from the same satellite family use shared display limits. Other comparisons use independent contrast stretches and say so. Clouds, different processing, and registration can still differ; visual colour differences are not proof of ground change. Terrain stays the same on both sides. Global search is supported, but not every satellite, projection, place, or requested instant has a viewable image.

CesiumJS 1.127 loads asynchronously from its official CDN. No Cesium ion account or token is required. The renderer draws on demand, pauses when hidden or in 2D, and respects reduced-motion preferences. A WebGL1 compatibility attempt follows a WebGL initialization failure; if graphics remain unavailable, the 2D map and search continue. Web Mercator terrain and overview tiles exclude the extreme poles, though polar coordinates remain searchable.

The map fills the workspace. Search, Imagery, and Captures can each be collapsed. Search and Imagery share a compact side-panel position; Captures appear as a horizontal filmstrip beside them. Narrow screens show one open panel at a time. Time and cloud controls are under Refine your search, and terrain settings are under Terrain & elevation. The fullscreen button requests browser fullscreen where supported. Browser permissions may prevent native fullscreen; the application still fills its page.

## Landmark search

Search by city, mountain, volcano, island, or latitude/longitude. Photon searches OpenStreetMap places worldwide, with no country restriction or hidden map bias. Open-Meteo/GeoNames remains a city fallback. Search runs on explicit submission only, uses bounded results, throttling, and five-minute caching. Photon permits reasonable public API use without an availability guarantee; high-volume deployments should run their own instance. See [Photon documentation](https://github.com/komoot/photon).

`Mount Anak Krakatau`, `Gunung Anak Krakatau`, and `Anak Krakatoa` (also with `Indonesia`) resolve locally from `dist/landmarks.json`. The point **−6.1009, 105.4233** comes from the [Smithsonian GVP Krakatau profile](https://volcano.si.edu/volcano.cfm?vn=262000), checked 9 September 2026. It is a volcano reference point for imagery search, not a surveyed summit position. This curated record contains location metadata only, never imagery or fabricated archive results. Other landmarks use the live global geocoder. Unqualified `Krakatau` is left to that geocoder to avoid confusing the wider volcanic complex with Anak Krakatau.

An unmatched name and a failed provider produce different messages. Coordinates and map clicks remain available independently of geocoding. Successful location lookup does not guarantee imagery on the requested date.

## Development and validation

The Python edition needs no package installation. For an optional static development server, install Node.js 22.12+ and run:

```bash
npm ci
npm run dev
```

Correctness checks:

```bash
python -m unittest -v test_app.py
npm test
```

On 12 September 2026, **19 Python tests and 25 JavaScript tests passed**. Coverage includes worldwide queries, date-line regions, composite periods, cloud/radar filtering, failure isolation, real-band discovery, channel order, grid alignment, no-data transparency, HTTP serving, landmark resolution, Terrarium elevation decoding, reprojection orientation and error cases, shared display limits, and chronological comparison. Synthetic fixtures are test-only and never shown on the site.

Browser checks used the local preview with live provider data. Mount Anak Krakatau resolved to the sourced reference location. A 1 September 2024 search returned six MODIS products; two archives completed and four Earth Search collections were unavailable in this environment. The UI reported incomplete coverage. Single-band and true-colour MODIS previews rendered successfully from actual source raster pixels. Capture pinning, band selection, collapsible panels, missing-capture validation, overlapping composite rejection, reversed-date rejection, and the unavailable-3D message were checked. The desktop workspace had no horizontal page overflow.

**The test browser could not initialize either WebGL2 or WebGL1.** Actual 3D terrain rendering, image placement on the globe, camera motion over terrain, and the visual swipe remain unverified in a graphics-capable browser. Native fullscreen was also unavailable in this browser; the full-page workspace remained usable. These limits are not treated as passed visual checks. No sample imagery substitutes for failed requests.

## Workspace redesign · 13 September 2026

The interface now uses a consistent dark palette, warm accent colour, compact forms, simpler navigation, and a continuous world map. Search settings, capture cards, band controls, and dialogs share the same visual system. The NASA Blue Marble reference layer comes from the provider's published WMTS capabilities; dated MODIS imagery remains a separate option. Source pixels are never replaced with generated artwork.

Browser checks after the redesign confirmed the reference mosaic loads, Mount Anak Krakatau search returns live MODIS records, capture pinning opens the band controls and collapses Search, and supported band choices remain available. Existing 19 Python and 25 JavaScript checks pass. The browser's WebGL initialization limitation persists; no GPU CI pipeline was added.

### Closing the 3D validation gap

Use a browser/runner where WebGL2 initializes successfully. A virtual display or `--enable-gpu` flag alone does not supply a physical GPU; software rendering can exercise WebGL but should be reported separately from hardware acceleration.

1. Record the browser version, WebGL renderer, context creation errors and context-loss events. Fail the rendering check if the app falls back to 2D.
2. Wait for Cesium's terrain and imagery tile queues to settle and for a subsequent rendered frame, with a bounded timeout. Capture provider failures and render errors.
3. Inspect a known mountain and volcano at actual elevation scale; verify several DEM sample heights against the source data. Recent volcano relief may differ from reference DEM age.
4. Drape a georeferenced Sentinel/Landsat scene, compare coastlines and known control points against original raster coordinates, and check both UTM hemispheres. Reject unsupported projections explicitly.
5. Switch individual bands and colour composites, compare two non-overlapping capture periods, move the split slider, and confirm labels, no-data areas, and registration visually.
6. Capture baseline and current screenshots with fixed camera, dates, source assets, viewport, browser and renderer. Review intended changes before approving baselines; differences between GPU drivers must not be mistaken for geographical errors.

This procedure is a validation plan, not evidence that 3D placement has already passed.

## Source documentation

- Earth Search: https://github.com/Element84/earth-search
- Earth Search collections: https://earth-search.aws.element84.com/v1/collections
- Microsoft Planetary Computer catalogue: https://planetarycomputer.microsoft.com/catalog
- MODIS collection and bands: https://planetarycomputer.microsoft.com/api/stac/v1/collections/modis-09A1-061
- ALOS collection: https://planetarycomputer.microsoft.com/api/stac/v1/collections/alos-palsar-mosaic
- Planetary Computer asset access: https://planetarycomputer.microsoft.com/docs/concepts/sas/
- NASA GIBS: https://nasa-gibs.github.io/gibs-api-docs/access-basics/
- Open-Meteo geocoding: https://open-meteo.com/en/docs/geocoding-api
- CesiumJS Viewer: https://cesium.com/downloads/cesiumjs/releases/1.127/Build/Documentation/Viewer.html
- GeoTIFF.js: https://github.com/geotiffjs/geotiff.js

- Terrain tile documentation: https://github.com/tilezen/joerd
- Terrain provider credits: https://github.com/tilezen/joerd/blob/master/docs/attribution.md
- Cesium heightmaps: https://cesium.com/downloads/cesiumjs/releases/1.127/Build/Documentation/HeightmapTerrainData.html
- Cesium geographic image overlays: https://cesium.com/downloads/cesiumjs/releases/1.127/Build/Documentation/SingleTileImageryProvider.html
- Proj4js: https://github.com/proj4js/proj4js
- NASA WMTS layer registry: https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml
- Browser screenshot comparisons: https://playwright.dev/docs/test-snapshots
- GPU test setup: https://developer.chrome.com/blog/supercharge-web-ai-testing

Catalogue documentation checked 9 September 2026; new terrain and overlay references checked 12 September 2026. Availability and service terms can change.

## Archive expansion · 15 September 2026

- Added four INPE collections and seven public CDSE catalogue collections to automatic search. INPE rejects `sortby`; its adapter omits that parameter. CDSE responses are limited to 20 items per page, at most three pages; other sources retain 100 per page and three pages. Nearest means nearest **loaded** record, not a guaranteed exhaustive search.
- New day-precision and acquisition-interval labels prevent invented capture instants. Source, access status, nominal resolution, and coverage remain visible in the details.
- Added regression coverage for day-only matching, provider query differences, authentication-restricted HTTPS alternatives, real INPE band combinations and malformed assets.
- Official provider references checked 15 September 2026: [INPE collections](https://data.inpe.br/bdc/stac/v1/collections), [CDSE STAC](https://documentation.dataspace.copernicus.eu/APIs/STAC.html), [Bhoonidhi API](https://bhoonidhi.nrsc.gov.in/bhoonidhi-api/), [JAXA G-Portal information](https://earth.jaxa.jp/en/data/2503/index.html), [USGS EarthExplorer](https://earthexplorer.usgs.gov/), [CRESDA](https://www.cresda.cn/zgzywxyyzxeng/index_pc.html).

Verification for this expansion: **21 Python tests and 29 JavaScript tests passed**. Live INPE point/date searches returned Resourcesat-1 LISS-III and AWiFS, CBERS-4 MUX and CBERS-4A WPM records; original raster range requests returned HTTP 206. An unrelated northern-India point returned zero records from these regional collections for 12 September 2013. All seven new CDSE collection endpoints returned actual sample products in live API checks.

Browser checks found two Resourcesat-1 records at −5.8358, −60.5674 on 12 September 2013, alongside two MODIS composites. Their four real bands, false-colour choices, original-file control and explicit day-only time labels were inspected. A search at 33, 75 on 10 September 2025 returned 11 records from Sentinel-2A, Sentinel-3A and Sentinel-5P. Sentinel-3 SLSTR details exposed real file/channel metadata and correctly disabled authenticated file access and rendering. The archive guide distinguished connected collections from external provider links. In each browser search, 12 of 17 collections completed and five were unavailable; incomplete coverage was visible. Provider availability can change. The browser again fell back to 2D because WebGL could not initialize; 3D placement remains unverified.

## Date-first discovery workspace · 15 September 2026

The result workspace now includes a UTC availability timeline based on **loaded, filtered records**. Day buttons show acquisition counts separately from composites overlapping that day. Selecting a day filters existing records without silently changing the requested search date/time or making new provider requests. All dates restores the complete loaded set. Empty days mean no loaded matches, not verified absence of satellite imagery. GeoJSON exports record the selected day and sort order.

Best available match ranks ground imagery before atmospheric/altimetry products, then access (browser-preview candidates, public downloads, protected records), temporal precision (timed acquisitions, day-only acquisitions, composites), proximity to requested time, reported scene cloud, and finest nominal band spacing. Separate closest-time, cloud, detail and newest ordering remain available. Suggested cards open the recommended record directly. Unknown cloud values and radar are never presented as clear optical ground. Ranking cannot establish the nearest acquisition outside loaded pages or prove valid pixels at the chosen point.

Band details expose wavelength, pixel spacing, units, no-data, scale and offset when supplied. Single-band previews show their actual raw-value stretch limits. For supported surface-reflectance collections only, indices appear when both required accessible bands report a positive scale and valid offset:

| Preview | Formula | Inputs |
| --- | --- | --- |
| NDVI | (NIR − Red) / (NIR + Red) | Surface reflectance |
| NDWI | (Green − NIR) / (Green + NIR) | Green–NIR water index, not the NIR–SWIR moisture index |
| NBR | (NIR − SWIR2) / (NIR + SWIR2) | Surface reflectance |

Pixels are converted using `raw * scale + offset` before the ratio. Both rasters must have matching grids and projection metadata; unsupported alignment is rejected. Source no-data, nonpositive/near-zero denominators and ratios outside [−1,1] are transparent. Index previews use a fixed blue–neutral–green scale from −1 to +1. Their displayed valid range refers only to downsampled pixels. Clouds, shadows, saturation and product quality flags are **not masked**. These are exploratory full-tile PNG previews, not validated classifications, original-resolution index products or georeferenced crop exports. Indices are not yet offered as globe layers.

### Backend and validation work still needed

The published Site remains static. The existing Python edition provides catalogue/geocoding requests and short-lived JSON caching; this release does not deploy a hosted Python raster processor. Sites' server capability expects Cloudflare-compatible JavaScript, and no external Python hosting account is connected here. A Python processing deployment needs a suitable connected host, raster processing dependencies, bounded work queues and caching, and authorized provider access before protected imagery can be served. Do not put provider passwords or tokens into static files or GitHub. Wider Bhoonidhi data access requires the provider-approved account; protected Copernicus data requires authorized authentication.

Full-resolution georeferenced crops, scientific cloud/quality masking and rigorous cross-date alignment remain separate unfinished processing work. The previous GPU validation gap remains: 3D terrain placement needs a browser with a functioning WebGL context. Existing split-image comparison has not become a verified analytical change-detection product.

References checked for this implementation: [USGS NDVI](https://www.usgs.gov/landsat-missions/landsat-normalized-difference-vegetation-index), [USGS NBR](https://www.usgs.gov/landsat-missions/landsat-normalized-burn-ratio), [USGS scale and offset](https://www.usgs.gov/faqs/how-do-i-use-a-scale-factor-landsat-level-2-science-products), [Sentinel Hub green–NIR NDWI](https://custom-scripts.sentinel-hub.com/custom-scripts/sentinel-2/ndwi/).

Verification: 34 JavaScript tests and 21 Python tests pass. New tests cover midnight-spanning acquisitions, composite counts, usable-data ranking versus nearest-time ranking, unknown/radar cloud handling, calibrated-index eligibility, additive offsets, no-data transparency and mismatched-grid rejection. Browser checks at Anak Krakatau for 25 August–8 September 2024 returned 34 live records, and selecting 7 September reduced the view to its one record; All dates restored the list. Historical Resourcesat records correctly ranked as public downloads with day-only precision. MODIS returned HTTP 502 during the index check, so live source-pixel index rendering could not be verified in this session. Formula and pixel behaviour passed deterministic unit tests; that does not replace end-to-end live raster verification.
