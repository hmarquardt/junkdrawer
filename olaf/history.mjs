const DB_NAME = 'olaf-history';
const DB_VERSION = 1;
const STORE = 'evaluations';
export const HISTORY_LIMIT = 200;
export const HISTORY_MAX_AGE_DAYS = 180;

export function historyRecord({ result, task, preset = 'custom', reference = null, requestHash = null, now = new Date() }) {
  const observation = result.observation;
  return {
    id: result.taskId + '-' + now.getTime().toString(36),
    timestamp: now.toISOString(),
    preset,
    inputHashes: {
      request: requestHash,
      Left: task.images.Left?.sha256 || null,
      Right: task.images.Right?.sha256 || null,
    },
    rubricVersion: result.rubricVersion,
    provider: result.telemetry.provider,
    model: result.telemetry.model,
    architecture: result.diagnostics?.architecture || 'a',
    winner: result.decision,
    stage: result.stage,
    confidence: result.confidence,
    evidence: result.evidence,
    uncertainty: observation.limitations || [],
    reverseConsistent: result.verification ? result.verification.consistent : null,
    latencyMs: result.telemetry.latencyMs,
    estimatedUsd: result.telemetry.estimatedUsd,
    reference,
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(Error('IndexedDB is unavailable in this browser.'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error('Could not open local history.'));
  });
}
const done = (transaction) =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || Error('Local history transaction failed.'));
    transaction.onabort = () => reject(transaction.error || Error('Local history transaction aborted.'));
  });
export async function listHistory() {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).getAll();
    const rows = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    return rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  } finally {
    db.close();
  }
}
export async function saveHistory(record) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(record);
    await done(transaction);
    await pruneHistory(db);
  } finally {
    db.close();
  }
  return record;
}
async function pruneHistory(db) {
  const transaction = db.transaction(STORE, 'readwrite');
  const store = transaction.objectStore(STORE);
  const rows = await new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  const cutoff = Date.now() - HISTORY_MAX_AGE_DAYS * 86400000;
  const keep = rows
    .filter((r) => new Date(r.timestamp).getTime() >= cutoff)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, HISTORY_LIMIT);
  const keepIds = new Set(keep.map((r) => r.id));
  for (const row of rows) if (!keepIds.has(row.id)) store.delete(row.id);
  await done(transaction);
}
export async function clearHistory() {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).clear();
    await done(transaction);
  } finally {
    db.close();
  }
}
export async function exportHistory() {
  return { version: 1, exportedAt: new Date().toISOString(), records: await listHistory() };
}
