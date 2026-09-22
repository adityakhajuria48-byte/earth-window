"""One separate, recorded recheck of failed locations; preserves initial results."""
import concurrent.futures as cf
import json
from pathlib import Path

import check_locations as checks

ROOT = Path(__file__).resolve().parent


def main():
    initial = [json.loads(line) for line in (ROOT / 'location-checks.jsonl').read_text().splitlines()]
    assert len(initial) == 1000, 'Finish the initial 1,000-location run first.'
    checks.ROOT = ROOT / 'rechecks'
    checks.ROOT.mkdir(exist_ok=True)
    path = checks.ROOT / 'location-checks.jsonl'
    results = [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
    done = {r['id'] for r in results}
    failed = [{k: r[k] for k in ('id', 'name', 'country', 'lat', 'lon')} for r in initial if not r['ok'] and r['id'] not in done]
    with cf.ThreadPoolExecutor(max_workers=2) as pool:
        for result in pool.map(checks.check_location, failed):
            checks.append_json(path, result)
            results.append(result)
            print(json.dumps({'name': result['name'], 'recheck_passed': result['ok']}), flush=True)
    summary = {'checked_at': checks.now(), 'initial_failed_locations': sum(not r['ok'] for r in initial), 'rechecked_locations': len(results), 'recovered_locations': sum(r['ok'] for r in results), 'still_failed': [r['id'] for r in results if not r['ok']]}
    (checks.ROOT / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    main()
