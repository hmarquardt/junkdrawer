import {validSave} from './progression.js';
const revisionOf=s=>Number.isSafeInteger(s?.revision)?s.revision:0;
export async function openCampaign(){
  const db=await new Promise((resolve,reject)=>{
    const req=indexedDB.open('danny-popper',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('campaign');
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  db.onversionchange=()=>db.close();
  return {
    read:()=>new Promise((resolve,reject)=>{
      const tx=db.transaction('campaign'),store=tx.objectStore('campaign');
      const head=store.get('current'),backup=store.get('previous');
      tx.oncomplete=()=>{
        if(validSave(head.result))resolve({state:head.result,recovered:false});
        else if(validSave(backup.result))resolve({state:{...backup.result,revision:revisionOf(head.result),checkpointId:head.result?.checkpointId??null},recovered:true});
        else if(head.result===undefined && backup.result===undefined)resolve({state:null,recovered:false});
        else reject(Error('Local checkpoints could not be read. This session will play without overwriting them.'));
      };
      tx.onabort=()=>reject(tx.error);
    }),
    write:(state,expected,expectedId,eraseHistory=false)=>new Promise((resolve,reject)=>{
      const tx=db.transaction('campaign','readwrite'),store=tx.objectStore('campaign');
      const req=store.get('current');let conflict=false;
      req.onsuccess=()=>{
        if(revisionOf(req.result)!==expected || (req.result?.checkpointId??null)!==expectedId){conflict=true;tx.abort();return;}
        if(eraseHistory)store.delete('previous');
        else if(validSave(req.result))store.put(req.result,'previous');
        store.put(state,'current');
      };
      tx.oncomplete=resolve;
      tx.onabort=()=>reject(Error(conflict?'Another tab saved a newer shift. Reload to resume it.':'Local save failed. Progress is held in this tab.'));
    })
  };
}
