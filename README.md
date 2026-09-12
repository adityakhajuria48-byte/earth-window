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

The selectable map layers are **NASA Terra/MODIS daily overview** and **OpenStreetMap reference map**. These are map context, not satellite search filters. The NASA layer is a coarse daily mosaic, not the selected Sentinel, Landsat, or radar image. Footprints for the currently displayed result cards appear on the map and can be clicked. Pin results as Before A and After B, select bands, and choose Display on globe to drape supported source pixels over terrain. Thumbnails and local band previews remain available in the details panel. The Web Mercator map cannot display the poles, but geographic coordinate search accepts latitude −90 to 90.

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

The globe uses real **Mapzen Terrarium elevation tiles**, sampled into heightmaps. Mountains, valleys and volcano relief come from reference elevation data. Terrain age and resolution vary; it does not represent the chosen capture date or guarantee recent volcanic changes. Terrain can be disabled or exaggerated at 2× / 3×, with actual scale as the default. Provider credits are available in Layers & compare. This visual terrain is not a surveyed elevation analysis.

### Put imagery on terrain

1. Search a place, coordinates, region, or the whole world and choose a capture window.
2. Pin an earlier result with **Before A** and a later result with **After B**.
3. In **Layers & compare**, choose each image's real bands or an available colour combination.
4. Select **Display on globe**, then move the comparison slider. Uncheck **Compare A and B** to show A alone.
5. To compare coarse daily coverage without selecting archive captures, choose **Daily overview dates** and two Terra/MODIS dates.

Source bands are decoded into bounded previews, reprojected to geographic coordinates, and draped directly over the globe. Supported grids are north-up WGS84 geographic, Web Mercator, and WGS84 UTM in either hemisphere. Rotated grids, unsupported projections (including MODIS sinusoidal archive grids), and tiles crossing the date line are rejected explicitly; original files and local previews remain available. NASA's geographic daily overview comparison is available independently. Globe preview textures are at most 768 pixels per side and derive from source previews of at most 512 pixels per side; no extra source detail is created.

Before/after requires chronological, non-overlapping product periods and intersecting image bounds. Matching band choices from the same satellite family use shared display limits. Other comparisons use independent contrast stretches and say so. Clouds, different processing, and registration can still differ; visual colour differences are not proof of ground change. Terrain stays the same on both sides. Global search is supported, but not every satellite, projection, place, or requested instant has a viewable image.

CesiumJS 1.127 loads asynchronously from its official CDN. No Cesium ion account or token is required. The renderer draws on demand, pauses when hidden or in 2D, and respects reduced-motion preferences. A WebGL1 compatibility attempt follows a WebGL initialization failure; if graphics remain unavailable, the 2D map and search continue. Web Mercator terrain and overview tiles exclude the extreme poles, though polar coordinates remain searchable.

The map fills the workspace. Search, Layers & compare, and Results can each be collapsed; narrow screens show one open panel at a time. The fullscreen button requests browser fullscreen where supported. Browser permissions may prevent native fullscreen; the application still fills its page.

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

Catalogue documentation checked 9 September 2026; new terrain and overlay references checked 12 September 2026. Availability and service terms can change.
