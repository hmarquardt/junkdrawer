"""Append-only production measurements, enabled only by FF_METRICS_PATH."""
import contextlib
import json
import os
import time
from pathlib import Path

def emit(kind, **fields):
    target = os.environ.get('FF_METRICS_PATH')
    if target:
        path = Path(target)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('a') as f:
            f.write(json.dumps({'kind': kind, 'at': time.time(), **fields})+'\n')
            f.flush()

@contextlib.contextmanager
def stage(tile, name):
    start, cpu = time.monotonic(), time.process_time()
    success = False
    try:
        yield
        success = True
    finally:
        emit('stage', tile=tile, stage=name, seconds=time.monotonic()-start,
             cpuSeconds=time.process_time()-cpu, success=success)
