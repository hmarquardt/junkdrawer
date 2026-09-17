# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb", "shapely", "pyproj", "requests"]
# ///
"""Summarize measured Batch-1 progress; estimates are not authorization to run Batch 2."""
import argparse
from collections import Counter,defaultdict
import json
from pathlib import Path
import statistics
import subprocess
import time
from fruiting_conus_plan import build_tiles,coverage,DATA,LAYERS
from fruiting_remote import references,INVENTORY
from fruiting_tile_publish import atomic_json

def distribution(values):
    values=sorted(values)
    if not values:return {'n':0}
    q=lambda p:values[min(len(values)-1,int((len(values)-1)*p))]
    return {'n':len(values),'sum':sum(values),'mean':statistics.mean(values),'median':statistics.median(values),
            'p25':q(.25),'p75':q(.75),'p90':q(.9),'max':max(values)}

def report(scope_path,work):
    scope=json.loads(scope_path.read_text());m=json.loads((DATA/'manifest.json').read_text());refs=references(m)
    rows=build_tiles();by_id={r['id']:r for r in rows};cov=coverage(rows)
    done=[t for t in scope['tiles'] if all(v in {'AVAILABLE','VERIFIED_EMPTY'} for v in by_id[t]['layerStatus'].values())]
    events=[json.loads(x) for x in (work/'metrics.jsonl').read_text().splitlines()] if (work/'metrics.jsonl').exists() else []
    stages=defaultdict(list);cpu=defaultdict(list)
    for e in events:
        if e['kind']=='stage' and e['success']:
            stages[e['stage']].append(e['seconds']);cpu[e['stage']].append(e['cpuSeconds'])
    disk=[e for e in events if e['kind']=='disk'];downloads=[e for e in events if e['kind']=='download']
    start=min((e['at']-e.get('seconds',0) for e in events),default=time.time())
    inventory=[json.loads(x) for x in INVENTORY.read_text().splitlines()] if INVENTORY.exists() else []
    uploads=[e for e in inventory if e.get('uploaded') and e['at']>=start];verified=[e for e in inventory if e['event']=='verified' and e['at']>=start]
    layers={k:sum(t.get(k,{}).get('bytes',0) for t in m['tiles']) for k in LAYERS}
    sizes=[];regions=defaultdict(list)
    for t in m['tiles']:
        if t['id'] not in by_id or not all(v in {'AVAILABLE','VERIFIED_EMPTY'} for v in by_id[t['id']]['layerStatus'].values()):continue
        size=sum(t.get(k,{}).get('bytes',0) for k in LAYERS);sizes.append(size);regions[by_id[t['id']]['dominantProfile'] or 'unassigned'].append(size)
    size_stats=distribution(sizes);regional_projection=sum(statistics.mean(regions[r['dominantProfile']]) if regions.get(r['dominantProfile']) else statistics.mean(sizes) for r in rows)
    layer_seconds={k:distribution(v) for k,v in stages.items()}
    estimate_per_tile=sum(statistics.median(stages[k]) if stages[k] else 0 for k in ['dem','soil','habitat','public-land','fire','access','publish-A','publish-B'])
    p75_per_tile=sum(distribution(stages[k]).get('p75',0) for k in ['dem','soil','habitat','public-land','fire','access','publish-A','publish-B'])
    ready_remaining=Counter(s for r in rows if r['id'] not in scope['tiles'] and not all(v in {'AVAILABLE','VERIFIED_EMPTY'} for v in r['layerStatus'].values()) for s in r['soilStatesRequired'])
    reads={str(n):int(n*4*9*4*.5) for n in [100,1000,10000]}
    average_object_bytes=sum(a['bytes'] for a in refs.values())/len(refs)
    storage_gb=sum(a['bytes'] for a in refs.values())/1_000_000_000;projected_storage_gb=regional_projection/1_000_000_000
    cost={users:{'classBReads':count,'estimatedTransferBytes':count*average_object_bytes,
                 'monthlyReadDollarsAfterStandaloneFreeTier':max(0,count-10_000_000)*.36/1_000_000,
                 'monthlyStorageDollarsAfterStandaloneFreeTier':max(0,projected_storage_gb-10)*.015,
                 'egressDollars':0} for users,count in reads.items()}
    retry_counts=Counter(str(e.get('status',0)) for e in events if e['kind'] in {'service-retry','download-retry'})
    used=[e['usedBytes'] for e in disk];dem=[e['demBytes'] for e in disk]
    return {'startingCommit':scope['startingCommit'],'reportSourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
      'endingCommitNote':'The commit containing this report is the checkpoint; source commit avoids a self-referential hash.',
      'batchScope':{'states':scope['readyStates'],'eligibleTiles':scope['eligibleTiles'],'alreadyComplete':scope['alreadyComplete'],'layerWork':scope['layerWork'],'fullySerial':True},
      'requested':len(scope['tiles']),'newlyComplete':len(done),'completedTileIds':done,'scopeRemaining':sorted(set(scope['tiles'])-set(done)),
      'completeNational':cov['tilesGisComplete'],'relevantNational':len(rows),'remainingNational':len(rows)-cov['tilesGisComplete'],
      'wallSecondsSinceFirstAttempt':time.time()-start,'stageSeconds':layer_seconds,'stageCpuSeconds':{k:distribution(v) for k,v in cpu.items()},
      'stageFailures':[e for e in events if e['kind']=='stage' and not e['success']],
      'serviceRetries':[e for e in events if e['kind'] in {'service-retry','download-retry'}],
      'serviceRetryStatusCounts':dict(sorted(retry_counts.items())),'resumeReuseEvents':sum(e['kind']=='reuse-normalized' for e in events),
      'serviceSeconds':sum(e['seconds'] for e in events if e['kind']=='service'),'downloads':{'count':len(downloads),'bytes':sum(e['bytes'] for e in downloads),'seconds':sum(e['seconds'] for e in downloads),'reclaimedBytes':sum(e['bytes'] for e in events if e['kind']=='dem-reclaimed')},
      'disk':{'minimumFreeBytes':min((e['freeBytes'] for e in disk),default=None),'peakVolumeUsedBytes':max(used,default=None),'peakObservedAdditionalVolumeBytes':max(used)-min(used) if used else None,'peakDemCacheBytes':max(dem,default=None),'peakAdditionalDemBytes':max(dem)-min(dem) if dem else None,'note':'Volume metrics include unrelated machine activity; additional DEM bytes are peak-minus-minimum sampled cache size.'},
      'remote':{'liveObjects':len(refs),'liveBytes':sum(a['bytes'] for a in refs.values()),'batchUploads':len(uploads),'batchUploadBytes':sum(e['bytes'] for e in uploads),'uploadSeconds':sum(e['uploadSeconds'] for e in uploads),'verificationSeconds':sum(e['verificationSeconds'] for e in verified),'inventoryScope':'local publisher intent ledger; no exhaustive bucket listing'},
      'sizeProjection':{'completeTileBytes':size_stats,'layerBytes':layers,'regions':{k:distribution(v) for k,v in sorted(regions.items()) if v},'nationalMeanBytes':statistics.mean(sizes)*len(rows),'regionalMeanBytes':regional_projection,'nationalP25P75ScenarioBytes':[size_stats['p25']*len(rows),size_stats['p75']*len(rows)],'method':'Measured complete-tile sizes; regional mean weighted by national dominant-profile roster, unsampled profiles use global mean. Quantile scenarios are not confidence intervals.'},
      'runtimeProjection':{'perTileMedianStageSumSeconds':estimate_per_tile,'perTileP75StageSumSeconds':p75_per_tile,'fullNationalMedianHours':estimate_per_tile*len(rows)/3600,'fullNationalP75Hours':p75_per_tile*len(rows)/3600,'remainingSerialHours':estimate_per_tile*(len(rows)-cov['tilesGisComplete'])/3600,'remainingP75Hours':p75_per_tile*(len(rows)-cov['tilesGisComplete'])/3600,'futureStatePreparationMeasuredSeconds':0,'method':'Sum of per-stage medians and p75 values. Future state preparation is unmeasured and excluded; service metrics overlap stage metrics and must not be added again.'},
      'remainingStatesTileMembership':dict(sorted(ready_remaining.items())),
      'costAssumptions':{'searchesPerUserMonth':4,'tilesPerSearch':9,'objectsPerTile':4,'warmAvoidedReadFraction':.5,'edgeCacheAssumed':False,'standardStorageDollarsPerGBMonth':.015,'classBDollarsPerMillion':.36,'freeStorageGBMonth':10,'freeClassBRequests':10000000,'freeClassARequests':1000000,'freeTierSharedAccount':True,'averageObjectBytes':average_object_bytes,'currentStorageGB':storage_gb,'projectedNationalStorageGB':projected_storage_gb,'source':'https://developers.cloudflare.com/r2/pricing/'},'costProjection':cost,
      'biologyChanged':False,'batch2Started':False}

def main():
 p=argparse.ArgumentParser();p.add_argument('--scope',type=Path,default=DATA/'production/batch1-scope.json');p.add_argument('--work',type=Path,default=Path('/tmp/ff-batch1-normalized'));p.add_argument('--out',type=Path,default=DATA/'production/batch1-report.json');a=p.parse_args();r=report(a.scope,a.work);atomic_json(a.out,r);print(json.dumps({k:r[k] for k in ['requested','newlyComplete','completeNational','remainingNational']}))
if __name__=='__main__':main()
