import unittest
from unittest.mock import patch
from crops import RangeFile

class PreviewRanges(unittest.TestCase):
    def test_contiguous_reads_share_requests_and_overlap_reuses_cache(self):
        data = bytes(range(251)) * 14000
        calls = []
        def fetch(reader, start, length):
            calls.append((start, length))
            reader.size = len(data)
            return data[start:start+length]
        with patch.object(RangeFile, '_fetch', fetch):
            with RangeFile('https://data.inpe.br/example.tif', [0]) as reader:
                reader.seek(65000)
                self.assertEqual(reader.read(2**21), data[65000:65000+2**21])
                self.assertEqual(len(calls), 4)  # length probe + three bounded requests
                reader.seek(120000)
                self.assertEqual(reader.read(260000), data[120000:380000])
                self.assertEqual(len(calls), 4)
                reader.seek(-5,2)
                self.assertEqual(reader.read(100),data[-5:])
                self.assertEqual(reader.read(1),b'')
                self.assertLessEqual(max(n for _,n in calls),2**20)
