import { cases } from './benchmarks/dataset.mjs';

const $ = (id) => document.getElementById(id);
const el = (tag, text) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
};
const status = (text) => {
  $('status').textContent = text;
};
const byCase = new Map(cases.map((c) => [c.id, c]));
let rows = [];
let selected = null;
let fit = false;

const DB_NAME = 'olaf-review';
const STORE = 'adjudications';
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error('Could not open local adjudication storage.'));
  });
}
const transactionDone = (transaction) =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || Error('Transaction aborted.'));
  });
async function allRecords() {
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE, 'readonly');
    return await new Promise((resolve, reject) => {
      const request = transaction.objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
async function recordFor(id) {
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE, 'readonly');
    return await new Promise((resolve, reject) => {
      const request = transaction.objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
async function saveRecord(record) {
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(record);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}
async function clearRecords() {
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).clear();
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}
const recordId = (row) => [row.case, row.model, row.architecture, row.repeat].join('|');
const isDispute = (row) => row.expected != null && row.decision !== row.expected;
function rowsToShow() {
  return $('onlyDisputes').checked ? rows.filter(isDispute) : rows;
}

function field(parent, label, value) {
  const p = el('p');
  p.append(el('b', label + ' · '), document.createTextNode(value == null || value === '' ? '—' : String(value)));
  parent.append(p);
}
function listBlock(title, items, empty = 'None.') {
  const box = el('div');
  box.append(el('h4', title));
  if (!items.length) box.append(el('p', empty));
  else {
    const ul = el('ul');
    for (const item of items) ul.append(el('li', item));
    box.append(ul);
  }
  return box;
}
function imagePanel(side, name) {
  const figure = el('figure');
  figure.className = 'candidate';
  const title = el('div');
  title.className = 'meta';
  title.append(el('b', side + ' · '), document.createTextNode(name + '.png'));
  const wrap = el('div');
  wrap.className = 'native' + (fit ? ' fit' : '');
  const img = el('img');
  img.src = 'olaf/fixtures/images/' + name + '.png';
  img.alt = side + ' candidate ' + name;
  wrap.append(img);
  const link = el('a', 'Open original');
  link.href = img.src;
  link.target = '_blank';
  link.rel = 'noopener';
  figure.append(title, wrap, link);
  return figure;
}
function requirementLines(requirements) {
  return requirements.map(
    (r) =>
      `${r.excerpt} · ${r.scope} · Left ${r.status.Left} / Right ${r.status.Right} · ${r.evidence?.Left || ''} | ${r.evidence?.Right || ''}`,
  );
}
function defectLines(defects) {
  return defects.map((d) => `${d.side} ${d.type} · ${d.severity} · ${d.location} · ${d.evidence?.[d.side] || ''}`);
}
function renderDetail(row) {
  selected = row;
  const c = byCase.get(row.case),
    detail = $('detail'),
    result = row.result;
  detail.replaceChildren();
  if (!c || !result) {
    detail.append(el('p', 'This row has no usable case reference or result object.'));
    return;
  }
  const head = el('div');
  head.className = 'reviewHead';
  head.append(el('h2', row.case), el('span', row.category + ' · ' + row.split));
  detail.append(head);
  const request = el('p');
  request.append(el('b', 'Original request · '), document.createTextNode(c.request));
  detail.append(request);

  const meta = el('div');
  meta.className = 'metaGrid';
  for (const [label, value] of [
    ['Fixed reference', `${c.reference.decision ?? 'none'} / ${c.reference.stage}`],
    ['Reference certainty', c.reference.certainty + (c.objective ? ' · objective case' : ' · subjective case')],
    ['Actual judgment', `${row.decision} / ${row.stage}`],
    ['Model', row.model],
    ['Architecture', String(row.architecture).toUpperCase()],
    ['Confidence', row.confidence],
    ['Reverse consistency', row.consistent == null ? 'not run' : row.consistent ? 'consistent' : 'disagreement'],
    ['Latency', row.latencyMs == null ? '—' : Math.round(row.latencyMs) + ' ms'],
    ['Estimated cost', row.estimatedUsd == null ? 'unavailable' : '$' + Number(row.estimatedUsd).toFixed(4)],
  ]) {
    const cell = el('div');
    cell.append(el('b', label), el('span', value));
    meta.append(cell);
  }
  detail.append(meta);

  if (!c.objective || c.reference.certainty !== 'constructed') {
    const note = el('p', 'Subjective or provisional reference: a disagreement here may be defensible rather than an error.');
    note.className = 'note defensible';
    detail.append(note);
  }

  const compare = el('div');
  compare.className = 'compare';
  compare.append(imagePanel('Left', c.left), imagePanel('Right', c.right));
  detail.append(compare);

  const reference = el('div');
  reference.append(el('h3', 'Fixed reference'));
  field(reference, 'Decision / stage', `${c.reference.decision ?? 'none'} / ${c.reference.stage}`);
  reference.append(
    listBlock('Reference requirements', requirementLines(c.requirements)),
    listBlock('Reference defects', defectLines(c.defects)),
  );
  detail.append(reference);

  const actual = el('div');
  actual.append(el('h3', 'Actual model judgment'));
  field(actual, 'Why', result.why);
  field(actual, 'Left evidence', result.evidence.Left);
  field(actual, 'Right evidence', result.evidence.Right);
  actual.append(
    listBlock('Model requirements', requirementLines(result.observation.requirements)),
    listBlock('Model defects', defectLines(result.observation.defects)),
  );
  detail.append(actual);

  for (const [title, data] of [
    ['Decision trace', { trace: result.diagnostics?.trace, corrections: result.diagnostics?.corrections }],
    [
      'Reverse-order result',
      { verification: result.verification, reversed: result.diagnostics?.reversed, order: result.diagnostics?.order },
    ],
    ['Stage telemetry', result.diagnostics?.stages || result.telemetry],
  ]) {
    const box = el('details');
    box.append(el('summary', title));
    box.append(el('pre', JSON.stringify(data, null, 2)));
    detail.append(box);
  }
  detail.append(adjudicationForm(row));
}


function adjudicationForm(row) {
  const id = recordId(row),
    box = el('section');
  box.className = 'adjudication';
  box.append(el('h3', 'Independent adjudication'));
  box.append(
    el('p', 'Stored separately from the frozen reference and from evaluation history. This does not change the benchmark.'),
  );
  const reviewer = el('input');
  reviewer.type = 'text';
  reviewer.placeholder = 'Reviewer or initials (optional)';
  reviewer.setAttribute('aria-label', 'Reviewer');
  const verdict = el('select');
  for (const [value, label] of [
    ['agree', 'Agree with the fixed reference'],
    ['defensible', 'Disagreement is defensible (subjective)'],
    ['error', 'Model error (objective)'],
    ['Left', 'Independent judgment · Left'],
    ['Right', 'Independent judgment · Right'],
    ['Tie', 'Independent judgment · Tie'],
    ['REVIEW', 'Independent judgment · REVIEW'],
  ])
    verdict.append(new Option(label, value));
  const notes = el('textarea');
  notes.placeholder = 'Evidence, reasoning or the correct severity.';
  notes.setAttribute('aria-label', 'Adjudication notes');
  const save = el('button', 'Save adjudication');
  const message = el('p');
  message.className = 'note';
  const fields = el('div');
  fields.className = 'metaGrid';
  const reviewerCell = el('div');
  reviewerCell.append(el('b', 'Reviewer'), reviewer);
  const verdictCell = el('div');
  verdictCell.append(el('b', 'Verdict'), verdict);
  fields.append(reviewerCell, verdictCell);
  box.append(fields, el('b', 'Notes'), notes, el('div'), save, message);
  recordFor(id)
    .then((record) => {
      if (!record || selected !== row) return;
      reviewer.value = record.reviewer || '';
      verdict.value = record.verdict || 'agree';
      notes.value = record.notes || '';
      message.textContent = 'Saved ' + new Date(record.timestamp).toLocaleString();
    })
    .catch((error) => {
      message.textContent = error.message;
    });
  save.onclick = async () => {
    save.disabled = true;
    try {
      await saveRecord({
        id,
        case: row.case,
        model: row.model,
        architecture: row.architecture,
        repeat: row.repeat,
        referenceDecision: row.expected,
        referenceStage: row.expectedStage,
        actualDecision: row.decision,
        actualStage: row.stage,
        reviewer: reviewer.value.trim(),
        verdict: verdict.value,
        notes: notes.value.trim(),
        timestamp: new Date().toISOString(),
      });
      message.textContent = 'Saved locally.';
      await renderRecords();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      save.disabled = false;
    }
  };
  return box;
}


async function renderRecords() {
  const list = $('recordList');
  try {
    const records = (await allRecords()).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    $('records').hidden = !records.length;
    list.replaceChildren();
    if (!records.length) {
      list.append(el('p', 'No independent adjudications recorded yet.'));
      return;
    }
    const table = el('table');
    table.id = 'disputeTable';
    const head = el('tr');
    for (const label of ['Recorded', 'Case', 'Verdict', 'Reference', 'Actual', 'Reviewer', 'Notes'])
      head.append(el('th', label));
    table.append(head);
    for (const record of records) {
      const tr = el('tr');
      for (const value of [
        new Date(record.timestamp).toLocaleString(),
        record.case,
        record.verdict,
        `${record.referenceDecision ?? '—'} / ${record.referenceStage ?? '—'}`,
        `${record.actualDecision} / ${record.actualStage}`,
        record.reviewer || '—',
        record.notes || '—',
      ])
        tr.append(el('td', value));
      table.append(tr);
    }
    list.append(table);
  } catch (error) {
    $('recordStatus').textContent = error.message;
  }
}
function renderSummary() {
  const summary = $('runSummary');
  summary.replaceChildren();
  for (const [label, value] of [
    ['Loaded runs', rows.length],
    ['Disagreements', rows.filter(isDispute).length],
    ['Models', [...new Set(rows.map((r) => r.model))].join(', ')],
    ['Architectures', [...new Set(rows.map((r) => r.architecture))].map((a) => String(a).toUpperCase()).join(', ')],
    ['Splits', [...new Set(rows.map((r) => r.split))].join(', ')],
  ]) {
    const cell = el('div');
    cell.append(el('b', label), el('span', String(value)));
    summary.append(cell);
  }
}
function renderList() {
  const list = $('caseList');
  list.replaceChildren();
  const visible = rowsToShow();
  for (const row of visible) {
    const button = el('button');
    button.type = 'button';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-current', String(selected === row));
    button.append(
      el('b', row.case),
      el('span', ` · ${row.decision}/${row.stage} · ${String(row.architecture).toUpperCase()} · ${row.model}`),
    );
    button.onclick = () => {
      renderDetail(row);
      renderList();
    };
    list.append(button);
  }
  if (!visible.length) list.append(el('p', 'No rows match this filter.'));
  if (!selected || !visible.includes(selected)) {
    selected = visible[0] || null;
    if (selected) renderDetail(selected);
    else $('detail').replaceChildren(el('p', 'No disputed case to display.'));
  }
}
async function loadText(text, source) {
  const loaded = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    if (!row.case || !row.result || !byCase.has(row.case)) {
      skipped++;
      continue;
    }
    loaded.push(row);
  }
  if (!loaded.length) throw Error('No benchmark rows with result objects were found in ' + source + '.');
  rows = loaded;
  selected = null;
  $('loaded').hidden = false;
  $('records').hidden = false;
  renderSummary();
  renderList();
  status(
    `Loaded ${loaded.length} row(s) from ${source}.` +
      (skipped ? ` Skipped ${skipped} summary or unusable line(s).` : ''),
  );
}


$('pickJson').onclick = () => $('jsonl').click();
$('jsonl').onchange = async () => {
  const file = $('jsonl').files[0];
  if (!file) return;
  try {
    await loadText(await file.text(), file.name);
  } catch (error) {
    status(error.message);
  } finally {
    $('jsonl').value = '';
  }
};
$('onlyDisputes').onchange = () => renderList();
$('fitImages').onchange = () => {
  fit = $('fitImages').checked;
  for (const node of document.querySelectorAll('.native')) node.classList.toggle('fit', fit);
};
for (const type of ['dragenter', 'dragover', 'dragleave', 'drop'])
  window.addEventListener(type, (event) => {
    event.preventDefault();
    if (type !== 'drop') return;
    const file = [...(event.dataTransfer?.files || [])][0];
    if (!file) return;
    file
      .text()
      .then((text) => loadText(text, file.name))
      .catch((error) => status(error.message));
  });
$('exportRecords').onclick = async () => {
  try {
    const records = await allRecords();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records }, null, 2)], {
        type: 'application/json',
      }),
    );
    const a = el('a');
    a.href = url;
    a.download = 'olaf-adjudications-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('recordStatus').textContent = 'Exported ' + records.length + ' record(s).';
  } catch (error) {
    $('recordStatus').textContent = error.message;
  }
};
$('clearRecords').onclick = async () => {
  try {
    await clearRecords();
    $('recordStatus').textContent = 'Adjudications cleared.';
    await renderRecords();
  } catch (error) {
    $('recordStatus').textContent = error.message;
  }
};
renderRecords();

// Public index convention: only the canonical public page sends an ordinary page view.
if (
  location.href === 'https://hmarquardt.github.io/junkdrawer/olaf-review.html' &&
  [
    '',
    'https://hmarquardt.github.io/junkdrawer/',
    'https://hmarquardt.github.io/junkdrawer/index.html',
  ].includes(document.referrer)
) {
  const config = document.getElementById('pageview').content.querySelector('script');
  const script = document.createElement('script');
  for (const attribute of config.attributes) script.setAttribute(attribute.name, attribute.value);
  document.head.append(script);
}

