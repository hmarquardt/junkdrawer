#!/usr/bin/env python3
"""Normalize the active production manifest to normalized-relevant coverage.

The active manifest should describe current relevant production GIS coverage. The
legacy coarse roster admitted tiles that contain no U.S. land at the production
sample lattice; those tiles stay in R2 and in the publisher ledger, but their
references are removed from the active manifest so they cannot count as national
coverage or be selected by the application.

Ordering and safety:
  * serialized by the publisher flock (never races a publisher);
  * local structural validation of every remaining reference before writing;
  * immutable R2 objects are never deleted;
  * the removal record is written to production/manifest-normalization.json.

    uv run tools/fruiting_manifest_normalize.py [--apply]
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
DATA = ROOT / 'data/fruiting-forecast'
PROD = DATA / 'production'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='write the normalized manifest (default: report only)')
    parser.add_argument('--relevance', type=Path, default=DATA / 'national-relevance-v2.json')
    args = parser.parse_args()

    from fruiting_conus_plan import load_relevance
    from fruiting_tile_publish import atomic_json, coverage_of, summary_of
    from fruiting_remote import publication_lock, references

    product = load_relevance(args.relevance)
    records = product['tiles']
    path = DATA / 'manifest.json'
    manifest = json.loads(path.read_text())
    tiles = manifest['tiles']
    keep, remove = [], []
    for tile in tiles:
        record = records.get(tile['id']) or {}
        if record.get('relevant'):
            keep.append(tile)
        else:
            remove.append({'id': tile['id'],
                           'legacyRelevant': True,
                           'reason': ('No 0.05-degree sample-cell center on U.S. terrestrial land; the '
                                      'legacy coarse boundary share was a cartographic sliver.'),
                           'layers': {key: (tile.get(key) or {}).get('status') for key in
                                      ('habitat', 'publicLands', 'fireHistory', 'accessPoints')},
                           'assets': {key: (tile.get(key) or {}).get('url') for key in
                                      ('habitat', 'publicLands', 'fireHistory', 'accessPoints')}})
    report = {
        'schemaVersion': 1,
        'algorithm': product['algorithm'],
        'relevanceProduct': str(args.relevance),
        'manifestBefore': {'tiles': len(tiles), 'datasetVersion': manifest.get('datasetVersion')},
        'manifestAfter': {'tiles': len(keep),
                          'datasetVersion': 'content-' + hashlib.sha256(
                              json.dumps(keep, sort_keys=True).encode()).hexdigest()[:16]},
        'removed': remove,
        'removedCount': len(remove),
        'retainedR2': ('Removed assets remain in R2 and the publisher ledger; they are explicit ledger '
                       'orphans and are never deleted by this tool.'),
    }
    if args.apply and remove:
        with publication_lock(DATA):
            fresh = json.loads(path.read_text())
            fresh['tiles'] = [tile for tile in fresh['tiles']
                              if (records.get(tile['id']) or {}).get('relevant')]
            fresh['summary'] = {**(fresh.get('summary') or {}), **summary_of(fresh['tiles']),
                                **coverage_of(fresh['tiles'], ROOT)}
            fresh['datasetVersion'] = report['manifestAfter']['datasetVersion']
            refs = references(fresh)
            for key in refs:
                if not (DATA / key).exists():
                    raise SystemExit(f'Refusing to write manifest: local asset missing for {key}')
            atomic_json(path, fresh)
            report['applied'] = True
            report['activeReferences'] = len(refs)
            report['activeBytes'] = sum(a['bytes'] for a in refs.values())
    else:
        report['applied'] = False
    atomic_json(PROD / 'manifest-normalization.json', report)
    print(json.dumps({k: report[k] for k in ('applied', 'removedCount', 'manifestBefore', 'manifestAfter')}, indent=2))
    print('removed:', [item['id'] for item in remove])


if __name__ == '__main__':
    main()
