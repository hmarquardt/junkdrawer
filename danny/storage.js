// Compare revisions in the same transaction so two open tabs cannot overwrite a newer run.
export async function openCampaign() {
  const db = await new Promise((resolve,reject) => {
    const req = indexedDB.open('danny-popper',1);
    req.onupgradeneeded = () => req.result.createObjectStore('campaign');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.onversionchange = () => db.close();
  return {
    read: () => new Promise((resolve,reject) => {
      const req = db.transaction('campaign').objectStore('campaign').get('current');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
    write: (state, expected) => new Promise((resolve,reject) => {
      const tx = db.transaction('campaign','readwrite');
      const store = tx.objectStore('campaign');
      const req = store.get('current');
      let conflict = false;
      req.onsuccess = () => {
        if ((req.result?.revision ?? 0) !== expected) {
          conflict = true;
          tx.abort();
        } else store.put(state,'current');
      };
      tx.oncomplete = resolve;
      tx.onabort = () => reject(new Error(conflict ? 'Campaign updated in another tab. Reload to continue saving.' : 'Save failed. Progress is held in this tab.'));
      tx.onerror = () => reject(tx.error);
    })
  };
}
