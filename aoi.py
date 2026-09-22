"""Bounded, temporary polygon shapefile import. Never extract uploaded paths."""
import io
import json
import math
from pathlib import PurePosixPath
import struct
import sys
import zipfile

MAX_UPLOAD = 10 * 1024 * 1024
MAX_EXPANDED = 40 * 1024 * 1024
MAX_VERTICES = 20000


def parse_zip(payload):
    import shapefile
    from rasterio.crs import CRS
    from rasterio.warp import transform_geom
    from shapely.geometry import shape, mapping
    from shapely.ops import unary_union

    if not 0 < len(payload) <= MAX_UPLOAD:
        raise ValueError("Upload a ZIP smaller than 10 MB.")
    try:
        archive = zipfile.ZipFile(io.BytesIO(payload))
    except zipfile.BadZipFile:
        raise ValueError("This is not a valid ZIP. Zip the .shp, .shx, .dbf and .prj files together.") from None
    with archive:
        entries = archive.infolist()
        if len(entries) > 100 or sum(i.file_size for i in entries) > MAX_EXPANDED:
            raise ValueError("The ZIP expands beyond the import limit. Export a smaller study area.")
        files = {}
        for entry in entries:
            path = PurePosixPath(entry.filename.replace("\\", "/"))
            if path.is_absolute() or ".." in path.parts or entry.flag_bits & 1:
                raise ValueError("Use an ordinary, unencrypted shapefile ZIP.")
            if entry.is_dir() or "__MACOSX" in path.parts or path.name.startswith("."):
                continue
            key = str(path).lower()
            if key in files:
                raise ValueError("The ZIP contains duplicate filenames.")
            files[key] = entry
        shapes = [key for key in files if key.endswith(".shp")]
        if len(shapes) != 1:
            raise ValueError("Include exactly one polygon shapefile layer in each ZIP.")
        stem = shapes[0][:-4]
        if any(stem + ext not in files for ext in (".shx", ".dbf", ".prj")):
            raise ValueError("Include matching .shp, .shx, .dbf and .prj files. The .prj tells us the coordinate system.")
        raw = {ext: archive.read(files[stem + ext]) for ext in (".shp", ".shx", ".prj")}
    # Bound declared point/part counts before PyShp allocates record arrays.
    shp = raw[".shp"]
    if len(shp) < 100 or struct.unpack_from(">i", shp)[0] != 9994:
        raise ValueError("The shapefile header is invalid.")
    offset, points, count = 100, 0, 0
    while offset < len(shp):
        if offset + 52 > len(shp):
            raise ValueError("The shapefile contains an empty or truncated record.")
        size = struct.unpack_from(">i", shp, offset + 4)[0] * 2
        kind = struct.unpack_from("<i", shp, offset + 8)[0]
        parts, vertices = struct.unpack_from("<ii", shp, offset + 44)
        if kind not in (5, 15, 25) or not 1 <= parts <= vertices <= MAX_VERTICES:
            raise ValueError("Use polygons only, with at most 20,000 vertices in total. Points and lines cannot define an image area.")
        if size < 44 + parts * 4 + vertices * 16 or offset + 8 + size > len(shp):
            raise ValueError("The shapefile record is invalid.")
        points += vertices
        count += 1
        if points > MAX_VERTICES or count > 500:
            raise ValueError("Limit the study area to 500 features and 20,000 vertices. Simplify it in GIS before uploading.")
        offset += 8 + size
    if len(raw[".shx"]) != 100 + count * 8:
        raise ValueError("The .shx index does not match the polygon records. Re-export the layer.")
    if not count:
        raise ValueError("The shapefile contains no polygons.")
    try:
        crs = CRS.from_wkt(raw[".prj"].decode("utf-8-sig"))
    except Exception:
        raise ValueError("The .prj coordinate system could not be read. Re-export the layer with its CRS in GIS.") from None
    polygons = []
    # Attributes are intentionally not read or returned; only the search boundary is needed.
    with shapefile.Reader(shp=io.BytesIO(shp), shx=io.BytesIO(raw[".shx"])) as reader:
        for record in reader.iterShapes():
            if any(not all(math.isfinite(v) for v in point[:2]) for point in record.points):
                raise ValueError("The boundary contains invalid coordinates.")
            original = shape(record.__geo_interface__)
            if original.is_empty or not original.is_valid:
                raise ValueError("The boundary has invalid or crossing polygon rings. Repair geometries in GIS and upload again.")
            geometry = transform_geom(crs, "EPSG:4326", mapping(original), precision=7)
            projected = shape(geometry)
            if projected.is_empty or not projected.is_valid:
                raise ValueError("This boundary could not be reprojected reliably. Export it in WGS 84 (EPSG:4326).")
            polygons.append(projected)
    merged = unary_union(polygons)
    bounds = list(merged.bounds)
    if not all(math.isfinite(v) for v in bounds) or not (-180 <= bounds[0] < bounds[2] <= 180 and -90 <= bounds[1] < bounds[3] <= 90):
        raise ValueError("The projected boundary is outside valid longitude/latitude coordinates. Check the .prj file.")
    if bounds[2] - bounds[0] > 180:
        raise ValueError("Split an area crossing the date line into separate east and west shapefiles before uploading.")
    return {"name": PurePosixPath(stem).name, "geometry": mapping(merged), "bounds": bounds,
            "features": count, "vertices": points, "sourceCRS": crs.to_string(), "crs": "EPSG:4326"}


if __name__ == "__main__":
    try:
        print(json.dumps(parse_zip(sys.stdin.buffer.read(MAX_UPLOAD + 1))))
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)
    except Exception:
        print(json.dumps({"error": "This shapefile could not be read. Re-export a polygon layer with its .shx, .dbf and .prj files."}))
        sys.exit(1)
