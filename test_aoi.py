"""Real ZIP/shapefile fixtures; no satellite data are fabricated."""
import io
import struct
import unittest
import zipfile
from pathlib import Path
import shapefile
from rasterio.crs import CRS
from rasterio.warp import transform
from aoi import parse_zip

OUTER = [[75.12,32.9],[75.12,32.94],[75.16,32.94],[75.16,32.9],[75.12,32.9]]
HOLE = [[75.13,32.91],[75.15,32.91],[75.15,32.93],[75.13,32.93],[75.13,32.91]]

def fixture(crs=4326, rings=None, missing=None, point=False):
    streams = {ext:io.BytesIO() for ext in ('shp','shx','dbf')}
    writer=shapefile.Writer(**streams, shapeType=1 if point else 5)
    writer.field('name','C')
    if point:
        writer.point(75.14,32.92)
    else:
        rings=rings or [OUTER,HOLE]
        if crs!=4326:
            rings=[list(zip(*transform('EPSG:4326',f'EPSG:{crs}',*[list(c) for c in zip(*ring)]))) for ring in rings]
        writer.poly(rings)
    writer.record('Synthetic test boundary, not satellite data');writer.close()
    data={ext:stream.getvalue() for ext,stream in streams.items()}
    data['prj']=CRS.from_epsg(crs).to_wkt().encode()
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as z:
        for ext,content in data.items():
            if ext!=missing:z.writestr('study-area/udhampur-test.'+ext,content)
    return output.getvalue()

class AreaTests(unittest.TestCase):
    def test_geographic_polygon_retains_hole_and_ignores_attributes(self):
        result=parse_zip(fixture())
        self.assertEqual(result['geometry']['type'],'Polygon')
        self.assertEqual(len(result['geometry']['coordinates']),2)
        self.assertEqual(result['bounds'],[75.12,32.9,75.16,32.94])
        self.assertNotIn('properties',result)

    def test_projected_utm_reprojects(self):
        result=parse_zip(fixture(32643))
        for got,expected in zip(result['bounds'],[75.12,32.9,75.16,32.94]):self.assertAlmostEqual(got,expected,5)

    def test_missing_components_rejected(self):
        for ext in ('prj','shx','dbf'):
            with self.subTest(ext=ext),self.assertRaisesRegex(ValueError,'matching'):parse_zip(fixture(missing=ext))

    def test_empty_corrupt_nonpolygon_and_crossing_rings_rejected(self):
        for payload in (b'',b'not a zip',fixture(point=True),fixture(rings=[[[0,0],[1,1],[1,0],[0,1],[0,0]]])):
            with self.subTest(size=len(payload)),self.assertRaises(ValueError):parse_zip(payload)

    def test_date_line_not_silently_misplaced(self):
        with self.assertRaisesRegex(ValueError,'date line'):
            parse_zip(fixture(rings=[[[179,0],[179,1],[-179,1],[-179,0],[179,0]]]))

    def test_zip_path_and_expansion_limits(self):
        for name,content in (('../outside.shp',b'abc'),('big.txt',b'0'*(40*1024*1024+1))):
            output=io.BytesIO()
            with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as z:z.writestr(name,content)
            with self.assertRaises(ValueError):parse_zip(output.getvalue())

    def test_hostile_point_count_bounded_before_parser(self):
        source=zipfile.ZipFile(io.BytesIO(fixture()));output=io.BytesIO()
        with zipfile.ZipFile(output,'w') as z:
            for name in source.namelist():
                content=bytearray(source.read(name))
                if name.endswith('.shp'):struct.pack_into('<i',content,148,2000000000)
                z.writestr(name,content)
        with self.assertRaisesRegex(ValueError,'20,000'):parse_zip(output.getvalue())

if __name__=='__main__':unittest.main()
