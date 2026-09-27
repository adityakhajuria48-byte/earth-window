"""Reproducible synthetic boundary ZIPs; never satellite imagery."""
import io,json,math,zipfile,hashlib,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import shapefile
from rasterio.crs import CRS
from rasterio.warp import transform
from aoi import parse_zip
root=Path(__file__).resolve().parent

def fixture(lon,lat,variant):
    crs=4326 if variant<2 else (32600 if lat>=0 else 32700)+min(60,int((lon+180)//6)+1) if variant==2 else 3857
    outer=[[lon-.03,lat-.02],[lon-.03,lat+.02],[lon+.03,lat+.02],[lon+.03,lat-.02],[lon-.03,lat-.02]]
    hole=[[lon-.01,lat-.01],[lon+.01,lat-.01],[lon+.01,lat+.01],[lon-.01,lat+.01],[lon-.01,lat-.01]]
    records=[[outer,hole] if variant==1 else [outer]]
    if variant==2:records.append([[[x+.09,y] for x,y in outer]])
    if variant==3:
        ring=[[lon+.03*math.cos(-2*math.pi*i/32),lat+.02*math.sin(-2*math.pi*i/32)] for i in range(32)];ring.append(ring[0]);records=[[ring]]
    streams={ext:io.BytesIO() for ext in ('shp','shx','dbf')}
    with shapefile.Writer(**streams,shapeType=5) as w:
        w.field('name','C')
        for rings in records:
            projected=[list(zip(*transform('EPSG:4326',f'EPSG:{crs}',*[list(c) for c in zip(*ring)]))) for ring in rings]
            w.poly(projected);w.record('Synthetic regression boundary')
    members={ext:b.getvalue() for ext,b in streams.items()};members['prj']=CRS.from_epsg(crs).to_wkt().encode()
    return members,crs

def pack(members,prefix='boundary'):
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        for ext,data in members.items():z.writestr(prefix+'.'+ext,data)
    return out.getvalue()

centres=[(75.14,32.92),(105.4233,-6.1009)]+[(-165+i*14, -50+(i*17)%120) for i in range(23)]
rows=[]
with zipfile.ZipFile(root/'shapefile-fixtures.zip','w',zipfile.ZIP_DEFLATED) as bundle:
    for index,(lon,lat) in enumerate(centres):
        for variant in range(4):
            case=f'area-{index*4+variant+1:03}'
            members,crs=fixture(lon,lat,variant)
            data=pack(members,'STUDY/Boundary' if variant%2 else 'boundary')
            expected=parse_zip(data)
            assert abs(expected['bounds'][0]-(lon-.03))<1e-6
            assert abs(expected['bounds'][1]-(lat-.02))<1e-6
            bundle.writestr(case+'.zip',data)
            rows.append({'id':case,'kind':['polygon','hole','multipart UTM','Mercator 33 vertices'][variant],'crs':crs,'expected_bounds':expected['bounds'],'features':expected['features'],'vertices':expected['vertices'],'sha256':hashlib.sha256(data).hexdigest(),'python':'passed'})
    for i in range(20):
        members,_=fixture(75.14,32.92,0)
        kind=['missing prj','missing shx','missing dbf','empty prj','corrupt shp'][i%5]
        if i%5<3:del members[['prj','shx','dbf'][i%5]]
        elif i%5==3:members['prj']=b''
        else:members['shp']=b'not a shapefile'
        data=pack(members,f'rejected-{i}');case=f'invalid-{i+1:03}'
        bundle.writestr(case+'.zip',data)
        try:parse_zip(data);raise AssertionError('Invalid fixture accepted')
        except ValueError:pass
        rows.append({'id':case,'kind':kind,'reject':True,'python':'correctly rejected','sha256':hashlib.sha256(data).hexdigest()})
(root/'shapefile-cases.json').write_text(json.dumps(rows,indent=2)+'\n')
sample,_=fixture(75.14,32.92,1)
Path('dist/sample-study-area.zip').write_bytes(pack(sample,'udhampur-sample'))
print(json.dumps({'valid':100,'invalid':20,'python_passed':len(rows)}))
