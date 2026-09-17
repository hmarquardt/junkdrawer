"""Immutable Parquet publication via existing Wrangler OAuth; no credential access.

All operations are serial. Public GET verifies full bytes, never ETag. The append-only
inventory records upload intent before the upload, so interrupted uploads are auditable.
Wrangler 4.133.0 has no object-list command: orphan audit covers this inventory, or an
operator-supplied inventory, and explicitly reports that limitation.
"""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import random
import re
import subprocess
import tempfile
import time
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/fruiting-forecast'
ORIGIN = 'https://data.hanksjunkdrawer.com/'
BUCKET = 'fruiting-forecast-data'
INVENTORY = DATA / '.r2-inventory.jsonl'
CACHE_CONTROL = 'public, max-age=31536000, immutable'

class IntegrityError(ValueError):
    pass

@contextlib.contextmanager
def publication_lock(directory):
    directory.mkdir(parents=True, exist_ok=True)
    # Kernel releases flock on process death; never unlink a flock inode.
    with (directory / '.publication.flock').open('a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)

def references(manifest):
    found = {}
    def walk(value):
        if isinstance(value, dict):
            # Modern tile.habitat supersedes the obsolete schema-1 tile URL.
            key = '' if 'habitat' in value and 'bbox' in value else value.get('url', '')
            if isinstance(key, str) and key.endswith('.parquet'):
                if not re.fullmatch(r'[A-Za-z0-9_/-]+\.parquet', key) or '..' in key:
                    raise IntegrityError('Unsafe relative object key: ' + key)
                if not re.fullmatch(r'[a-f0-9]{64}', value.get('sha256', '')) or not isinstance(value.get('bytes'), int):
                    raise IntegrityError('Missing length/digest: ' + key)
                item = {k: value[k] for k in ('url', 'bytes', 'sha256')}
                if key in found and found[key] != item:
                    raise IntegrityError('Conflicting manifest references: ' + key)
                found[key] = item
            for v in value.values(): walk(v)
        elif isinstance(value, list):
            for v in value: walk(v)
    walk(manifest)
    return dict(sorted(found.items()))

def validate(data, asset):
    if len(data) != asset['bytes']:
        raise IntegrityError('Wrong length: ' + asset['url'])
    if hashlib.sha256(data).hexdigest() != asset['sha256']:
        raise IntegrityError('Wrong SHA-256: ' + asset['url'])

def record(event, inventory=INVENTORY):
    inventory.parent.mkdir(parents=True, exist_ok=True)
    with inventory.open('a') as f:
        f.write(json.dumps({'at': time.time(), **event}, sort_keys=True) + '\n')
        f.flush()
        os.fsync(f.fileno())

def remote_bytes(asset, origin=ORIGIN, attempts=4):
    start = time.monotonic()
    for attempt in range(attempts):
        with tempfile.TemporaryDirectory(prefix='ff-r2-') as tmp:
            target = Path(tmp) / 'body'
            headers = Path(tmp) / 'headers'
            p = subprocess.run(['curl', '--silent', '--show-error', '--max-time', '120',
                                '--dump-header', str(headers), '--output', str(target),
                                '--write-out', '%{http_code}', urljoin(origin.rstrip('/')+'/', asset['url'])],
                               capture_output=True, text=True)
            status = int(p.stdout) if p.stdout.isdigit() else 0
            if p.returncode == 0 and status == 404:
                return None, {'seconds': time.monotonic()-start, 'retries': attempt, 'status': status}
            if p.returncode == 0 and status == 200:
                data = target.read_bytes()
                validate(data, asset)
                return data, {'seconds': time.monotonic()-start, 'retries': attempt, 'status': status}
            if status not in {0, 408, 429, 500, 502, 503, 504}:
                raise RuntimeError(f'Remote GET {asset["url"]}: HTTP {status}')
            retry_after = re.search(r'(?im)^retry-after:\s*(\d+)', headers.read_text() if headers.exists() else '')
            if attempt + 1 < attempts:
                time.sleep(max(int(retry_after[1]) if retry_after else 0, 2**attempt + random.random()))
    raise RuntimeError(f'Remote GET exhausted retries: {asset["url"]} HTTP {status}')

def ensure_remote(path, asset, origin=ORIGIN, bucket=BUCKET, inventory=INVENTORY):
    validate(path.read_bytes(), asset)
    existing, preflight = remote_bytes(asset, origin)
    if existing is not None:
        result = {'event': 'verified', **asset, 'uploaded': False, 'uploadSeconds': 0,
                  'verificationSeconds': preflight['seconds'], 'retries': preflight['retries']}
        record(result, inventory)
        return result
    record({'event': 'upload-intent', **asset}, inventory)
    started = time.monotonic()
    # No blind retry of PUT: resume first checks the public bytes again.
    p = subprocess.run(['npx', 'wrangler', 'r2', 'object', 'put', bucket+'/'+asset['url'],
                        '--remote', '--file', str(path), '--content-type', 'application/vnd.apache.parquet',
                        '--cache-control', CACHE_CONTROL], capture_output=True, text=True)
    elapsed = time.monotonic()-started
    if p.returncode:
        record({'event': 'upload-failed', **asset, 'uploadSeconds': elapsed}, inventory)
        raise RuntimeError('Wrangler upload failed for '+asset['url']+' (retry verifies remote before PUT)')
    body, verification = remote_bytes(asset, origin)
    if body is None:
        raise RuntimeError('Uploaded object not publicly readable: '+asset['url'])
    result = {'event': 'verified', **asset, 'uploaded': True, 'uploadSeconds': elapsed,
              'verificationSeconds': preflight['seconds']+verification['seconds'],
              'retries': preflight['retries']+verification['retries']}
    record(result, inventory)
    return result

def ensure_local(asset, directory=DATA, origin=ORIGIN):
    path = directory / asset['url']
    if path.exists():
        validate(path.read_bytes(), asset)
        return path
    data, _ = remote_bytes(asset, origin)
    if data is None: raise FileNotFoundError(asset['url'])
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
        f.write(data)
        tmp = f.name
    os.replace(tmp, path)
    return path

def audit(manifest, directory=DATA, origin=ORIGIN, inventory=INVENTORY):
    refs = references(manifest)
    result = {'references': len(refs), 'bytes': sum(a['bytes'] for a in refs.values()),
              'valid': [], 'missing': [], 'invalid': [], 'localInvalid': [], 'localOnly': [],
              'remoteOrphans': [], 'inventoryScope': 'publisher upload-intent ledger; not an exhaustive R2 bucket listing'}
    for key, asset in refs.items():
        if (directory/key).exists():
            try: validate((directory/key).read_bytes(), asset)
            except IntegrityError as e: result['localInvalid'].append(str(e))
        try:
            body, _ = remote_bytes(asset, origin)
            result['valid' if body is not None else 'missing'].append(key)
        except (IntegrityError, RuntimeError) as e:
            result['invalid'].append({'url': key, 'error': str(e)})
    result['localOnly'] = sorted(p.relative_to(directory).as_posix() for p in directory.rglob('*.parquet') if p.relative_to(directory).as_posix() not in refs)
    known = {}
    if inventory.exists():
        for line in inventory.read_text().splitlines():
            event = json.loads(line)
            if event.get('url'): known[event['url']] = event
    for key in sorted(set(known)-set(refs)):
        body, _ = remote_bytes(known[key], origin)
        if body is not None: result['remoteOrphans'].append(key)
    result['clean'] = not (result['missing'] or result['invalid'] or result['localInvalid'])
    return result

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['migrate', 'audit', 'hydrate'])
    p.add_argument('--directory', type=Path, default=DATA)
    p.add_argument('--origin', default=ORIGIN)
    p.add_argument('--inventory', type=Path, default=INVENTORY)
    p.add_argument('--report', type=Path, required=True)
    a = p.parse_args()
    with publication_lock(a.directory):
        manifest = json.loads((a.directory/'manifest.json').read_text())
        results = []
        if a.command in {'migrate', 'hydrate'}:
            for key, asset in references(manifest).items():
                if a.command == 'migrate':
                    results.append(ensure_remote(a.directory/key, asset, a.origin, inventory=a.inventory))
                else: ensure_local(asset, a.directory, a.origin)
                print(key, flush=True)
        report = audit(manifest, a.directory, a.origin, a.inventory)
        report['operations'] = results
        a.report.parent.mkdir(parents=True, exist_ok=True)
        a.report.write_text(json.dumps(report, indent=2)+'\n')
        print(json.dumps({k:v for k,v in report.items() if not isinstance(v,list)}))
        if not report['clean']: raise SystemExit(1)

if __name__ == '__main__': main()
