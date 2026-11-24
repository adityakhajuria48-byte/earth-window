import numpy as np
import pytest
rasterio = pytest.importorskip("rasterio")
from rasterio.transform import from_origin
from aether.raster import normalized_difference_from_files, read_band, write_float_raster

def _write(path, data, transform=None, nodata=-9999):
    profile = {"driver":"GTiff","height":data.shape[0],"width":data.shape[1],"count":1,"dtype":"float32","crs":"EPSG:32643","transform":transform or from_origin(500000,3200000,10,10),"nodata":nodata}
    with rasterio.open(path,"w",**profile) as dst: dst.write(data.astype("float32"),1)

def test_index_preserves_nodata_mask(tmp_path):
    a=tmp_path/"nir.tif"; b=tmp_path/"red.tif"
    _write(a,np.array([[3,4],[5,-9999]],dtype=np.float32)); _write(b,np.array([[1,2],[1,2]],dtype=np.float32))
    result, profile=normalized_difference_from_files(a,b)
    np.testing.assert_allclose(result[0,0],0.5,atol=1e-6)
    assert np.ma.getmaskarray(result)[1,1]
    assert profile["crs"].to_epsg()==32643

def test_rejects_misaligned_grid(tmp_path):
    a=tmp_path/"a.tif"; b=tmp_path/"b.tif"
    _write(a,np.ones((2,2),dtype=np.float32)); _write(b,np.ones((2,2),dtype=np.float32),from_origin(500010,3200000,10,10))
    with pytest.raises(ValueError,match="same dimensions"): normalized_difference_from_files(a,b)

def test_write_preserves_georeferencing_and_mask(tmp_path):
    src=tmp_path/"source.tif"; out=tmp_path/"output.tif"; _write(src,np.ones((2,2),dtype=np.float32))
    _,profile=read_band(src)
    values=np.ma.array([[.1,.2],[.3,.4]],mask=[[0,0],[1,0]])
    write_float_raster(out,values,profile)
    with rasterio.open(out) as ds:
        assert ds.crs.to_epsg()==32643
        assert ds.transform==profile["transform"]
        assert ds.nodata==-9999.0
        assert ds.read(1)[1,0]==-9999.0
