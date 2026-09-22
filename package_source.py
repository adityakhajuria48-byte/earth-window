"""Package source and validation evidence with an explicit non-secret allowlist."""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent
names = {'package.json', 'package-lock.json', 'requirements-raster.txt', 'Dockerfile', 'render.yaml', '.dockerignore', '.gitignore'}
files = [p for p in ROOT.iterdir() if p.is_file() and (p.name in names or p.suffix in {'.py', '.cjs', '.md', '.mjs'})]
files += [p for p in (ROOT / 'dist').iterdir() if p.is_file() and p.suffix in {'.html', '.css', '.js', '.json', '.svg'}]
files += [p for p in (ROOT / 'validation').rglob('*') if p.is_file() and p.suffix in {'.py', '.csv', '.json', '.jsonl', '.md', '.txt', '.jpg'}]
target = ROOT / 'dist/earth-window-python.zip'
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
    for p in sorted(files):
        archive.write(p, p.relative_to(ROOT))
print(f'Packaged {len(files)} source/evidence files, {target.stat().st_size} bytes.')
