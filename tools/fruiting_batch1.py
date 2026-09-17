"""Freeze planner-derived prepared-input Batch 1 and run serial checkpoint chunks.

Never prepares new states. Uses the existing CONUS release pipeline. A frozen
scope is required for run/resume; no Batch-2 execution exists here.
"""
import argparse
from collections import Counter
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from fruiting_conus_plan import build_tiles, coverage, ROOT, DATA
from fruiting_bulk_adapters import load_cache_manifest
from fruiting_tile_publish import atomic_json
from fruiting_remote import references

def complete(row):
    return all(v in {'AVAILABLE','VERIFIED_EMPTY'} for v in row['layerStatus'].values())

def derive(source, access):
    rows=build_tiles(source_cache=source,access_cache=access)
    eligible=[r for r in rows if r['soilStatesRequired'] and r['soilPrepared'] and r['pbfPrepared']]
    requested=[r for r in eligible if not complete(r)]
    return {'schemaVersion':1,'startingCommit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
            'sourceCache':str(source),'accessCache':str(access),'coverageBefore':coverage(rows),
            'readyStates':sorted({s for r in eligible for s in r['soilStatesRequired']}),
            'eligibleTiles':len(eligible),'alreadyComplete':len(eligible)-len(requested),
            'tiles':[r['id'] for r in requested], 'layerWork':dict(Counter(k for r in requested for k,v in r['layerStatus'].items() if v not in {'AVAILABLE','VERIFIED_EMPTY'})),
            'stateTileCounts':dict(Counter(s for r in eligible for s in r['soilStatesRequired']))}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('command',choices=['plan','run'])
    p.add_argument('--scope',type=Path,required=True)
    p.add_argument('--source-cache',type=Path,default=Path('/tmp/ffsrc'))
    p.add_argument('--access-cache',type=Path,default=Path('/tmp/fruiting-forecast-gis-sources'))
    p.add_argument('--out',type=Path,default=Path('/tmp/ff-batch1-normalized'))
    p.add_argument('--checkpoint-size',type=int,default=10)
    p.add_argument('--chunk',type=int,default=0,help='Zero-based chunk; one chunk per invocation for review/commit')
    a=p.parse_args()
    if a.command=='plan':
        if a.scope.exists():raise SystemExit('Refusing to overwrite frozen scope')
        atomic_json(a.scope,derive(a.source_cache,a.access_cache));return
    scope=json.loads(a.scope.read_text());tiles=scope['tiles'][a.chunk*a.checkpoint_size:(a.chunk+1)*a.checkpoint_size]
    if not tiles:raise SystemExit('No tiles in requested chunk')
    current=derive(Path(scope['sourceCache']),Path(scope['accessCache']))
    if not set(scope['readyStates'])<=set(current['readyStates']):raise SystemExit('Prepared states changed; preflight again')
    if shutil.disk_usage(a.out.parent).free<8*1024**3:raise SystemExit('Less than 8 GiB free; stopping before downloads')
    a.out.mkdir(parents=True,exist_ok=True)
    os.environ['FF_RECLAIM_DEM']='1'
    os.environ['FF_METRICS_PATH']=str(a.out/'metrics.jsonl')
    from fruiting_pnw_release import run
    import threading
    from fruiting_metrics import emit
    stop=threading.Event()
    def monitor():
        while not stop.is_set():
            disk=shutil.disk_usage(a.out)
            dems=sum(p.stat().st_size for p in Path(scope['sourceCache']).glob('dem_*.tif') if p.exists())
            emit('disk',freeBytes=disk.free,usedBytes=disk.used,demBytes=dems)
            stop.wait(2)
    watcher=threading.Thread(target=monitor,daemon=True);watcher.start()
    start=time.time()
    result=run('TILES',Path(scope['sourceCache']),Path(scope['accessCache']),a.out,','.join(tiles),True,tiles=tiles)
    stop.set();watcher.join()
    result.update(startedAt=start,endedAt=time.time(),chunk=a.chunk)
    atomic_json(a.out/f'chunk-{a.chunk:03d}.json',result)

if __name__=='__main__':main()
