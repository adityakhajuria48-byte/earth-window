# Earth Window: 1,000-location validation

**22 September 2026 — actual network observations, not simulated imagery.**

All 1,000 selected locations were checked at three imagery zoom levels and one elevation level. **3,000/3,000 imagery checks passed**, including 351 checks that recovered real coarser imagery. Terrain passed at **991/1,000 locations initially** and **991/1,000 after the separately recorded recheck**. 991/1,000 locations passed all four checks at their latest observation.

These are **data/tile availability and decoding checks**. They are not 1,000 browser-rendering tests and do not certify worldwide 3D stability.

## Coverage and method

- 996 GeoNames cities plus four explicit landmarks: Udhampur, Anak Krakatau, Mount Everest and Aconcagua. The sample covers **244 country/territory codes**, not 244 sovereign countries, and is not an exhaustive or random global sample.
- Cities were selected in rounds across country/territory codes, largest population first within each code; duplicate coordinates were excluded. Extent: -54.28111° to 78.22334° latitude and -176.17453° to 179.36451° longitude. Polar regions, most open ocean and many rural environments are not represented.
- Every point was checked for containment in its calculated Web Mercator tile. Imagery was requested at zoom **8, 14 and 19**, using `blankTile=false`, then decoded as a real **256 × 256 JPEG**. Missing or failed fine tiles could recover from up to six parent levels, matching the map's ancestor selection.
- Elevation was requested at zoom **12**, decoded with LERC into **257 × 257** samples, checked for valid finite elevations and a plausible −12,000 to 10,000 m range. This is not independent DEM accuracy validation. Every successful initial elevation tile had all samples valid; reported min/max values describe a tile, not the summit or exact point.
- Six workers, at most six request starts per second, three attempts per tile, bounded connection/read timeouts and 2 MiB response limits. Nearby locations share cached tile checks. The follow-up used two workers. No paid services or credentials were added.
- The run was interrupted and resumed from recorded results. Timestamps, payload hashes, URLs, response sizes, status codes and retries are retained; first-pass failures were not overwritten.

## Initial imagery results

| Requested zoom | Checks passed | Native requested level | Coarser parent used |
| --- | ---: | ---: | ---: |
| 8 | 1,000/1,000 | 1,000 | 0 |
| 14 | 1,000/1,000 | 999 | 1 |
| 19 | 1,000/1,000 | 650 | 350 |

The first pass examined **4,097 unique imagery/elevation tile keys** through **4,477 HTTP attempts**. It recorded 475 missing-tile HTTP 404 responses and 0 HTTP 429 responses. It downloaded 87.4 MiB of valid tile data. These totals count tile requests, not unique locations; retries, shared tiles and ancestor requests are separate concepts.

Zoom-19 source levels varied from 13 to 19. A pass with a parent proves usable reference imagery was available; it does **not** prove high-resolution coverage. The reference mosaic has mixed acquisition dates and is never presented as the user's chosen satellite capture date.

## Failed terrain checks and follow-up

The 9 initially failed locations were rechecked separately; 0 recovered. Failures were connection/read timeouts or HTTP 502 responses, not corrupted LERC data. A network/proxy/service error does not establish that the provider lacks terrain at that location. Three Guam locations shared one failed tile.

| Location | Code | Separate recheck |
| --- | --- | --- |
| Franceville | GA | Still failed |
| Tamale | GH | Still failed |
| Boujdour | EH | Still failed |
| Pátra | GR | Still failed |
| Ebebiyin | GQ | Still failed |
| Tamuning-Tumon-Harmon Village | GU | Still failed |
| Thakhèk | LA | Still failed |
| Tamuning | GU | Still failed |
| Mangilao Village | GU | Still failed |

The CSV preserves both initial and latest status. The original JSONL remains unchanged. The follow-up is in `rechecks/`; total HTTP attempts including it: **4,534**.

## Actual browser checks and remaining limits

- **Udhampur, 32.916° N, 75.141° E:** imagery inspected at levels 10, 13, 16 and 19. At level 16, 24 loaded canvas tiles used native level-16 imagery. At level 19, all 24 loaded tiles used real level-18 imagery and the zoom-in control reached its limit. Buildings and roads remained visible without provider blank placeholders. Screenshots are included.
- **Anak Krakatau, 6.1009° S, 105.4233° E:** actual island imagery inspected at level 10; level-13 and level-16 loading were checked in the DOM. This is not a visual 3D terrain check.
- **Nuuk, 64.18347° N, 51.72157° W:** native level-13 imagery filled finer map levels, including all 30 loaded tiles at zoom 19. Strong enlargement remains blurry, and a boundary between coarse parent tiles remained visible at zoom 17. The new caption explicitly states that finer imagery is unavailable at the map centre. Whole-parent scaling avoids clipping the interpolation at each child crop, but **the remaining coarse-tile boundary is not marked resolved**.
- Requests that stall now advance to a real parent after 12 seconds. Unloaded tiles cancel callbacks and timers. A delayed initial 3D failure no longer resets the user's 2D zoom. Regression tests cover these behaviors and ancestor quadrant placement.
- **50 JavaScript regression tests passed** before this report was packaged. Python satellite-processing code was unchanged; its earlier 35-test result is historical, not a new run in this validation.
- The browser reported **“The browser supports WebGL, but initialization failed.”** Consequently, actual Cesium terrain mesh rendering, 3D zoom/tilt seams, GPU frame rate, context recovery, and globe before/after placement remain **unverified**. No GPU runner was provisioned, and no software/browser-policy bypass was attempted.

To close the 3D gap, run this exact build in a WebGL-capable browser and exercise the same location list with multiple heights and oblique angles, wait for terrain/imagery completion, record render/context errors, and inspect representative screenshots and failures. This report supplies the reproducible location list and data baseline; it does not claim those GPU tests ran.

## Files and reproduction

- `locations-1000.csv`, `locations-source.json`: sample and source attribution.
- `results-1000.csv`, `summary.json`, `final-summary.json`: per-location and aggregate results.
- `location-checks.jsonl`, `tile-checks.jsonl`, `rechecks/`: auditable original observations.
- `check_locations.py`, `recheck_failures.py`, `requirements.txt`: resumable checks and dependencies.
- Browser screenshots: `earth-window-udhampur-zoom16-20260922.jpg`, `earth-window-udhampur-zoom19-20260922.jpg`, and the Nuuk diagnostic views.

To run a fresh sample, copy `check_locations.py`, `recheck_failures.py`, `locations-1000.csv` and `requirements.txt` into an empty directory. Install the requirements in a virtual environment, run `python check_locations.py`, then `python recheck_failures.py`. Running inside an existing result directory resumes cached observations rather than making a fresh measurement. `write_report.py` combines the original and follow-up records; run it only after the application regression suite succeeds.

GeoNames source: https://download.geonames.org/export/dump/cities15000.zip — **CC BY 4.0**, [GeoNames](https://www.geonames.org/). Archive SHA-256: `cd4eac9a1adec3065e2e7ff884b30b51c9e1db006e1bd03422338809c2a46a80`. The four landmark coordinates were added explicitly.

Reference imagery: [Esri World Imagery](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer), credited to Esri, Vantor, Earthstar Geographics and the GIS User Community. Elevation: [Esri World Elevation](https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer). These service checks do not validate satellite archive date availability, band accuracy, cloud-free ground, or global geocoding.
