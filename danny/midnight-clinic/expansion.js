// Dani the Pimple Popper 1.3 — The Midnight Clinic.
// A first-party pack layered on the shared deep-extraction engine in pore-explorer/expansion.js.
// The clinic owns presentation, patient intake, supernatural records, ambience, visual intensity,
// procedural Endless variants and the hidden referral. Simulation stays in the shared engine.
import {content} from '../content.js';
import * as deep from '../pore-explorer/expansion.js';

const NS = 'midnight-clinic';
const CLASSES = ['vampire', 'werewolf', 'zombie', 'swamp', 'reptilian', 'alien', 'troll', 'ghost', 'fungoid', 'lovecraftian'];
const RESTRICTIONS = [null, null, null, 'silver', 'spectral', 'cryo', 'arcane'];
const esc = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const hash = text => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; };
let api = null, mounted = false, panel = null;

export function attach(context) {
  api = context;
  deep.attach({...context, packs: ['pore-explorer', NS]});
}
export const namespace = NS;
export const modeNamespace = () => NS;
export function active() { return String(api?.visit()?.mode?.id || '').startsWith(NS + ':'); }
export const decorate = (...args) => deep.decorate(...args);
export const flow = (...args) => deep.flow(...args);
export const overlay = (...args) => deep.overlay(...args);
export const setMode = (...args) => deep.setMode(...args);
export const startScan = (...args) => deep.startScan(...args);
export const stopScan = (...args) => deep.stopScan(...args);
export const aim = (...args) => deep.aim(...args);
export const nudge = (...args) => deep.nudge(...args);
export const pickNode = (...args) => deep.pickNode(...args);
export const progressOf = (...args) => deep.progressOf(...args);
export const toolEquipped = id => deep.toolEquipped(id);
export const report = visit => deep.report(visit);
export const reset = () => { deep.reset(); update(); };
export const overlayContext = () => deep.overlayContext();
export function primeOffline() {
  if (primeOffline.done || !navigator.onLine) return;
  primeOffline.done = true;
  const urls = new Set(['./pack.json', './expansion.js'].map(path => new URL(path, import.meta.url).href));
  for (const asset of content.list('assets')) if (String(asset.id).startsWith(NS + ':') && asset.url) urls.add(asset.url);
  return Promise.allSettled([...urls].map(url => fetch(url, {cache: 'reload'})));
}

// ---------------------------------------------------------------------------------------------
// Patient records, intake paperwork and the class book. Everything is content-driven.
const patientOf = visit => (visit?.encounter?.patient ? content.get('patients', visit.encounter.patient) : null);
function intakeOf(patient) {
  if (!patient) return null;
  const list = content.list('intake');
  return list.find(entry => entry.patient === patient.name) || list[hash(patient.id) % Math.max(1, list.length)] || null;
}
export function patientSummary() {
  // Contract for a future appointment-management layer (Dani's Disgusting Day Spa). Intentionally
  // read-only: this release does not model clinic finances, scheduling, staffing or reputation.
  const visit = api?.visit();
  if (!visit) return null;
  const patient = patientOf(visit);
  const state = deep.overlayContext();
  const total = state ? state.graph.totalVolume : 0;
  return {
    patientClass: patient ? patient.klass : 'base',
    appointmentComplexity: state ? +(total / Math.max(1, state.graph.nodes.length)).toFixed(2) : 0,
    equipment: content.list('equipment').filter(item => !item.scope || (Array.isArray(item.scope) ? item.scope.includes(NS) : item.scope === NS)).map(item => item.id),
    estimatedReleases: state ? state.state.nodes.filter(node => node.remaining > 0).length : 0,
    completionQuality: visit.run ? visit.run.points : 0,
    satisfactionInputs: {cleanReleases: visit.run?.streak || 0, mappedChambers: state ? state.state.found : 0},
    materialStatistics: state ? state.graph.materials : [],
    environmentalRequirements: patient?.condition ? [patient.condition] : []
  };
}
export function recordsHTML() {
  if (!api) return '';
  const profile = api.profile();
  const rows = content.list('records').filter(record => String(record.id).startsWith(NS + ':')).map(record => {
    const value = profile.stats[record.stat] || 0;
    return '<p class="' + (value > 0 ? 'achievement' : '') + '">' + esc(record.name) + ' · ' + value + '</p>';
  }).join('');
  return '<div class="record-grid">' + rows + '</div>';
}
function classBookHTML() {
  const profile = api.profile();
  const seen = new Set(profile.discovered || []);
  return CLASSES.map(klass => '<p class="' + (seen.has(klass) ? 'achievement' : '') + '">' +
    (seen.has(klass) ? '✓ ' : '○ ') + esc(klass[0].toUpperCase() + klass.slice(1)) + '</p>').join('');
}
function intakeHTML(visit) {
  const patient = patientOf(visit);
  if (!patient) return '';
  const intake = intakeOf(patient);
  return '<div class="clinic-intake"><p class="tiny">PATIENT INTAKE</p>' +
    '<p><strong>' + esc(patient.name) + '</strong> · ' + esc(patient.klass) + '</p>' +
    (intake ? '<p class="tiny">COMPLAINT</p><p>' + esc(intake.complaint) + '</p>' +
      '<p class="tiny">DURATION</p><p>' + esc(intake.duration) + '</p>' +
      '<p class="tiny">NOTES</p><p>' + esc(intake.notes) + '</p>' : '<p>' + esc(patient.intake) + '</p>') + '</div>';
}

// ---------------------------------------------------------------------------------------------
// Procedural Endless variants. A variant is a deterministic label, restriction and intake note
// derived from the slot seed; the appointment itself is chosen from the authored pool by the engine.
const VARIANTS = ['Albino werewolf', 'Elder vampire', 'Bioluminescent swamp creature', 'Crystalline extraterrestrial',
  'Ancient troll', 'Poltergeist', 'Moon-struck reptilian', 'Hybrid supernatural entity'];
const RARE_NOTES = ['Patient arrived before the building did.', 'Patient brought their own lighting.',
  'Patient is technically a rumour.', 'Patient requested the appointment be recorded in runes.',
  'Patient has been dead longer than the clinic has been open.', 'Patient shook hands with the receptionist and the receptionist is fine. Mostly.'];
export function variantFor(seed, modeId) {
  if (!modeId || modeId.endsWith(':campaign') || modeId.endsWith(':referral')) return null;
  const r = hash(modeId + ':' + seed);
  return {label: VARIANTS[r % VARIANTS.length], restriction: RESTRICTIONS[(r >>> 5) % RESTRICTIONS.length],
    note: RARE_NOTES[(r >>> 9) % RARE_NOTES.length], rare: (r % 9) === 0};
}
export function toolLocked(id) {
  const variant = api?.run()?.variant;
  if (!variant || !variant.restriction) return false;
  try { return content.get('equipment', id).technique === variant.restriction; } catch { return false; }
}
export function variantNote() {
  const variant = api?.run()?.variant;
  return variant ? variant.label + (variant.restriction ? ' · ' + variant.restriction + ' restricted' : '') : '';
}

// ---------------------------------------------------------------------------------------------
// Clinic panel: the campaign, intake paperwork, class book, supernatural records and the referral.
function referralUnlocked(profile) {
  return (profile.discovered || []).length >= 6 || profile.achievements.includes(NS + ':ach-nocturnal-professional');
}
export function openPanel() {
  const profile = api.profile();
  const mode = content.get('modes', NS + ':campaign');
  const slot = profile.slots?.[NS + ':campaign'];
  const rows = deep.campaignRowsHTML(NS + ':campaign', profile);
  const achievements = deep.achievementRowsHTML(NS);
  const unlocked = referralUnlocked(profile);
  const start = slot ? 'Resume the shift' : 'Open the clinic';
  const actions = [[start, () => enter(NS + ':campaign')],
    ['Midnight Endless', () => enter(NS + ':endless'), true],
    ['Midnight Zen', () => enter(NS + ':zen'), true]];
  if (unlocked) actions.push(["The Ratfather's Referral", () => enter(NS + ':referral'), true]);
  actions.push(['Tutorials', () => { api.close(); deep.intro(); }, true], ['Close the clinic', api.close, true]);
  api.modal('The Midnight Clinic',
    '<p class="tiny">' + esc(mode.panelLabel) + '</p>' +
    '<p>' + esc(mode.blurb) + '</p>' +
    '<p class="deep-quote">' + esc(mode.tagline) + '</p>' +
    rows +
    '<details><summary>Intake paperwork</summary>' + intakeHTML(api.visit()) + '</details>' +
    '<details><summary>Class book · ' + (profile.discovered || []).length + '/' + CLASSES.length + '</summary><div class="record-grid">' + classBookHTML() + '</div></details>' +
    '<details><summary>Supernatural records</summary>' + recordsHTML() + '<p class="tiny">Supernatural classifications are separate from base records. A future World Book of Pores can adopt them without touching this pack.</p></details>' +
    '<details><summary>Achievements · ' + achievements.earned + '/' + achievements.total + '</summary><div class="record-grid">' + achievements.rows + '</div></details>' +
    (profile.observer ? '<p class="tiny">AN ALLEY CAT COUNCIL OBSERVER IS PRESENT. IT IS JUDGING.</p>' : '') +
    '<p class="tiny">SEPARATE CHECKPOINTS · BASE CAMPAIGN UNTOUCHED · WORKS OFFLINE AFTER FIRST VISIT</p>',
    actions, 'EXPANSION 3 · AFTER HOURS');
}
export function enter(mode) {
  api.selectMode(mode);
  api.close();
  const run = api.run();
  if (run) run.variant = variantFor(run.seed, mode);
  deep.intro();
  api.cue('The clinic is open. ' + (variantNote() || 'Every patient is a reservoir network.') );
  startAmbience();
  api.save?.();
}
export function sync() {
  deep.sync();
  update();
  if (!active()) stopAmbience();
  else if (api.profile().settings.ambience > 0) startAmbience();
  applyIntensity();
}
function applyIntensity() {
  const level = api?.profile()?.settings?.intensity || 'midnight';
  document.body.dataset.intensity = level;
  document.body.classList.toggle('clinic', active());
  document.body.classList.toggle('hud-quiet', !!api?.profile()?.settings?.quietHud);
}
export function mount() {
  deep.mount();
  if (mounted) return;
  mounted = true;
  const host = document.querySelector('.console');
  if (!host) return;
  panel = document.createElement('section');
  panel.className = 'clinic-panel'; panel.id = 'clinicPanel';
  panel.innerHTML = '<div class="panel-head"><h2><svg aria-hidden="true"><use href="#files"/></svg>Midnight Clinic</h2><span class="tiny" id="clinicVariant">AFTER HOURS</span></div>' +
    '<div class="clinic-body"><p class="tiny" id="clinicLine">The clinic opens at midnight.</p>' +
    '<div class="clinic-row"><label>Visual intensity <select id="clinicIntensity">' +
      ['spooky', 'midnight', 'eldritch'].map(level => '<option value="' + level + '">' + level[0].toUpperCase() + level.slice(1) + '</option>').join('') +
    '</select></label></div>' +
    '<div class="clinic-row"><label>Ambience <input id="clinicAmbience" type="range" min="0" max="100" step="5"></label>' +
      '<label class="clinic-check">Music <input id="clinicMusic" type="checkbox"></label></div>' +
    '<div class="clinic-row"><label class="clinic-check">Quiet HUD <input id="clinicQuiet" type="checkbox"></label>' +
      '<button id="clinicRecords" class="secondary">Records</button></div>' +
    '<p class="clinic-note">Fictional instruments only. No clinical guidance.</p></div>';
  host.append(panel);
  panel.querySelector('#clinicIntensity').onchange = e => setIntensity(e.target.value);
  panel.querySelector('#clinicAmbience').oninput = e => setAmbience(e.target.value / 100);
  panel.querySelector('#clinicMusic').onchange = e => setMusic(e.target.checked);
  panel.querySelector('#clinicQuiet').onchange = e => setQuiet(e.target.checked);
  panel.querySelector('#clinicRecords').onclick = () => api.modal('Supernatural records', recordsHTML(), [['Close', api.close]], 'THE MIDNIGHT CLINIC');
  update();
}
function update() {
  if (!panel) return;
  // A variant is derived from the shift seed, so a reload reconstructs it instead of storing it.
  const run = api?.run();
  if (run && active() && !run.variant) run.variant = variantFor(run.seed, api.profile().mode);
  const settings = api?.profile()?.settings || {};
  panel.hidden = !active();
  panel.querySelector('#clinicVariant').textContent = variantNote() || 'AFTER HOURS';
  panel.querySelector('#clinicIntensity').value = settings.intensity || 'midnight';
  panel.querySelector('#clinicAmbience').value = Math.round((settings.ambience ?? .35) * 100);
  panel.querySelector('#clinicMusic').checked = !!settings.music;
  panel.querySelector('#clinicQuiet').checked = !!settings.quietHud;
  const visit = api?.visit();
  const patient = patientOf(visit);
  panel.querySelector('#clinicLine').textContent = patient
    ? patient.name + ' · ' + patient.klass + ' · ' + (visit.encounter.name || '')
    : 'The clinic opens at midnight.';
  document.body.classList.toggle('clinic', active());
}

// ---------------------------------------------------------------------------------------------
// Atmosphere controls. Ambience has its own gain path, so extraction audio keeps its own volume.
export function setIntensity(level) {
  const settings = api.profile().settings;
  settings.intensity = ['spooky', 'midnight', 'eldritch'].includes(level) ? level : 'midnight';
  api.save(); applyIntensity();
}
export function setAmbience(level) {
  const settings = api.profile().settings;
  settings.ambience = Math.max(0, Math.min(1, level));
  api.save();
  if (settings.ambience > 0) api.audio.startAmbience(settings.ambience);
  else api.audio.stopAmbience();
}
export function setMusic(on) {
  api.profile().settings.music = !!on;
  api.save(); api.audio.setMusic(!!on);
}
export function setQuiet(on) {
  api.profile().settings.quietHud = !!on;
  api.save(); applyIntensity();
}
function startAmbience() {
  const settings = api?.profile()?.settings;
  if (!settings) return;
  if (settings.ambience > 0) api.audio.startAmbience(settings.ambience);
  api.audio.setMusic(!!settings.music);
}
function stopAmbience() { api?.audio?.stopAmbience(); }
export function settingsHTML() {
  const settings = api.profile().settings;
  return '<h3>Midnight Clinic</h3><div class="prefs">' +
    '<label>Visual intensity <select id="clinicSetIntensity">' +
      ['spooky', 'midnight', 'eldritch'].map(level => '<option value="' + level + '"' + ((settings.intensity || 'midnight') === level ? ' selected' : '') + '>' + level[0].toUpperCase() + level.slice(1) + '</option>').join('') +
    '</select></label>' +
    '<label>Ambience <input id="clinicSetAmbience" type="range" min="0" max="100" step="5" value="' + Math.round((settings.ambience ?? .35) * 100) + '"><output id="clinicAmbLabel">' + Math.round((settings.ambience ?? .35) * 100) + '%</output></label>' +
    '<label>Clinic music <input id="clinicSetMusic" type="checkbox"' + (settings.music ? ' checked' : '') + '></label>' +
    '<label>Quiet HUD <input id="clinicSetQuiet" type="checkbox"' + (settings.quietHud ? ' checked' : '') + '></label></div>';
}
export function bindSettings(root = document) {
  const intensity = root.getElementById('clinicSetIntensity');
  if (intensity) intensity.onchange = () => setIntensity(intensity.value);
  const ambience = root.getElementById('clinicSetAmbience');
  if (ambience) {
    ambience.oninput = () => { root.getElementById('clinicAmbLabel').textContent = ambience.value + '%'; };
    ambience.onchange = () => setAmbience(ambience.value / 100);
  }
  const music = root.getElementById('clinicSetMusic');
  if (music) music.onchange = () => setMusic(music.checked);
  const quiet = root.getElementById('clinicSetQuiet');
  if (quiet) quiet.onchange = () => setQuiet(quiet.checked);
}
export function recordsForFiles() {
  if (!content.versions()[NS]) return '';
  return '<details><summary>Midnight Clinic records</summary>' + recordsHTML() +
    '<h3>Patient class book</h3><div class="record-grid">' + classBookHTML() + '</div></details>';
}
export { deep };
