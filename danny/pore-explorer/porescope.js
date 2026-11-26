// PoreScope imaging: a fictional diagnostic overlay drawn over the existing macro field.
// This module owns only the imaging model and Canvas 2D painting. It never touches the skin
// shader, so WebGL2 and the shaded Canvas fallback present identical scope behavior.
// Everything here describes a game instrument. It is not medical imaging or medical advice.
export const VIEWS = ['surface', 'scan', 'cross'];
export const CELLS = 6;      // 6x6 coverage grid, two hex digits per cell (0-255) in the save
export const CELL_SIZE = 2;
const CELL_TEXT = CELLS * CELLS * CELL_SIZE;
const REVEAL = 40;            // coverage units needed before a cell counts as mapped
const TAU = Math.PI * 2;

export const emptyScan = () => ({c: '0'.repeat(CELL_TEXT), d: 0});
export const readCells = scan => {
  const text = String(scan.c || '').padEnd(CELL_TEXT, '0').slice(0, CELL_TEXT);
  return Uint8Array.from({length: CELLS * CELLS}, (_, index) => parseInt(text.substr(index * CELL_SIZE, CELL_SIZE), 16) || 0);
};
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// A normalized point in the field maps to one coverage cell.
export function cellIndex(x, y) {
  const cx = clamp(Math.floor(x * CELLS), 0, CELLS - 1), cy = clamp(Math.floor(y * CELLS), 0, CELLS - 1);
  return cy * CELLS + cx;
}
// The coverage grid is aligned to the reservoir footprint under the lesion, not the whole stage.
export const SPREAD = {x: 5, y: 4.5};
export function cellOf(node) {
  return cellIndex((node.x + 1) / 2, node.y);
}
export function beamCell(target, beam) {
  const nx = (beam.x - target.x) / (target.size * SPREAD.x);
  const ny = (beam.y - target.y) / (target.size * SPREAD.y);
  return cellIndex(clamp(nx * 0.5 + 0.5, 0, 0.999), clamp(ny, 0, 0.999));
}
export function coverage(scan, x, y) {
  return readCells(scan)[cellIndex(x, y)];
}
// Sweeping the beam fills the cell under it and, at lower weight, its neighbours.
export function addScan(scan, index, amount) {
  const cells = readCells(scan), before = cells[index];
  cells[index] = Math.min(255, cells[index] + Math.round(amount));
  const cx = index % CELLS, cy = Math.floor(index / CELLS);
  // Orthogonal neighbours receive a strong share and diagonal neighbours a weaker one, so a sweep
  // that passes close to a chamber still resolves it without revealing cells the beam never neared.
  for (const [dx, dy, weight] of [[1, 0, .5], [-1, 0, .5], [0, 1, .5], [0, -1, .5],
    [1, 1, .26], [1, -1, .26], [-1, 1, .26], [-1, -1, .26]]) {
    const nx = cx + dx, ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= CELLS || ny >= CELLS) continue;
    const at = ny * CELLS + nx;
    cells[at] = Math.min(255, cells[at] + Math.round(amount * weight));
  }
  scan.c = Array.from(cells, value => Math.min(255, value).toString(16).padStart(2, '0')).join('');
  return cells[index] > before;
}
export const scanGain = (scan, amount) => { scan.d = Math.min(48, Math.round((scan.d || 0) + amount)); };

// A concealed chamber becomes visible when its cell is swept enough and the depth gain has reached
// it, or when draining the chamber in front of it exposes it. No scan reveals the whole network at
// once: coverage is spatial and depth is earned by holding the instrument on the field.
export function discoveries(graph, scan, state) {
  const cells = readCells(scan);
  return graph.nodes.filter(node => {
    if (!node.hidden) return false;
    const live = state && state.nodes.find(item => item.key === node.key);
    if (live && live.revealed) return true;
    return cells[cellOf(node)] >= REVEAL && (scan.d || 0) >= Math.round(node.depth * 100);
  }).map(node => node.key);
}
// Concealed chambers the player actually located with the imaging beam. Exposure by drainage does
// not count here: the distinction drives the archaeology and mystery achievements.
export function mappedByImaging(graph, scan) {
  const cells = readCells(scan);
  return graph.nodes.filter(node => node.hidden && cells[cellOf(node)] >= REVEAL && (scan.d || 0) >= Math.round(node.depth * 100))
    .map(node => node.key);
}

// ---------------------------------------------------------------------------------------------
// Painting. All geometry is derived from the live reservoir state, so chamber depletion, flow
// direction, obstruction markers and depth all move with the simulation instead of a canned loop.
const depthColor = depth => {
  const t = clamp(depth / 0.46, 0, 1);
  return [Math.round(140 - 60 * t), Math.round(243 - 80 * t), Math.round(255 - 30 * t)];
};
const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';

function projected(view, node, w, h) {
  const {target} = view;
  return {x: (target.x + node.x * target.size * SPREAD.x) * w, y: (target.y + node.y * target.size * SPREAD.y) * h};
}

function scanLayer(ctx, view, w, h, alpha) {
  const {state, graph, scan, target, beam, time, reduced} = view;
  const cells = readCells(scan);
  ctx.save();
  ctx.globalAlpha = alpha;
  const wash = ctx.createLinearGradient(0, 0, 0, h);
  wash.addColorStop(0, 'rgba(8,32,36,.44)'); wash.addColorStop(.6, 'rgba(6,24,30,.56)');
  wash.addColorStop(1, 'rgba(3,14,20,.68)');
  ctx.fillStyle = wash; ctx.fillRect(0, 0, w, h);
  // Coverage lattice: aligned to the reservoir footprint under the lesion, so it reads as an
  // instrument window rather than a grid pasted over the whole photograph.
  const fx = (target.x - target.size * SPREAD.x) * w, fy = target.y * h;
  const fw = target.size * SPREAD.x * 2 * w, fh = target.size * SPREAD.y * h;
  const cw = fw / CELLS, ch = fh / CELLS;
  ctx.strokeStyle = 'rgba(150,245,255,.16)'; ctx.lineWidth = 1;
  for (let i = 0; i <= CELLS; i++) {
    ctx.beginPath(); ctx.moveTo(fx + i * cw, fy); ctx.lineTo(fx + i * cw, fy + fh); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fx, fy + i * ch); ctx.lineTo(fx + fw, fy + i * ch); ctx.stroke();
  }
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]) continue;
    ctx.fillStyle = 'rgba(140,240,255,' + (0.03 + cells[i] / 255 * 0.22) + ')';
    ctx.fillRect(fx + (i % CELLS) * cw, fy + Math.floor(i / CELLS) * ch, cw - 1, ch - 1);
  }
  // Corner brackets and a scale bar frame the imaging window.
  ctx.strokeStyle = 'rgba(206,255,246,.55)'; ctx.lineWidth = 1.4;
  const corner = Math.min(cw, ch) * 0.55;
  for (const [cx, cy, dx, dy] of [[fx, fy, 1, 1], [fx + fw, fy, -1, 1], [fx, fy + fh, 1, -1], [fx + fw, fy + fh, -1, -1]]) {
    ctx.beginPath(); ctx.moveTo(cx + dx * corner, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * corner); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(206,255,246,.65)'; ctx.font = '8px ui-monospace,monospace';
  ctx.fillText('SCOPE FIELD · ' + CELLS + '×' + CELLS, fx + 3, fy - 5);
  // Animated scan lines: the imaging sweep itself.
  const phase = reduced ? 0.35 : (time * 0.22) % 1;
  for (let i = 0; i < 3; i++) {
    const y = ((phase + i / 3) % 1) * h;
    const line = ctx.createLinearGradient(0, y - 22, 0, y + 22);
    line.addColorStop(0, 'rgba(150,255,240,0)'); line.addColorStop(.5, 'rgba(150,255,240,.16)');
    line.addColorStop(1, 'rgba(150,255,240,0)');
    ctx.fillStyle = line; ctx.fillRect(0, y - 22, w, 44);
    ctx.fillStyle = 'rgba(198,255,250,.5)'; ctx.fillRect(0, y, w, 1);
  }
  // Connections first, then chambers, so glow reads correctly.
  for (const edge of graph.edges) {
    const a = projected(view, graph.nodes.find(n => n.key === edge.a), w, h);
    const b = projected(view, graph.nodes.find(n => n.key === edge.b), w, h);
    const to = state.nodes.find(n => n.key === edge.b);
    const gate = graph.gates.find(g => g.a === edge.a && g.b === edge.b);
    const held = state.held && edge.b === state.held;
    if (!to.revealed) continue;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.setLineDash(gate && !gate.broken || held ? [4, 5] : []);
    ctx.lineWidth = Math.max(1, 1.4 + (1 - edge.resistance));
    ctx.strokeStyle = held || gate && !gate.broken ? 'rgba(255,179,92,.75)' : 'rgba(150,240,255,.3)';
    ctx.stroke(); ctx.setLineDash([]);
    if (to.remaining > 0) {
      const flow = reduced ? 0.5 : (time * 0.5 + edge.resistance) % 1;
      ctx.beginPath(); ctx.arc(a.x + (b.x - a.x) * flow, a.y + (b.y - a.y) * flow, 2.1, 0, TAU);
      ctx.fillStyle = 'rgba(215,255,250,.8)'; ctx.fill();
    }
  }
  for (const node of graph.nodes) {
    const live = state.nodes.find(item => item.key === node.key);
    const p = projected(view, node, w, h);
    const r = Math.max(5, (7 + node.volume * 4) * Math.min(w, h) / 320);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU);
    if (!live.revealed) {
      // Only a faint ghost where coverage exists: the instrument hints, it does not solve.
      if (cells[cellOf(node)] >= REVEAL * 0.3) {
        ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(170,235,255,.20)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
      }
      continue;
    }
    const tone = depthColor(node.depth);
    const tint = view.tints && view.tints[node.material];
    const grad = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, r * 1.5);
    grad.addColorStop(0, rgba(tone, .5)); grad.addColorStop(.55, tint ? tint + '55' : rgba(tone, .22)); grad.addColorStop(1, rgba(tone, 0));
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.strokeStyle = live.empty ? 'rgba(150,255,200,.5)' : rgba(tone, .95); ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = rgba(tone, .12 + 0.4 * (live.remaining / Math.max(0.01, node.volume))); ctx.fill();
    // Remaining-volume arc: the chamber visibly depletes as the reservoir drains.
    if (!live.empty) {
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 3.5, -Math.PI / 2,
        -Math.PI / 2 + TAU * (live.remaining / Math.max(0.01, node.volume)));
      ctx.strokeStyle = 'rgba(206,250,128,.85)'; ctx.lineWidth = 1.6; ctx.stroke();
    }
    ctx.fillStyle = rgba(tone, .75); ctx.font = '8px ui-monospace,monospace';
    ctx.fillText((node.depth * 10).toFixed(1), p.x - r, p.y + r + 9);
    if (node.hidden) { ctx.fillStyle = 'rgba(230,190,255,.85)'; ctx.font = '9px ui-monospace,monospace'; ctx.fillText('◆', p.x - 3, p.y - r - 4); }
    if (node.hub) { ctx.strokeStyle = 'rgba(200,255,180,.8)'; ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, TAU); ctx.stroke(); }
    if (view.focus === node.key) {
      ctx.strokeStyle = '#cefa80'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, r + 7, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(9,20,18,.85)'; ctx.fillRect(p.x + r + 9, p.y - 10, 96, 22);
      ctx.fillStyle = '#cefa80'; ctx.font = '9px ui-monospace,monospace';
      ctx.fillText((live.material || '').split(':').pop().slice(0, 12), p.x + r + 14, p.y + 3);
    }
  }
  ctx.restore();
}

function crossLayer(ctx, view, w, h, alpha) {
  const {state, graph, target, time, reduced} = view;
  const cut = h * 0.2;
  ctx.save(); ctx.globalAlpha = alpha;
  // Anatomical bands. Fictional layers for a fictional instrument.
  const layers = [
    {y: cut, height: h * 0.07, color: 'rgba(206,158,132,.9)', label: 'EPIDERMIS'},
    {y: cut + h * 0.07, height: h * 0.24, color: 'rgba(176,112,96,.72)', label: 'DERMIS'},
    {y: cut + h * 0.31, height: h * 0.49, color: 'rgba(122,74,66,.62)', label: 'SUBCUTIS'}
  ];
  ctx.fillStyle = 'rgba(6,12,14,.66)'; ctx.fillRect(0, 0, w, h);
  for (const band of layers) {
    ctx.fillStyle = band.color; ctx.fillRect(0, band.y, w, band.height);
    // Membrane highlight: a bright boundary reads as a tissue plane rather than a flat band.
    ctx.strokeStyle = 'rgba(255,240,220,.28)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, band.y); ctx.lineTo(w, band.y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,244,228,.55)'; ctx.font = '8px ui-monospace,monospace';
    ctx.fillText(band.label, 8, band.y + 11);
  }
  // Procedural tissue texture: collagen striations in the dermis, fat lobules in the subcutis.
  const seed = graph.seed || 1;
  ctx.strokeStyle = 'rgba(255,226,200,.075)'; ctx.lineWidth = 1;
  for (let i = 0; i < 30; i++) {
    const y = layers[1].y + (i / 30) * layers[1].height + Math.sin(i * 2.4 + seed) * 2;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 18) ctx.lineTo(x, y + Math.sin(x / 46 + i) * 2.4);
    ctx.stroke();
  }
  for (let i = 0; i < 34; i++) {
    const x = ((i * 137 + seed % 89) % 100) / 100 * w;
    const y = layers[2].y + 12 + ((i * 61 + seed % 53) % 100) / 100 * (layers[2].height - 24);
    ctx.beginPath(); ctx.ellipse(x, y, 7 + (i % 4) * 3, 4 + (i % 3) * 2, i, 0, TAU);
    ctx.fillStyle = 'rgba(255,214,180,.07)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,226,196,.08)'; ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,244,228,.4)'; ctx.font = '8px ui-monospace,monospace';
  ctx.fillText('SURFACE', w - 62, 12);
  // Depth ruler in fictional millimetres.
  ctx.strokeStyle = 'rgba(200,255,240,.35)'; ctx.fillStyle = 'rgba(210,255,245,.7)';
  ctx.font = '8px ui-monospace,monospace';
  for (let mm = 0; mm <= 8; mm += 2) {
    const y = cut + (mm / 8) * (h * 0.68);
    ctx.beginPath(); ctx.moveTo(w - 20, y); ctx.lineTo(w - 8, y); ctx.stroke();
    ctx.fillText(mm + 'mm', w - 46, y + 3);
  }
  const place = node => ({
    x: (target.x + node.x * target.size * SPREAD.x) * w,
    y: cut + h * 0.06 + node.depth * h * 1.02
  });
  for (const edge of graph.edges) {
    const a = place(graph.nodes.find(n => n.key === edge.a)), b = place(graph.nodes.find(n => n.key === edge.b));
    const to = state.nodes.find(n => n.key === edge.b);
    if (!to.revealed) continue;
    const gate = graph.gates.find(g => g.a === edge.a && g.b === edge.b);
    const held = state.held && edge.b === state.held;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.lineWidth = 5 - edge.resistance * 2.4; ctx.strokeStyle = 'rgba(92,60,50,.85)'; ctx.stroke();
    ctx.lineWidth = 2.2 - edge.resistance; ctx.strokeStyle = held || gate && !gate.broken ? 'rgba(255,170,90,.9)' : 'rgba(255,214,178,.35)'; ctx.stroke();
    if (to.remaining > 0) {
      const flow = reduced ? 0.4 : (time * 0.55 + edge.resistance) % 1;
      ctx.beginPath(); ctx.arc(a.x + (b.x - a.x) * flow, a.y + (b.y - a.y) * flow, 2.4, 0, TAU);
      ctx.fillStyle = 'rgba(255,236,206,.8)'; ctx.fill();
    }
  }
  for (const node of graph.nodes) {
    const live = state.nodes.find(item => item.key === node.key);
    if (!live.revealed) continue;
    const p = place(node);
    const rx = Math.max(6, (8 + node.volume * 5) * Math.min(w, h) / 300), ry = rx * 0.72;
    const fill = Math.max(0, live.remaining / Math.max(0.01, node.volume));
    const tint = (view.tints && view.tints[node.material]) || '#e9cdaa';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, TAU);
    ctx.fillStyle = live.empty ? 'rgba(58,36,32,.5)' : 'rgba(233,205,170,.32)'; ctx.fill();
    if (!live.empty) {
      ctx.save(); ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, TAU); ctx.clip();
      // The remaining volume sits in the lower half like a fluid level, tinted by its material.
      ctx.fillStyle = tint; ctx.globalAlpha = .62;
      ctx.fillRect(p.x - rx, p.y + ry - ry * 2 * fill, rx * 2, ry * 2 * fill);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, TAU);
    ctx.strokeStyle = view.focus === node.key ? '#cefa80' : 'rgba(255,232,200,.75)';
    ctx.lineWidth = view.focus === node.key ? 2 : 1.1; ctx.stroke();
    if (node.hidden) { ctx.fillStyle = 'rgba(232,190,255,.9)'; ctx.font = '9px ui-monospace,monospace'; ctx.fillText('◆', p.x + rx + 2, p.y); }
  }
  ctx.restore();
}

function beamLayer(ctx, view, w, h, alpha) {
  const {beam, scanning, target} = view;
  const x = beam.x * w, y = beam.y * h;
  ctx.save(); ctx.globalAlpha = alpha;
  const glow = ctx.createRadialGradient(x, y, 2, x, y, Math.max(34, target.size * w * 1.6));
  glow.addColorStop(0, scanning ? 'rgba(206,255,240,.22)' : 'rgba(180,240,255,.12)');
  glow.addColorStop(.55, 'rgba(120,230,255,.06)'); glow.addColorStop(1, 'rgba(90,200,255,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, Math.max(34, target.size * w * 1.6), 0, TAU); ctx.fill();
  ctx.strokeStyle = scanning ? 'rgba(214,255,246,.9)' : 'rgba(190,240,255,.5)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, 13, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 20, y); ctx.lineTo(x - 6, y); ctx.moveTo(x + 6, y); ctx.lineTo(x + 20, y);
  ctx.moveTo(x, y - 20); ctx.lineTo(x, y - 6); ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 20); ctx.stroke();
  ctx.restore();
}

export function draw(ctx, view, w, h) {
  if (!view || !view.graph || w < 2 || h < 2) return;
  const shown = view.shown;
  const scanAlpha = Math.max(0, 1 - Math.abs(shown - 1));
  const crossAlpha = Math.max(0, 1 - Math.abs(shown - 2));
  if (scanAlpha > 0.02) scanLayer(ctx, view, w, h, scanAlpha);
  if (crossAlpha > 0.02) crossLayer(ctx, view, w, h, crossAlpha);
  // The beam and reticle only belong to the scan view.
  if (scanAlpha > 0.05) beamLayer(ctx, view, w, h, scanAlpha);
  if (shown < 0.06) return;
  // Boss flourish: a short, unmistakable completion ring.
  if (view.flourish) {
    const t = view.flourish.t;
    ctx.save(); ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = '#cefa80'; ctx.lineWidth = 3 * (1 - t) + 1;
    ctx.beginPath(); ctx.arc(view.target.x * w, view.target.y * h, 24 + t * Math.max(w, h) * 0.5, 0, TAU); ctx.stroke();
    ctx.restore();
  }
}
