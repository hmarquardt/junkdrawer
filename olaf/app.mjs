import { createTask, assign, swap, sides, validateTask } from './engine/contracts.mjs';
import { evaluate } from './engine/evaluate.mjs';
import { extractArchive } from './ingestion/archive.mjs';
import { normalizeImage, cropImage, imageType, dataURL } from './ingestion/images.mjs';
import { demoRequest, mockProvider } from './providers/mock.mjs';

const $ = (id) => document.getElementById(id);
const el = (tag, text) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
};
const button = (text, fn) => {
  const b = el('button', text);
  b.onclick = fn;
  return b;
};
const status = (text) => {
  $('status').textContent = text;
};
let task = createTask(),
  result = null,
  controller = null,
  importing = false,
  inspected = null,
  models = [];
const assets = new Map();
const assetFor = (side) => assets.get(task.images[side]?.id);
const remember = (a) => {
  assets.set(a.ref.id, a);
  return a;
};
const setCandidate = (side, a) => assign(task, side, a?.ref || null);
const formatSize = (n) =>
  n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KiB' : (n / 1048576).toFixed(1) + ' MiB';
function available() {
  try {
    validateTask(task);
    return true;
  } catch {
    return false;
  }
}
function controls() {
  const locked = importing || !!controller;
  for (const b of document.querySelectorAll(
    'main button:not(#evaluate):not(#cancel),main select,main textarea,main input:not(#confirm)',
  ))
    b.disabled = locked;
  $('confirm').disabled = locked || !available();
  $('evaluate').disabled = locked || !available() || !$('confirm').checked;
  $('cancel').hidden = !controller;
  $('swap').disabled = locked || !sides.some((s) => task.images[s]);
  for (const b of document.querySelectorAll('[data-needs-image]'))
    b.disabled = locked || !task.images[b.dataset.needsImage];
}
function invalidate() {
  result = null;
  $('results').hidden = true;
  $('confirm').checked = false;
  $('evaluate').firstChild.textContent = 'Evaluate pair ';
  status(
    available() ? 'Review the request and candidate order, then confirm.' : 'Add a request and two candidates.',
  );
}
function updatePreview() {
  const sources = new Set(sides.map((s) => task.images[s]?.source).filter(Boolean));
  if (sources.size) task.source = sources.size === 1 ? [...sources][0] : 'mixed';
  $('preview').textContent = available()
    ? [
        'Confirmation preview',
        task.request,
        ...sides.map(
          (s) => s + ' · ' + assetFor(s).label + ' · ' + task.images[s].width + ' × ' + task.images[s].height,
        ),
      ].join('\n')
    : '';
  controls();
}
function render() {
  $('request').value = task.request;
  $('scope').value = task.captureScope;
  for (const side of sides) {
    const a = assetFor(side),
      win = $(side + 'Window');
    win.replaceChildren();
    if (a) {
      const img = el('img');
      img.src = a.url;
      img.alt = side + ' candidate';
      win.append(img);
    } else win.append(el('span', 'Drop or paste ' + side.toLowerCase() + ' image'));
    $(side + 'Meta').textContent = a
      ? a.label + ' · ' + a.ref.width + ' × ' + a.ref.height + ' · ' + formatSize(a.ref.bytes)
      : '';
    $(side + 'Upload').textContent = a ? 'Replace' : 'Upload';
  }
  $('pool').replaceChildren();
  for (const a of assets.values()) {
    const row = el('div');
    row.className = 'resource';
    const thumb = el('img');
    thumb.alt = '';
    thumb.src = a.url;
    row.append(
      thumb,
      el('span', a.label),
      button('Inspect', () => inspect(a)),
      ...sides.map((side) =>
        button('Use as ' + side, () => {
          setCandidate(side, a);
          invalidate();
          render();
        }),
      ),
    );
    $('pool').append(row);
  }
  $('poolBox').hidden = !assets.size;
  $('recovery').hidden = !task.warnings.length;
  $('recovery').textContent = task.warnings.join(' ');
  updatePreview();
}
function reset() {
  for (const a of assets.values()) URL.revokeObjectURL(a.url);
  assets.clear();
  task = createTask();
  inspected = null;
  $('large').removeAttribute('src');
  $('alternates').replaceChildren();
  $('poolBox').open = false;
  invalidate();
  render();
}
function showAlternates(requests) {
  $('alternates').replaceChildren();
  if (requests.length < 2) return;
  const label = el('label', 'Recovered text candidates'),
    select = el('select');
  select.append(
    new Option('Choose a possible request', ''),
    ...requests.map((r, i) => new Option(r.slice(0, 100), String(i))),
  );
  select.onchange = () => {
    if (select.value !== '') {
      task.request = requests[Number(select.value)];
      invalidate();
      render();
    }
  };
  label.append(select);
  $('alternates').append(label);
}
async function ingest(files, target, source = 'file') {
  if (controller || importing || !files.length) return;
  importing = true;
  controls();
  let added = 0;
  const errors = [];
  try {
    status('Reading task files…');
    const inputs = [];
    for (const file of files) {
      if (file.size > 64 * 1024 * 1024) {
        errors.push('Individual files must be at most 64 MiB.');
        continue;
      }
      const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
      const image = imageType(head);
      const archive =
        !image && (/\.(?:mht|mhtml)$/i.test(file.name) || /multipart\//i.test(new TextDecoder().decode(head)));
      if (image || archive) inputs.push({ file, archive });
      else errors.push('Unsupported file. Choose MHTML, PNG, JPEG or WebP.');
    }
    if (inputs.filter((i) => i.archive).length > 1) {
      status('Each archive starts a separate task. Open one at a time.');
      return;
    }
    // Apply the archive first, then add loose images to empty slots or the pool.
    inputs.sort((a, b) => Number(b.archive) - Number(a.archive));
    let changed = false;
    for (const { file: f, archive } of inputs) {
      try {
        if (!archive) {
          const a = await normalizeImage(
            f,
            source,
            source === 'clipboard' ? 'Clipboard image' : f.name || 'Uploaded file',
          );
          a.label = f.name || 'Pasted image';
          remember(a);
          added++;
          const side = target || sides.find((s) => !task.images[s]);
          if (side) setCandidate(side, a);
          target = null;
        } else {
          const recovery = extractArchive(new Uint8Array(await f.arrayBuffer()));
          const loaded = new Map();
          for (const entry of recovery.images) {
            try {
              const a = await normalizeImage(
                entry.blob,
                'archive',
                'Embedded raster ' + (entry.part?.index ?? 'inline'),
              );
              a.label = entry.label;
              loaded.set(entry, a);
            } catch {
              recovery.warnings.push('An embedded raster could not be decoded.');
            }
          }
          // A new archive starts a distinct task; never combine an earlier request with new inferred sides.
          if (!loaded.size && !recovery.requests.length)
            throw Error(recovery.warnings.join(' ') || 'No task content recovered.');
          reset();
          task.source = 'archive';
          task.provenance = 'Generic MIME archive adapter';
          task.metadata = recovery.metadata;
          task.request = recovery.requests.length === 1 ? recovery.requests[0] : '';
          task.warnings = recovery.warnings;
          for (const a of loaded.values()) remember(a);
          for (const s of sides) setCandidate(s, loaded.get(recovery.assigned[s]));
          showAlternates(recovery.requests);
          $('poolBox').open = true;
          added += loaded.size;
        }
        changed = true;
      } catch (e) {
        errors.push(e.message);
      }
    }
    if (task.source !== 'archive' && added) {
      task.source = source;
      task.provenance = source === 'clipboard' ? 'Clipboard import' : 'Manual image assignment';
    }
    if (changed) {
      invalidate();
      render();
    }
    if (added || errors.length)
      status(
        [
          added ? 'Recovered ' + added + ' image' + (added === 1 ? '' : 's') + '. Review the assignments.' : '',
          ...errors,
        ]
          .filter(Boolean)
          .join(' '),
      );
  } catch (error) {
    status(error.message || 'Could not read the input files.');
  } finally {
    importing = false;
    controls();
  }
}

for (const side of sides) {
  const panel = el('section');
  panel.className = 'panel';
  panel.tabIndex = 0;
  panel.dataset.side = side;
  panel.setAttribute('aria-label', side + ' image panel');
  const header = el('header'),
    title = el('h3', side),
    pick = el('input');
  title.className = 'side';
  pick.type = 'file';
  pick.accept = 'image/png,image/jpeg,image/webp';
  pick.hidden = true;
  pick.onchange = () => {
    ingest([...pick.files], side);
    pick.value = '';
  };
  const upload = button('Upload', () => pick.click());
  upload.id = side + 'Upload';
  upload.setAttribute('aria-label', 'Upload or replace ' + side);
  header.append(title, upload, pick);
  const win = el('div');
  win.id = side + 'Window';
  win.className = 'window';
  win.ondblclick = () => {
    if (assetFor(side)) inspect(assetFor(side));
  };
  const meta = el('p');
  meta.id = side + 'Meta';
  meta.className = 'meta';
  const actions = el('div');
  actions.className = 'actions';
  const inspectButton = button('Inspect / crop', () => inspect(assetFor(side)));
  const remove = button('Remove', () => {
    setCandidate(side, null);
    invalidate();
    render();
  });
  for (const b of [inspectButton, remove]) b.dataset.needsImage = side;
  actions.append(inspectButton, remove);
  panel.append(header, win, meta, actions);
  $('panels').append(panel);
}
$('browse').onclick = () => $('files').click();
$('files').onchange = () => {
  ingest([...$('files').files], null);
  $('files').value = '';
};
for (const type of ['dragenter', 'dragover', 'dragleave', 'drop'])
  window.addEventListener(type, (event) => {
    event.preventDefault();
    const target = event.target.closest?.('.panel,.drop');
    if (type === 'dragover') {
      if (target) target.classList.add('drag');
      return;
    }
    if (type === 'dragleave') target?.classList.remove('drag');
    if (type === 'drop') {
      document.querySelectorAll('.drag').forEach((n) => n.classList.remove('drag'));
      if (!$('viewer').open) ingest([...event.dataTransfer.files], target?.dataset.side);
    }
  });
window.addEventListener('paste', (event) => {
  const files = Array.from(event.clipboardData?.items || [])
    .filter((i) => i.kind === 'file')
    .map((i) => i.getAsFile())
    .filter(Boolean);
  if (!files.length) return;
  event.preventDefault();
  if (!$('viewer').open) ingest(files, event.target.closest?.('.panel')?.dataset.side, 'clipboard');
});
$('request').oninput = () => {
  task.request = $('request').value;
  invalidate();
  updatePreview();
};
$('confirm').onchange = controls;
$('scope').onchange = () => {
  task.captureScope = $('scope').value;
  invalidate();
  updatePreview();
};
$('clear').onclick = reset;
$('swap').onclick = () => {
  task = swap(task);
  invalidate();
  render();
};
$('demo').onclick = async () => {
  if (importing || controller) return;
  importing = true;
  controls();
  try {
    const samples = await Promise.all(
      ['standard', 'red'].map(async (name) => {
        const res = await fetch(new URL('fixtures/images/' + name + '.png', import.meta.url));
        if (!res.ok) throw Error('Could not load synthetic sample.');
        const a = await normalizeImage(await res.blob(), 'synthetic', 'Built-in exhibition fixture');
        a.label = 'Exhibit · ' + name;
        return a;
      }),
    );
    reset();
    task.request = demoRequest;
    task.source = 'synthetic';
    task.provenance = 'Synthetic demonstration';
    task.captureScope = 'viewport';
    sides.forEach((s, i) => setCandidate(s, remember(samples[i])));
    invalidate();
    render();
  } catch (e) {
    status(e.message);
  } finally {
    importing = false;
    controls();
  }
};
function setModels() {
  const mock = $('provider').value === 'mock';
  $('model').replaceChildren(...(mock ? ['fixture-v1'] : models).map((m) => new Option(m, m)));
  $('providerNote').textContent = mock
    ? 'Runs locally. Load the sample for a scripted comparison.'
    : 'Evaluation sends the confirmed request and both images to OpenAI through your local server.';
}
$('provider').onchange = () => {
  setModels();
  invalidate();
  updatePreview();
};
for (const id of ['model', 'diagnostic', 'reverse'])
  $(id).onchange = () => {
    invalidate();
    updatePreview();
  };
const loopback = location.hostname === '127.0.0.1';
if (loopback)
  fetch(new URL('config', import.meta.url))
    .then((r) => (r.ok ? r.json() : null))
    .then((config) => {
      models = config?.models || [];
      if (models.length) {
        const o = $('provider').options[1];
        o.disabled = false;
        o.textContent = 'OpenAI · local server';
      }
    })
    .catch(() => {});
function provider() {
  if ($('provider').value === 'mock') return mockProvider((ref) => ref.sha256);
  return {
    name: 'OpenAI',
    async observe(task, { signal, model, diagnostic }) {
      const images = {};
      for (const side of sides) images[side] = await dataURL(assets.get(task.images[side].id).blob);
      const res = await fetch(new URL('observe', import.meta.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          request: task.request,
          captureScope: task.captureScope,
          images,
          model,
          diagnostic,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw Error(error.error || 'Local vision service failed.');
      }
      return res.json();
    },
  };
}
$('evaluate').onclick = async () => {
  if (controller || importing || !available() || !$('confirm').checked) return;
  controller = new AbortController();
  controls();
  $('results').hidden = true;
  result = null;
  try {
    result = await evaluate(task, provider(), {
      model: $('model').value,
      signal: controller.signal,
      reverse: $('reverse').checked,
      diagnostic: $('diagnostic').checked,
      progress: status,
    });
    renderResult();
    status(
      result.verification && !result.verification.consistent
        ? 'Reverse-order disagreement. Review the pair.'
        : 'Evaluation complete.',
    );
  } catch (e) {
    status(controller.signal.aborted ? 'Evaluation cancelled.' : e.message);
    $('evaluate').firstChild.textContent = 'Retry evaluation ';
  } finally {
    controller = null;
    controls();
  }
};
$('cancel').onclick = () => controller?.abort();
function line(parent, title, value) {
  const p = el('p');
  p.className = 'resultline';
  p.append(el('b', title + ' · '), document.createTextNode(String(value)));
  parent.append(p);
}
function renderResult() {
  const o = result.observation,
    t = result.telemetry,
    summary = $('summary'),
    breakdown = $('breakdown');
  $('decision').textContent =
    result.decision === 'REVIEW'
      ? 'Review required'
      : sides.includes(result.decision)
        ? result.decision + ' is better'
        : 'Tie';
  $('resultStage').textContent = result.stage.replaceAll('_', ' ');
  $('why').textContent = result.why;
  summary.replaceChildren();
  line(summary, 'Confidence', result.confidence);
  for (const s of sides) line(summary, s, result.evidence[s]);
  if (o.limitations.length) line(summary, 'Limitations', o.limitations.join(' '));
  line(
    summary,
    'Run',
    [
      t.provider,
      t.model,
      t.latencyMs + ' ms',
      t.inputTokens == null ? '' : t.inputTokens + ' input / ' + t.outputTokens + ' output tokens',
      t.estimatedUsd == null ? 'Cost unavailable' : '$' + t.estimatedUsd.toFixed(4),
    ]
      .filter(Boolean)
      .join(' · '),
  );
  if (result.verification) {
    const v = result.verification;
    line(
      summary,
      'Reverse order',
      v.reversedDecision +
        ' → original ' +
        v.mappedDecision +
        ' · ' +
        (v.consistent ? 'consistent' : 'disagreement'),
    );
  }
  breakdown.replaceChildren();
  if (!o.requirements.length) line(breakdown, 'Requirements', 'None recorded.');
  for (const r of o.requirements) {
    line(breakdown, r.excerpt, r.scope);
    for (const s of sides) line(breakdown, s, r.status[s] + ' · ' + r.evidence[s]);
  }
  if (!o.defects.length) line(breakdown, 'Defects', 'None recorded.');
  for (const d of o.defects)
    line(breakdown, d.side + ' ' + d.type, d.severity + ' · ' + d.location + ' · ' + d.evidence[d.side]);
  $('diag').textContent = JSON.stringify(
    { passes: o.passes, principles: o.principles, inferences: o.inferences, verification: result.verification },
    null,
    2,
  );
  $('diagBox').open = $('diagnostic').checked;
  $('results').hidden = false;
  $('results').scrollIntoView({ block: 'nearest' });
}
const json = () => JSON.stringify(result, null, 2);
async function copy(value) {
  try {
    await navigator.clipboard.writeText(value);
    status('Copied to clipboard.');
  } catch {
    status('Clipboard unavailable. Use Export evaluation.');
  }
}
$('copyWhy').onclick = () => copy(result.why);
$('copyJson').onclick = () => copy(json());
$('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([json()], { type: 'application/json' }));
  const a = el('a');
  a.href = url;
  a.download = 'olaf-' + task.id + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function zoom(percent) {
  $('large').style.width = (inspected.ref.width * percent) / 100 + 'px';
  $('zoom').value = percent;
  drawSelection();
}
function fit() {
  zoom(
    Math.min(
      100,
      ($('viewport').clientWidth / inspected.ref.width) * 100,
      ($('viewport').clientHeight / inspected.ref.height) * 100,
    ),
  );
}
function inspect(a) {
  if (!a || controller || importing) return;
  inspected = a;
  $('viewerTitle').textContent = a.label + ' · ' + a.ref.width + ' × ' + a.ref.height;
  $('large').src = a.url;
  $('viewStatus').textContent = '';
  $('cropBox').open = false;
  for (const [id, value] of Object.entries({
    x: 0,
    y: 0,
    w: Math.max(1, Math.floor(a.ref.width / 2)),
    h: a.ref.height,
  }))
    $(id).value = value;
  $('viewer').showModal();
  fit();
}
$('closeViewer').onclick = () => $('viewer').close();
$('viewer').onclose = () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  $('large').removeAttribute('src');
  inspected = null;
};
$('fit').onclick = fit;
$('zoom').oninput = () => zoom(+$('zoom').value);
$('full').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
    fit();
  } catch {
    $('viewStatus').textContent = 'Fullscreen is unavailable. Use the zoom slider.';
  }
};
const coordinates = () => ({
  x: $('x').valueAsNumber,
  y: $('y').valueAsNumber,
  width: $('w').valueAsNumber,
  height: $('h').valueAsNumber,
});
function drawSelection() {
  if (!inspected) return;
  const { x, y, width, height } = coordinates(),
    box = $('selection');
  box.hidden = !$('cropBox').open;
  Object.assign(box.style, {
    left: (x / inspected.ref.width) * 100 + '%',
    top: (y / inspected.ref.height) * 100 + '%',
    width: (width / inspected.ref.width) * 100 + '%',
    height: (height / inspected.ref.height) * 100 + '%',
  });
}
$('cropBox').ontoggle = () => {
  drawSelection();
  $('canvas').style.touchAction = $('cropBox').open ? 'none' : '';
};
for (const id of ['x', 'y', 'w', 'h']) $(id).oninput = drawSelection;
let start = null;
function point(e) {
  const rect = $('large').getBoundingClientRect(),
    r = inspected.ref;
  return [
    Math.max(0, Math.min(r.width, Math.round(((e.clientX - rect.left) * r.width) / rect.width))),
    Math.max(0, Math.min(r.height, Math.round(((e.clientY - rect.top) * r.height) / rect.height))),
  ];
}
$('canvas').onpointerdown = (e) => {
  if (!$('cropBox').open) return;
  start = point(e);
  $('canvas').setPointerCapture(e.pointerId);
};
$('canvas').onpointermove = (e) => {
  if (!start) return;
  const [x, y] = point(e);
  $('x').value = Math.min(start[0], x);
  $('y').value = Math.min(start[1], y);
  $('w').value = Math.abs(start[0] - x);
  $('h').value = Math.abs(start[1] - y);
  drawSelection();
};
$('canvas').onpointerup = $('canvas').onpointercancel = () => {
  start = null;
};
for (const side of sides)
  $('crop' + side).onclick = async () => {
    const original = inspected;
    try {
      const a = await cropImage(original, coordinates());
      if (inspected !== original) {
        URL.revokeObjectURL(a.url);
        return;
      }
      a.label = original.label + ' · ' + side + ' crop';
      setCandidate(side, remember(a));
      invalidate();
      render();
      $('viewStatus').textContent = 'Assigned crop to ' + side + '.';
    } catch (e) {
      $('viewStatus').textContent = e.message;
    }
  };
// Public index convention. Only the canonical public page can send an ordinary page view.
if (
  location.href === 'https://hmarquardt.github.io/junkdrawer/olaf.html' &&
  [
    '',
    'https://hmarquardt.github.io/junkdrawer/',
    'https://hmarquardt.github.io/junkdrawer/index.html',
  ].includes(document.referrer)
) {
  const config = $('pageview').content.querySelector('script'),
    script = el('script');
  for (const attr of config.attributes) script.setAttribute(attr.name, attr.value);
  document.head.append(script);
}
setModels();
render();
