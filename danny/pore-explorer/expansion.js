// Dani the Pimple Popper 1.1 — The Pore Explorer.
// Loaded on demand by the base game. Nothing in this file, its manifest or its plates is fetched
// until a player opens the expansion, so the 1.0 campaign keeps its startup cost and offline shell.
import {content} from '../content.js';
import {build, replay, remainingDraws, preview} from '../reservoir.js';
import {eject} from '../simulation.js';
import {earnAchievements} from '../progression.js';
import * as scope from './porescope.js';

const NS = 'pore-explorer';
const CAMPAIGN = 'pore-explorer:campaign';
const ENDLESS = 'pore-explorer:endless';
const ZEN = 'pore-explorer:zen';
let api = null, built = false, graphs = new Map(), animateRaf = 0, scanRaf = 0, scanStamp = 0;
let lastScanSave = 0, panel = null, scanFound = 0;
// Frame-time gain is fractional; keep the remainder in memory so an integer save field still grows.
const gainCarry = new Map();
const view = {mode: 'surface', shown: 0, focus: null, scanning: false, beam: {x: .5, y: .55}, flourish: null};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hash = text => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; };

export const namespace = NS;
export const campaignMode = CAMPAIGN;
export const expansionModes = [CAMPAIGN, ENDLESS, ZEN];
export function attach(context) { api = context; }
export function active() { return !!api && String(api.visit()?.mode?.id || '').startsWith(NS + ':'); }
export function recordMode(modeId) { return String(modeId || '').startsWith(NS + ':'); }

// ---------------------------------------------------------------------------------------------
// Deterministic reservoir state. The graph is a pure function of the template, the encounter seed
// and the target index; progress is the committed pass count, the broken-gate list and the scan.
function deepFor(run, id) {
  run.deep ??= {};
  const existing = run.deep[id];
  if (existing && typeof existing.c === 'string' && existing.c.length === 72 && Array.isArray(existing.g)) return existing;
  // One small record per target: coverage mask, depth gain and broken gate indices.
  return (run.deep[id] = {...scope.emptyScan(), g: []});
}
function graphFor(target, visit) {
  const key = target.deep.template.id + ':' + target.deep.seed;
  let graph = graphs.get(key);
  if (!graph) {
    graph = build(target.deep.template, target.deep.seed);
    if (graphs.size > 24) graphs.clear();
    graphs.set(key, graph);
  }
  return graph;
}
export function progressOf(run, target) {
  const deep = deepFor(run, target.id), committed = run.layers[target.id] || 0;
  const base = replay(target.deep.graph, {p: committed, g: deep.g});
  const found = scope.discoveries(target.deep.graph, deep, base);
  return {p: committed, g: deep.g, found};
}
// The field generator attaches the authored reservoir template; this decorates each target with its
// generated graph and the number of passes the current state still needs.
export function decorate(field, visit) {
  for (const target of field) {
    if (!target.reservoir) continue;
    const seed = (visit.seed ^ Math.imul(target.id + 1, 0x9e3779b1) ^ hash(visit.encounter.id)) >>> 0;
    target.deep = {template: target.reservoir, seed};
    target.deep.graph = graphFor(target, visit);
    const progress = progressOf(api.run(), target);
    const state = replay(target.deep.graph, progress);
    target.deep.state = state;
    target.layers = Math.max(1, progress.p + remainingDraws(target.deep.graph, progress));
  }
}
export function accounting(target, run) {
  if (!target?.deep) return null;
  const state = replay(target.deep.graph, progressOf(run, target));
  return {initial: target.deep.graph.totalVolume, remaining: state.remaining, drawn: state.drawn,
    negative: state.nodes.some(node => node.remaining < 0)};
}
export function graphOf(target) { return target?.deep?.graph || null; }

// ---------------------------------------------------------------------------------------------
// Commentary: authored lines from the pack, chosen deterministically so a case replays the same way.
function pick(event, salt) {
  const lines = content.list('commentary').filter(line => line.event === event);
  return lines.length ? lines[hash(event + ':' + salt) % lines.length].text : '';
}
function say(event, salt, fallback = '') { return pick(event, salt) || fallback; }

// ---------------------------------------------------------------------------------------------
// Release behaviour. Returns null for targets the base engine owns, so base calls stay untouched.
function pendingGate(graph, state) {
  const unbroken = state.gates.find(gate => !gate.broken);
  if (unbroken) return unbroken.index;
  if (graph.migrating) return -1 - state.pass;
  return null;
}
function blockedHint(graph, state) {
  if (state.held) return 'The migrating plug is sitting on the next chamber. Resonate it, then pull.';
  const unbroken = state.gates.find(gate => !gate.broken);
  if (unbroken) return 'A ' + unbroken.type + ' blocks the path. The resonance wand can break it.';
  if (state.unrevealed.length) return 'The outlet is open but the field is not empty. Scan deeper: something is still sealed.';
  return 'Nothing is moving. Check the imaging and choose another route.';
}
function burstFor({target, graph, tool, drained, secondary, value, dx, dy, layer}) {
  const groups = new Map();
  for (const item of [...drained, ...secondary]) {
    const id = item.material || 'base:cream';
    const group = groups.get(id) || {id, amount: 0};
    group.amount += item.amount;
    groups.set(id, group);
  }
  const entries = [...groups.values()].filter(entry => entry.amount > 0.0001).slice(0, 3);
  if (!entries.length) entries.push({id: target.material?.id || 'base:cream', amount: 1});
  const long = graph.pattern === 'ribbon' ? 2.6 : graph.pattern === 'fork' ? 1.15 : 1;
  const streams = entries.map((entry, index) => {
    const material = content.get('materials', entry.id);
    const pseudo = {...target, material, phase: target.phase + index * 1.73};
    const angle = entries.length > 1 ? (index - (entries.length - 1) / 2) * 0.62 : 0;
    return eject(pseudo, value, dx, dy, layer + index, tool,
      {length: long, scale: 1 - index * 0.12, angle});
  });
  return {id: target.id, mat: streams[0].mat, streams, t: 0};
}
function awardBoss(profile, visit) {
  const id = visit.boss?.id;
  if (id === 'pore-explorer:iceberg') profile.stats.icebergs = (profile.stats.icebergs || 0) + 1;
  if (id === 'pore-explorer:krakenzit') profile.stats.krakenzits = (profile.stats.krakenzits || 0) + 1;
  if (id === 'pore-explorer:hydra') profile.stats.hydras = (profile.stats.hydras || 0) + 1;
}
export function flow({profile, visit, run, target, tool, value, perfect, dx, dy}) {
  if (!target?.deep) return null;
  const graph = target.deep.graph, deep = deepFor(run, target.id);
  const progress = progressOf(run, target);
  const state = replay(graph, progress);
  // A reservoir can be empty while a concealed compartment was only just exposed. Sealing it is a
  // normal release: the field is done even though no new volume moves. This also prevents a
  // soft-lock if a player scans after draining the last chamber.
  if (state.complete) {
    target.layers = Math.max(1, state.pass);
    const burst = burstFor({target, graph, tool, secondary: [],
      drained: [{material: target.material?.id || graph.nodes[0].material, amount: .2}], value, dx, dy, layer: state.pass});
    return {steps: 1, burst, done: true, pan: 0, cue: 'deep', earned: earnAchievements(profile), secondary: 0,
      message: say('complete', visit.encounter.id, 'Reservoir cleared.')};
  }
  // The PoreScope never grips material: a release sends a diagnostic pulse instead.
  if (tool.technique === 'probe') {
    scope.scanGain(deep, 7 + Math.round(value * 7));
    scope.addScan(deep, scope.beamCell(target, view.beam), 90);
    const after = progressOf(run, target);
    const found = registerDiscovery(profile, graph, progress, after);
    target.deep.state = replay(graph, after);
    refresh(target, run);
    const message = found
      ? found + ' concealed chamber' + (found === 1 ? '' : 's') + ' resolved. ' + say('scan', target.phase)
      : 'Diagnostic pulse. Depth gain increased. Sweep the beam across the field.';
    return {diagnostic: true, message, pan: 0, cue: 'scope', earned: []};
  }
  let gates = progress.g;
  if (tool.technique === 'resonance') {
    const pending = pendingGate(graph, state);
    if (pending === null)
      return {refused: true, cue: 'miss', message: 'The wand finds nothing to resonate. It cannot grip ordinary material.'};
    gates = [...gates, pending];
  }
  const attempt = preview(graph, {p: progress.p, g: gates, found: progress.found}, tool);
  if (attempt.blocked) return {blocked: true, cue: 'miss', message: blockedHint(graph, state)};
  const drained = attempt.drained.filter(item => item.amount > 0.0001);
  if (!drained.length) return {blocked: true, cue: 'miss', message: blockedHint(graph, state)};
  deep.g = gates;
  const after = replay(graph, {p: attempt.passes, g: gates, found: progress.found});
  const secondary = after.events.slice(state.pass).flatMap(event => event.secondary);
  if (secondary.length) profile.stats.secondarySwarm = Math.max(profile.stats.secondarySwarm || 0, secondary.length);
  const done = after.complete;
  if (done) {
    if (graph.pattern === 'ribbon') profile.stats.ribbons = (profile.stats.ribbons || 0) + 1;
    const mapped = scope.mappedByImaging(graph, deep);
    if (graph.hidden > 0 && mapped.length === graph.hidden) profile.stats.networks = (profile.stats.networks || 0) + 1;
    if (target.boss) awardBoss(profile, visit);
    // A mystery case solved without imaging every concealed compartment is the harder version.
    if (visit.encounter.mystery && graph.hidden > 0 && mapped.length < graph.hidden)
      profile.stats.mysterySolves = (profile.stats.mysterySolves || 0) + 1;
    if (target.boss) { view.flourish = {t: 0}; }
  }
  const remaining = done ? 0 : Math.max(1, remainingDraws(graph, {p: attempt.passes, g: gates, found: progress.found}));
  // teaching the completion threshold to reward(): passes completed plus passes still owed
  target.layers = Math.max(1, attempt.passes + remaining);
  target.deep.state = after;
  const earned = earnAchievements(profile);
  const burst = burstFor({target, graph, tool, drained, secondary, value, dx, dy, layer: progress.p});
  const pan = entriesPan(drained);
  const materialChanged = new Set(drained.map(item => item.material)).size > 1;
  let message;
  if (done) message = say('complete', visit.encounter.id, 'Reservoir cleared.');
  else if (secondary.length) message = say('chain', target.phase, 'A chamber finished and woke its neighbours.');
  else if (state.held || after.held) message = say('plug', target.phase, 'The plug has moved to another chamber.');
  else if (materialChanged) message = say('mixed', target.phase, 'The material changed mid-case.');
  else if (graph.pattern === 'ribbon') message = say('ribbon', target.phase, 'Still coming. That is a lot of ribbon.');
  else if (graph.pattern === 'braid') message = say('braid', target.phase, 'Branch by branch.');
  else message = 'Chamber drained. ' + (after.remaining > 0 ? 'There is more below.' : 'The field reads empty.');
  refresh(target, run);
  return {steps: attempt.steps, burst, done, message, pan, earned,
    cue: secondary.length ? 'secondary' : done ? 'deep' : 'release', secondary: secondary.length};
}
function entriesPan(drained) {
  const node = drained[0];
  return node ? clamp((node.depth - 0.2) * 1.4, -0.8, 0.8) : 0;
}
function registerDiscovery(profile, graph, before, after) {
  const added = after.found.filter(key => !before.found.includes(key));
  if (!added.length) return 0;
  const concealed = added.filter(key => graph.nodes.find(node => node.key === key)?.hidden).length;
  if (concealed) profile.stats.concealed = (profile.stats.concealed || 0) + concealed;
  return concealed;
}

// ---------------------------------------------------------------------------------------------
// Imaging UI. The panel is injected once, on mount, and stays hidden unless an expansion field is
// active. Scanning is pointer- and keyboard-driven and only advances where the beam actually is.
const readDeep = () => {
  if (!active()) return null;
  const visit = api.visit(), run = api.run(), target = api.field()[api.active()];
  if (!target?.deep) return null;
  const progress = progressOf(run, target);
  const state = replay(target.deep.graph, progress);
  return {visit, run, target, progress, state, deep: deepFor(run, target.id), graph: target.deep.graph};
};
function refresh(target, run) {
  if (!target?.deep) return;
  target.deep.state = replay(target.deep.graph, progressOf(run, target));
  hud();
}
function foundCount(state, graph) {
  return state.nodes.filter(node => node.revealed && graph.nodes.some(item => item.key === node.key)).length;
}
export function sync() {
  if (!panel) return;
  // Keep every inspector snapshot current, including targets finished by the previous release.
  if (active()) for (const target of api.field()) if (target.deep) target.deep.state = replay(target.deep.graph, progressOf(api.run(), target));
  const live = readDeep();
  panel.hidden = !live;
  const stage = document.getElementById('stage');
  if (stage) {
    stage.classList.toggle('scope-live', !!live && view.mode !== 'surface');
    stage.classList.toggle('scope-image', !!live && view.mode !== 'surface');
  }
  if (!live) { view.scanning = false; view.focus = null; view.shown = 0; view.mode = 'surface'; viewKeys(); return; }
  hud(live);
}
function hud(live = readDeep()) {
  if (!panel || !live) return;
  const {state, graph, deep, target, run, visit} = live;
  const revealed = foundCount(state, graph);
  const needed = target.layers || 1;
  const pass = Math.min(run.layers[target.id] || 0, needed);
  const total = graph.nodes.length;
  const gain = Math.round((deep.d || 0) / 48 * 100);
  const blocked = state.held ? 'PLUG' : (state.gates.find(gate => !gate.broken)?.type || '').toUpperCase();
  const hair = Math.round((visit.region.hair || 0) * 100);
  document.getElementById('scopeDepth').textContent = 'DEPTH ' + gain + '%';
  document.getElementById('scopeGain').style.width = gain + '%';
  document.getElementById('scopeReadout').textContent = revealed + '/' + total + ' chambers mapped · pass ' + pass + '/' + needed +
    (blocked ? ' · ' + blocked + ' obstructed' : '') + (hair > 20 ? ' · hair interference ' + hair + '%' : '') +
    (state.held ? ' · plug at chamber ' + state.held.slice(1) : '');
  document.getElementById('scanBtn').setAttribute('aria-pressed', view.scanning);
}
function viewKeys() {
  for (const button of panel?.querySelectorAll('[data-view]') || [])
    button.setAttribute('aria-pressed', button.dataset.view === view.mode);
}
function setViewMode(mode) {
  if (!scope.VIEWS.includes(mode)) return;
  if (mode !== 'scan' && view.scanning) stopScan();
  view.mode = mode;
  if (mode === 'surface') view.focus = null;
  viewKeys(); sync();
  const stage = document.getElementById('stage');
  if (stage) {
    stage.classList.toggle('scope-live', mode !== 'surface');
    stage.classList.toggle('scope-image', mode !== 'surface');
  }
  wake();
}
export function setMode(mode) { setViewMode(mode); }
export function getMode() { return view.mode; }
function wake() {
  if (!animateRaf && active()) animateRaf = requestAnimationFrame(animate);
}
function animate() {
  animateRaf = 0;
  if (!active()) { view.shown = 0; return; }
  const goal = Math.max(0, scope.VIEWS.indexOf(view.mode));
  const diff = goal - view.shown;
  if (Math.abs(diff) > 0.01) view.shown += diff * 0.24; else view.shown = goal;
  if (view.flourish) {
    view.flourish.t = Math.min(1, view.flourish.t + 0.022);
    if (view.flourish.t >= 1) view.flourish = null;
  }
  api.paint();
  if (Math.abs(goal - view.shown) > 0.01 || view.flourish) animateRaf = requestAnimationFrame(animate);
}
export function aim(nx, ny) {
  view.beam.x = clamp(nx, 0, 1); view.beam.y = clamp(ny, 0, 1);
  if (view.mode === 'surface') return;
  api.paint();
}
export function nudge(dx, dy) {
  aim(view.beam.x + dx, view.beam.y + dy);
  if (view.scanning) scanTick(performance.now());
}
function scanRate(live) {
  const tool = api.tool();
  const focus = tool.technique === 'probe' ? 1 : 0.34;
  const hair = live.visit.region.hair || 0;
  return (0.75 + focus) * (1 - 0.45 * hair);
}
export function startScan() {
  if (!active()) return false;
  if (view.mode !== 'scan') setViewMode('scan');
  if (view.scanning) return true;
  view.scanning = true; scanStamp = performance.now(); scanFound = 0;
  panel?.querySelector('#scanBtn')?.setAttribute('aria-pressed', 'true');
  api.cue('Sweeping. Hold and move across the field to map the reservoir.');
  scanRaf = requestAnimationFrame(scanTick);
  return true;
}
export function stopScan() {
  if (!view.scanning) return;
  view.scanning = false;
  panel?.querySelector('#scanBtn')?.setAttribute('aria-pressed', 'false');
  const live = readDeep();
  if (live) { api.save(); lastScanSave = performance.now(); }
  if (!scanFound) api.cue('Sweep complete. No new structure resolved — move the beam over the faint markers.');
  api.paint();
}
function scanTick(stamp) {
  scanRaf = 0;
  if (!view.scanning || !active()) return;
  const dt = Math.min(0.09, Math.max(0.008, (stamp - scanStamp) / 1000));
  scanStamp = stamp;
  const live = readDeep();
  if (!live) { view.scanning = false; return; }
  const {deep, graph, target, progress, visit, run} = live;
  const rate = scanRate(live);
  scope.addScan(deep, scope.beamCell(target, view.beam), rate * dt * 320);
  const carry = (gainCarry.get(target.id) || 0) + rate * dt * 12;
  const whole = Math.floor(carry);
  gainCarry.set(target.id, carry - whole);
  if (whole > 0) scope.scanGain(deep, whole);
  const after = progressOf(run, target);
  const found = registerDiscovery(api.profile(), graph, progress, after);
  target.deep.state = replay(graph, after);
  if (found) {
    scanFound += found;
    api.play('deep', 0, clamp(target.x * 2 - 1, -0.8, 0.8));
    api.cue(say('scan', target.phase + found, 'Concealed structure resolved.') + ' (' + found + ' new)');
    if (performance.now() - lastScanSave > 900) { api.save(); lastScanSave = performance.now(); }
  }
  hud(live); api.paint();
  scanRaf = requestAnimationFrame(scanTick);
}
export function pickNode(nx, ny) {
  const live = readDeep();
  if (!live) return null;
  const {target, graph, state} = live;
  let best = null, distance = 0.12;
  for (const node of graph.nodes) {
    const liveNode = state.nodes.find(item => item.key === node.key);
    if (!liveNode.revealed) continue;
    const x = target.x + node.x * target.size * scope.SPREAD.x, y = target.y + node.y * target.size * scope.SPREAD.y;
    const d = Math.hypot(x - nx, y - ny);
    if (d < distance) { distance = d; best = node.key; }
  }
  view.focus = best;
  if (best) {
    const node = state.nodes.find(item => item.key === best);
    api.cue('Chamber ' + best.slice(1) + ' · ' + node.material.split(':').pop() + ' · ' +
      node.remaining.toFixed(2) + '/' + node.volume.toFixed(2) + ' remaining · depth ' + (node.depth * 10).toFixed(1) + ' mm.');
  }
  api.paint();
  return best;
}
export function overlayContext() {
  const live = readDeep();
  if (!live) return null;
  const {target, state, graph, deep, visit} = live;
  return {
    target, state, graph, scan: deep, shown: view.shown, mode: view.mode, focus: view.focus,
    beam: view.beam, scanning: view.scanning, flourish: view.flourish,
    time: performance.now() / 1000, reduced: !!api.profile().settings.reducedMotion,
    hair: visit.region.hair || 0,
    tints: Object.fromEntries(content.list('materials').map(material => [material.id, material.color]))
  };
}
export function overlay(ctx, s, w, h) {
  const data = overlayContext();
  if (!data) return;
  if (view.mode === 'surface' && view.shown < 0.02 && !view.flourish) return;
  scope.draw(ctx, data, w, h);
}

// ---------------------------------------------------------------------------------------------
// Mount: inject the PoreScope panel, bind pointer and keyboard scanning, and own the overlay hook.
const esc = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export function mount() {
  // Called again once the renderer exists, so a checkpoint that resumes straight into the expansion
  // still installs the imaging overlay.
  if (built || !api) return;
  const paint = api.getPaint();
  if (!paint) return;
  built = true;
  paint.overlay = overlay;
  const host = document.querySelector('.console');
  if (host) {
    panel = document.createElement('section');
    panel.className = 'scope-panel'; panel.id = 'scopePanel'; panel.hidden = true;
    panel.setAttribute('aria-label', 'PoreScope imaging');
    panel.innerHTML =
      '<div class="panel-head"><h2><svg aria-hidden="true"><use href="#scan"/></svg>PoreScope</h2><span class="tiny" id="scopeDepth">DEPTH 0%</span></div>' +
      '<div class="scope-body">' +
        '<div class="scope-modes" role="group" aria-label="Imaging mode">' +
          '<button data-view="surface" aria-pressed="true">Surface</button>' +
          '<button data-view="scan" aria-pressed="false">Scan</button>' +
          '<button data-view="cross" aria-pressed="false">Cross-section</button>' +
        '</div>' +
        '<button id="scanBtn" class="scan-hold" aria-pressed="false"><svg aria-hidden="true"><use href="#scan"/></svg><span>Sweep scan</span></button>' +
        '<div class="scope-meter" aria-hidden="true"><i id="scopeGain"></i></div>' +
        '<p id="scopeReadout" role="status" aria-live="polite" class="scope-readout">Surface optics.</p>' +
        '<p class="scope-note">Fictional imaging. Sweep Scan mode to map the reservoir; arrows nudge the beam.</p>' +
      '</div>';
    host.append(panel);
    for (const button of panel.querySelectorAll('[data-view]'))
      button.onclick = () => setViewMode(button.dataset.view);
    const hold = panel.querySelector('#scanBtn');
    hold.addEventListener('pointerdown', e => {
      e.preventDefault(); hold.setPointerCapture(e.pointerId); startScan();
    });
    const release = () => stopScan();
    hold.addEventListener('pointerup', release); hold.addEventListener('pointercancel', release);
    hold.addEventListener('lostpointercapture', release);
    hold.addEventListener('keydown', e => {
      if (![' ', 'Enter'].includes(e.key)) return;
      e.preventDefault(); if (!e.repeat) startScan();
    });
    hold.addEventListener('keyup', e => { if ([' ', 'Enter'].includes(e.key)) { e.preventDefault(); stopScan(); } });
    hold.addEventListener('click', e => { if (e.detail === 0) { startScan(); setTimeout(stopScan, 900); } });
    hold.addEventListener('blur', release);
  }
  const stage = document.getElementById('stage');
  if (stage) {
    const point = e => {
      const box = stage.getBoundingClientRect();
      return {x: (e.clientX - box.left) / Math.max(1, box.width), y: (e.clientY - box.top) / Math.max(1, box.height)};
    };
    stage.addEventListener('pointermove', e => { if (active() && !e.target.closest('.marker')) { const p = point(e); aim(p.x, p.y); } });
    stage.addEventListener('pointerdown', e => {
      if (!active() || e.target.closest('.marker') || e.target.closest('button')) return;
      const p = point(e); aim(p.x, p.y);
      if (view.mode === 'scan') { e.preventDefault(); startScan(); }
      else if (view.mode === 'cross') pickNode(p.x, p.y);
    });
    window.addEventListener('pointerup', () => stopScan());
    stage.addEventListener('pointerleave', () => stopScan());
    document.addEventListener('keydown', e => {
      if (!active() || document.getElementById('dialog')?.open || view.mode === 'surface') return;
      if (e.target.closest('input,textarea,select')) return;
      const step = e.shiftKey ? 0.06 : 0.02;
      if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(step, 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, -step); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, step); }
      else if (e.key.toLowerCase() === 's' && view.mode === 'scan') { e.preventDefault(); view.scanning ? stopScan() : startScan(); }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopScan(); });
  }
  viewKeys();
}

// ---------------------------------------------------------------------------------------------
// Campaign entry: an independent checkpoint per expansion mode, replayable encounters, tutorials.
function seen(id) { return (api.profile().tutorials || []).includes(id); }
function markSeen(id) {
  const profile = api.profile();
  profile.tutorials ??= [];
  if (!profile.tutorials.includes(id)) profile.tutorials.push(id);
}
function showTutorial(id, after) {
  let record;
  try { record = content.get('tutorials', id); } catch { after?.(); return; }
  markSeen(id);
  api.save();
  api.modal(record.title,
    '<p class="tiny">THE PORE EXPLORER · TUTORIAL</p>' + record.steps.map(step => '<p>' + esc(step) + '</p>').join(''),
    [['Got it', () => { api.close(); after?.(); }]], 'FICTIONAL DIAGNOSTIC INSTRUMENT');
}
export function toolEquipped(id) {
  if (!String(id).startsWith(NS + ':')) return;
  const tutorial = content.list('tutorials').find(item => item.equipment === id);
  if (tutorial && !seen(tutorial.id) && !document.getElementById('dialog')?.open)
    showTutorial(tutorial.id);
}
export function intro() { if (!seen('pore-explorer:enter')) showTutorial('pore-explorer:enter'); }
export function enter(mode = CAMPAIGN) {
  api.selectMode(mode);
  api.close();
  intro();
  api.cue('PoreScope online. PoreScope panel below the pressure control.');
}
export function replayEncounter(mode, encounter, seed) { api.replayEncounter(mode, encounter, seed); api.close(); }
export function openPanel() {
  const profile = api.profile();
  const campaign = content.get('modes', CAMPAIGN);
  const slots = profile.slots || {};
  const current = slots[CAMPAIGN];
  const route = campaign.chapters.flatMap(id => content.get('chapters', id).encounters.map(encounterId => content.get('encounters', encounterId)));
  const reached = current ? route.findIndex(item => item.id === current.encounter) : -1;
  const cleared = index => index < reached || (index === reached && slots[CAMPAIGN].cleared.length === route[index].count);
  const rows = route.map((encounter, index) => {
    const boss = encounter.boss ? content.get('bosses', encounter.boss) : null;
    const status = cleared(index) ? 'CLEARED' : index === reached ? 'IN PROGRESS' : 'LOCKED';
    const replayable = index <= reached && index >= 0;
    return '<div class="file-row ' + (index === reached ? 'current' : '') + '"><span>' + String(index + 1).padStart(2, '0') + '</span><strong>' +
      esc(boss ? boss.name : encounter.name) + '</strong><small>' + status + '</small>' +
      (replayable ? '<button class="secondary deep-replay" data-encounter="' + esc(encounter.id) + '" data-seed="' + encounter.seed + '">Replay</button>' : '') + '</div>';
  }).join('');
  const earned = content.list('achievements').filter(item => item.id.startsWith(NS + ':'));
  const achievements = earned.map(item => '<p class="' + (profile.achievements.includes(item.id) ? 'achievement' : '') + '">' +
    (profile.achievements.includes(item.id) ? '✓ ' : '○ ') + esc(item.name) + ' · ' +
    Math.min(profile.stats[item.stat] || 0, item.threshold) + '/' + item.threshold + '</p>').join('');
  const start = current ? 'Resume the dive' : 'Start the dive';
  api.modal('The Pore Explorer',
    '<p class="tiny">EXPANSION 1 · THE SURFACE IS ONLY THE BEGINNING</p>' +
    '<p>Three chapters, twelve encounters and three buried bosses. Image the reservoir, find what is concealed, then extract it with instruments that each solve a different problem.</p>' +
    '<p class="deep-quote">' + esc(say('scan', 'panel', 'That one has a basement.')) + ' — Dani</p>' +
    rows +
    '<details><summary>Expansion achievements · ' + earned.filter(item => profile.achievements.includes(item.id)).length + '/' + earned.length + '</summary><div class="record-grid">' + achievements + '</div></details>' +
    '<p class="tiny">SEPARATE CHECKPOINTS · BASE CAMPAIGN UNTOUCHED · WORKS OFFLINE AFTER FIRST VISIT</p>',
    [[start, () => enter(CAMPAIGN)],
      ['Endless core sample', () => enter(ENDLESS), true],
      ['Zen imaging', () => enter(ZEN), true],
      ['Tutorials', () => { api.close(); showTutorial('pore-explorer:enter', openPanel); }, true],
      ['Stay on shift', api.close, true]], 'EXPANSION CAMPAIGN');
  for (const button of document.querySelectorAll('.deep-replay'))
    button.onclick = () => replayEncounter(CAMPAIGN, button.dataset.encounter, Number(button.dataset.seed));
}
export function report(visit) {
  if (!recordMode(visit?.mode?.id)) return null;
  const last = visit.mode.strategy === 'campaign' && visit.index === visit.route.length - 1;
  if (last) return {title: 'The underground is clear', flavor:
    'Three chapters beneath the surface. ' + say('complete', visit.encounter.id, 'Andi, I think yours are easier to deal with.') +
    ' Dani is officially off the deep clock.'};
  if (visit.boss) return {title: 'Boss reservoir cleared', flavor: say('boss', visit.encounter.id, 'The little ones never warn you about the basement.')};
  return {title: null, flavor: say('finish', visit.encounter.id, 'Every time I think we are finished, it opens another franchise.')};
}
export function summary(run, visit) {
  const target = api.field()[api.active()];
  if (!target?.deep) return '';
  const state = replay(target.deep.graph, progressOf(run, target));
  return state.found + '/' + target.deep.graph.nodes.length + ' chambers mapped · ' + target.deep.graph.pattern;
}
// After the service worker takes control, re-fetch this pack so the runtime offline cache fills even
// when the player opened the expansion during their very first visit. Bounded to one pass and to
// first-party URLs already in the catalog.
export async function primeOffline() {
  if (primeOffline.done || !navigator.onLine) return;
  primeOffline.done = true;
  // Resolve against this module, not the document: the pack lives beside this file.
  const urls = new Set(['./pack.json', './expansion.js', './porescope.js'].map(path => new URL(path, import.meta.url).href));
  for (const asset of content.list('assets'))
    if (String(asset.id).startsWith(NS + ':') && asset.url) urls.add(asset.url);
  await Promise.allSettled([...urls].map(url => fetch(url, {cache: 'reload'})));
}
export function reset() { view.mode = 'surface'; view.shown = 0; view.focus = null; view.scanning = false; view.flourish = null; graphs.clear(); sync(); }
