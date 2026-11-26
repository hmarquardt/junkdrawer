// Engine 1.1 subsurface reservoir primitive for Dani the Pimple Popper: The Pore Explorer.
// A reservoir is a graph, never a scripted list of timed passes. Every observable value is a pure
// function of (template, seed, committed progress), so a checkpoint regenerates the exact same
// chambers, depths, gates, materials and drainage history. The base campaign never imports this.
// The generator is duplicated rather than imported so this primitive stays free of content or DOM
// dependencies and the verification suite can exercise it on its own.
export function random(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let n = Math.imul(seed ^ seed >>> 15, 1 | seed);
    n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

export const DRAW = 1;          // volume unit pulled by one successful release
const MAX_NODES = 14;           // hard bound: replay and rendering stay trivial on mobile
const EPSILON = 1e-4;

const hashId = id => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
};

// One geometry per pattern. Patterns are topology families, not authored chamber sequences:
// chamber count, depth, volumes and materials vary with the seed inside the family.
function layout(pattern, count, r) {
  const nodes = [], edges = [];
  const at = (i, x, y, depth, extra) => ({key: 'n' + i, i, x, y, depth, ...extra});
  const chain = (from, list, base) => {
    let previous = from;
    for (const node of list) {
      edges.push({a: previous, b: node.key, resistance: base + r() * 0.35});
      previous = node.key;
    }
  };
  if (pattern === 'ribbon') {
    nodes.push(at(0, 0, 0, 0.045, {volume: 0.4}));
    for (let i = 1; i < count; i++) {
      const t = i / (count - 1);
      nodes.push(at(i, Math.sin(t * Math.PI * 2.4) * 0.34, 0.08 + t * 0.86, 0.06 + t * 0.3,
        {volume: 0.75 + r() * 0.5, ribbon: true}));
    }
    chain('n0', nodes.slice(1), 0.32);
    return {nodes, edges, pattern};
  }
  if (pattern === 'strata') {
    const rows = Math.max(2, Math.min(3, Math.ceil((count - 1) / 3)));
    const per = Math.ceil((count - 1) / rows);
    nodes.push(at(0, 0, 0, 0.04, {volume: 0.45}));
    const rowNodes = [];
    let next = 1;
    for (let row = 0; row < rows; row++) {
      const list = [];
      for (let c = 0; c < per; c++) {
        if (next >= count) break;
        const i = next++;
        const x = (c - (per - 1) / 2) * (0.72 / Math.max(1, per - 1));
        list.push(at(i, x + (r() - 0.5) * 0.16, 0.12 + row * 0.3 + r() * 0.06, 0.07 + row * 0.11,
          {volume: 0.7 + r() * 0.9}));
      }
      rowNodes.push(list);
      nodes.push(...list);
    }
    for (const node of rowNodes[0]) edges.push({a: 'n0', b: node.key, resistance: 0.3 + r() * 0.25});
    for (let row = 1; row < rowNodes.length; row++) {
      const above = rowNodes[row - 1], here = rowNodes[row];
      for (let c = 0; c < here.length; c++) {
        const source = above[Math.min(c, above.length - 1)];
        edges.push({a: source.key, b: here[c].key, resistance: 0.42 + r() * 0.3});
        if (c + 1 < here.length && r() > 0.45)
          edges.push({a: here[c].key, b: here[c + 1].key, resistance: 0.8 + r() * 0.15});
      }
    }
    return {nodes, edges, pattern};
  }
  if (pattern === 'chain' || pattern === 'braid') {
    const hubs = pattern === 'braid' ? 2 : 1;
    nodes.push(at(0, 0, 0, 0.04, {volume: 0.4}));
    for (let h = 0; h < hubs; h++) {
      nodes.push(at(nodes.length, (h - (hubs - 1) / 2) * 0.42, 0.26, 0.13,
        {volume: 0.6 + r() * 0.5, hub: true}));
      edges.push({a: 'n0', b: nodes.at(-1).key, resistance: 0.28 + r() * 0.2});
      if (h > 0) edges.push({a: nodes[1].key, b: nodes.at(-1).key, resistance: 0.66 + r() * 0.2});
    }
    const spokes = Math.max(2, count - 1 - hubs);
    for (let s = 0; s < spokes; s++) {
      const hub = nodes[1 + (s % hubs)];
      const angle = Math.PI * (0.12 + 0.76 * (s + 1) / (spokes + 1));
      nodes.push(at(nodes.length, Math.cos(angle) * 0.78, 0.34 + Math.sin(angle) * 0.52,
        0.18 + r() * 0.18, {volume: 0.7 + r() * 1.1}));
      edges.push({a: hub.key, b: nodes.at(-1).key, resistance: 0.4 + r() * 0.3});
      if (pattern === 'braid' && hubs > 1 && r() > 0.5) {
        const otherHub = nodes[1 + ((s + 1) % hubs)];
        if (otherHub.key !== hub.key)
          edges.push({a: otherHub.key, b: nodes.at(-1).key, resistance: 0.75 + r() * 0.2});
      }
    }
    return {nodes, edges, pattern};
  }
  if (pattern === 'migrate') {
    nodes.push(at(0, 0, 0, 0.04, {volume: 0.45}));
    for (let i = 1; i < count; i++) {
      const t = i / (count - 1);
      nodes.push(at(i, Math.sin(t * Math.PI * 1.6) * 0.42, 0.1 + t * 0.8, 0.06 + t * 0.26,
        {volume: 0.8 + r() * 0.8}));
    }
    chain('n0', nodes.slice(1), 0.36);
    return {nodes, edges, pattern, migrate: true};
  }
  // fork (default): two arms feed a common outlet.
  nodes.push(at(0, 0, 0, 0.04, {volume: 0.5}));
  const remaining = count - 1, left = Math.ceil(remaining / 2), right = remaining - left;
  for (const [side, total] of [[-1, left], [1, right]]) {
    let previous = 'n0';
    for (let i = 0; i < total; i++) {
      const t = (i + 1) / Math.max(1, total);
      nodes.push(at(nodes.length, side * (0.2 + t * 0.55), 0.16 + t * 0.62, 0.08 + t * 0.2,
        {volume: 0.7 + r() * 0.9, arm: side}));
      edges.push({a: previous, b: nodes.at(-1).key, resistance: 0.34 + r() * 0.3});
      previous = nodes.at(-1).key;
    }
  }
  return {nodes, edges, pattern};
}

export function build(template, seed) {
  const r = random((seed ^ hashId(template.id)) >>> 0);
  const [min, max] = Array.isArray(template.chambers) ? template.chambers : [3, 5];
  const count = Math.max(2, Math.min(MAX_NODES, Math.round(min + r() * (Math.max(min, max) - min))));
  const shape = layout(template.pattern, count, r);
  const materials = template.materials && template.materials.length ? template.materials : ['base:cream'];
  const scale = template.scale || 1;
  for (const node of shape.nodes) {
    node.volume = Math.round(node.volume * scale * 100) / 100;
    node.material = materials[Math.floor(r() * materials.length)];
    node.depth = Math.round(Math.min(0.46, node.depth) * 100) / 100;
    node.hidden = false;
  }
  // Concealed compartments: the deepest chambers, chosen deterministically from the seed.
  const hidden = Math.max(0, Math.min(shape.nodes.length - 1, template.hidden || 0));
  const deep = shape.nodes.filter(node => node.i > 0).sort((a, b) => b.depth - a.depth || a.i - b.i);
  for (let i = 0; i < hidden; i++) deep[i].hidden = true;
  // Gates are resistance points with an activation condition, not a sequence of passes. A gate is
  // placed on an articulation edge wherever one exists, so a valve actually severs a subtree instead
  // of being trivially bypassed by a cycle.
  const gates = [];
  const reaches = (target, skip) => {
    const seen = new Set(['n0']), queue = ['n0'];
    while (queue.length) {
      const key = queue.shift();
      for (const edge of shape.edges) {
        if (edge === skip || edge.a !== key || seen.has(edge.b)) continue;
        seen.add(edge.b); queue.push(edge.b);
      }
    }
    return seen.has(target);
  };
  const cut = [...shape.edges]
    .filter(edge => edge.b !== 'n0' && !reaches(edge.b, edge))
    .sort((a, b) => (a.a === 'n0' ? 0 : 1) - (b.a === 'n0' ? 0 : 1) || a.b.localeCompare(b.b));
  const ordered = [...shape.edges].sort((a, b) => (a.a === 'n0' ? 0 : 1) - (b.a === 'n0' ? 0 : 1) || a.b.localeCompare(b.b));
  if (template.obstruction && template.obstruction !== 'none') {
    if (template.obstruction === 'migrate') shape.migrating = (cut.length ? cut : ordered).map(edge => edge.b);
    else {
      const pool = cut.length ? cut : ordered;
      const pick = template.obstruction === 'valve' ? pool.at(-1) : pool[0];
      if (pick) { pick.gate = template.obstruction; gates.push(pick); }
    }
  }
  // Supernatural primitives. Every one is derived from the seed or the pass index at replay time, so
  // a checkpoint needs no extra state. Templates without these fields produce exactly the 1.1 graph.
  const dormantKeys = [];
  const dormantCount = Math.max(0, Math.min(4, template.dormant || 0));
  if (dormantCount) {
    const leaves = shape.nodes.filter(node => node.i > 0 && !shape.edges.some(edge => edge.a === node.key))
      .sort((a, b) => b.depth - a.depth || a.i - b.i);
    for (let i = 0; i < dormantCount && i < leaves.length; i++) {
      leaves[i].dormant = true;
      dormantKeys.push(leaves[i].key);
    }
  }
  const phaseNodes = Math.max(0, Math.min(6, template.phaseNodes || 0));
  if (template.phase) {
    const list = shape.nodes.filter(node => node.i > 0).sort((a, b) => b.depth - a.depth || a.i - b.i);
    for (let i = 0; i < phaseNodes && i < list.length; i++) { list[i].phased = true; list[i].phaseOffset = i; }
  }
  const mutates = Math.max(0, Math.min(6, template.mutates || 0));
  if (template.mutation) {
    const list = shape.nodes.filter(node => node.i > 0).sort((a, b) => b.depth - a.depth || a.i - b.i);
    for (let i = 0; i < mutates && i < list.length; i++) {
      list[i].mutates = true;
      list[i].mutationMaterial = materials[(materials.indexOf(list[i].material) + 1 + i) % materials.length];
    }
  }
  // The Living Labyrinth opens extra passages at fixed milestones. Opening a passage can only add
  // routes, so a node can never become unreachable.
  let wired = 0;
  const rewire = Math.max(0, Math.min(4, template.rewire || 0));
  for (let i = 0; i < rewire; i++) {
    const a = shape.nodes[(i * 3 + 1) % shape.nodes.length], b = shape.nodes[(i * 5 + 4) % shape.nodes.length];
    if (!a || !b || a.key === b.key || a.key === 'n0' || b.key === 'n0') continue;
    if (shape.edges.some(edge => edge.a === a.key && edge.b === b.key || edge.a === b.key && edge.b === a.key)) continue;
    shape.edges.push({a: a.key, b: b.key, resistance: .92, opensAt: 2 * (i + 1)});
    wired++;
  }
  for (const edge of shape.edges) edge.resistance = Math.round(Math.min(1, edge.resistance) * 100) / 100;
  return {
    id: template.id, pattern: shape.pattern, nodes: shape.nodes, edges: shape.edges, gates,
    migrating: shape.migrating || null, hidden, scale, seed, materials,
    phase: template.phase || 0, phaseNodes, dormantKeys, dormantCount, rewired: wired,
    echo: !!template.echo, mutation: template.mutation || 0, mutates, outlets: template.outlets || 1,
    totalVolume: Math.round(shape.nodes.reduce((sum, node) => sum + node.volume, 0) * 100) / 100
  };
}

// A draw pulls from the reachable frontier: nearest chamber first, spilling outward. Gate state and
// revealed compartments are inputs, so the same committed progress always replays identically.
// A migrating plug sits on a different edge for every draw; a resonance pass records that draw
// index as a negative "broken" entry, so the checkpoint stays a small integer list.
// A phase-locked chamber is only reachable inside its fictional window. The window is derived from
// the pass index, so a checkpoint never stores a phase.
// A phase is a property of the chamber's own fill, not of a wall clock: it is fully replayable from
// the checkpoint and can never be unreachable. Closed phases throttle flow (30%) instead of blocking
// it, so no seed or instrument combination can soft-lock a case.
function phaseOpen(node) {
  if (!node.phased) return true;
  const fill = node.remaining / Math.max(0.01, node.volume);
  return fill > 0.62 || fill < 0.34;
}

function blockedEdge(graph, edge, broken, pass, openAll) {
  if (openAll) return false;
  if (edge.gate && !broken.has(graph.gates.indexOf(edge))) return true;
  if (graph.migrating) {
    const host = graph.migrating[((pass % graph.migrating.length) + graph.migrating.length) % graph.migrating.length];
    if (edge.b === host && !broken.has(-1 - pass)) return true;
  }
  if (Number.isInteger(edge.opensAt) && pass < edge.opensAt) return true;
  return false;
}

function frontier(graph, map, broken, pass, openAll, env, tick) {
  const distance = new Map([['n0', 0]]), queue = ['n0'], order = [];
  const outlet = map.get('n0');
  if (outlet && !outlet.empty) order.push({key: 'n0', distance: 0});
  const host = graph.migrating && !openAll
    ? graph.migrating[((pass % graph.migrating.length) + graph.migrating.length) % graph.migrating.length]
    : null;
  const held = host && !broken.has(-1 - pass);
  while (queue.length) {
    const key = queue.shift();
    for (const edge of graph.edges) {
      if (edge.a !== key || distance.has(edge.b)) continue;
      if (blockedEdge(graph, edge, broken, pass, openAll)) continue;
      const target = map.get(edge.b);
      if (!target || !target.revealed) continue;
      distance.set(edge.b, distance.get(key) + 1);
      if (held && edge.b === host) continue;
      queue.push(edge.b);
      if (target.empty) continue;
      if (!openAll && !target.active) continue;
      order.push({key: edge.b, distance: distance.get(edge.b), edge});
    }
  }
  order.sort((a, b) => a.distance - b.distance || a.key.localeCompare(b.key));
  return order;
}

export function replay(graph, progress = {}, options = {}) {
  const scanned = new Set(progress.found || []);
  const broken = new Set(progress.g || []);
  const openAll = !!options.openAll;
  const env = options.env || null;
  const units = Number.isFinite(options.units) ? Math.max(0.4, Math.min(3, options.units)) : DRAW;
  // The phase clock advances on every release attempt, blocked ones included, so a phase window can
  // never be unreachable. It is one small integer in the checkpoint.
  const tick = Number.isFinite(progress.k) ? Math.max(0, Math.min(999999, Math.round(progress.k))) : 0;
  const nodes = graph.nodes.map(node => ({
    ...node, remaining: node.volume, empty: false, active: !node.dormant,
    revealed: openAll || !node.hidden || scanned.has(node.key), exposed: false,
    materialNow: node.material, phasedNow: false
  }));
  const map = new Map(nodes.map(node => [node.key, node]));
  const events = [];
  let dormantActivated = 0;
  const dormantKeys = graph.dormantKeys || [];
  // Visibility is derived every pass: scanned probes, drainage exposure, a spectral window, and the
  // bioluminescent reveal that follows an emptied chamber.
  const reveal = pass => {
    const spectral = !openAll && env && env.spectral && pass % 2 === 1;
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodes) {
        if (openAll || scanned.has(node.key) || spectral) node.revealed = node.revealed || node.hidden || !node.hidden;
        if (!node.hidden || node.revealed) { node.phasedNow = node.phased ? !phaseOpen(node) : false; continue; }
        const parents = graph.edges.filter(edge => edge.b === node.key).map(edge => map.get(edge.a));
        if (parents.length && parents.every(parent => parent && parent.empty)) {
          node.revealed = true; node.exposed = true; changed = true;
        }
        node.phasedNow = node.phased ? !phaseOpen(node) : false;
      }
    }
  };
  const materialOf = (node, pass) => {
    if (graph.mutation && node.mutates && pass >= graph.mutation) return node.mutationMaterial || node.material;
    return node.material;
  };
  reveal(0);
  const visits = Math.max(0, Math.min(64, progress.p || 0));
  let echo = [];
  for (let pass = 0; pass < visits; pass++) {
    reveal(pass);
    const reachable = frontier(graph, map, broken, pass, openAll, env, tick);
    const base = units * (env && env.moon && pass % 4 === 3 ? 1.5 : 1) * (env && env.temp && pass % 3 === 2 ? 0.6 : 1);
    const drained = [];
    let budget = base;
    for (const item of reachable) {
      if (budget <= EPSILON) break;
      const node = map.get(item.key);
      // Closed phases throttle, they never wall off.
      const factor = !openAll && node.phased && !phaseOpen(node) && !(env && env.ignorePhase) ? 0.3 : 1;
      const amount = Math.min(node.remaining, budget * factor);
      node.remaining = Math.round((node.remaining - amount) * 100) / 100;
      budget -= amount / Math.max(0.3, factor);
      drained.push({key: node.key, amount, material: materialOf(node, pass), depth: node.depth});
      if (node.remaining <= EPSILON) { node.remaining = 0; node.empty = true; }
    }
    // Spectral echo: the previous pass's emptied chamber releases again one pass later.
    const echoed = [];
    if (graph.echo) {
      for (const key of echo) {
        const node = map.get(key);
        if (!node || node.empty || !node.revealed) continue;
        const amount = Math.min(node.remaining, base * 0.35);
        node.remaining = Math.round((node.remaining - amount) * 100) / 100;
        if (node.remaining <= EPSILON) { node.remaining = 0; node.empty = true; }
        echoed.push({key: node.key, amount, material: materialOf(node, pass), depth: node.depth, echo: true});
      }
    }
    const secondary = [];
    for (const item of [...drained, ...echoed]) {
      const node = map.get(item.key);
      if (!node.empty || !node.hub) continue;
      for (const edge of graph.edges) {
        if (edge.a !== node.key) continue;
        const child = map.get(edge.b);
        if (!child || child.empty || !child.revealed) continue;
        const amount = Math.min(child.remaining, DRAW * 0.55);
        child.remaining = Math.round((child.remaining - amount) * 100) / 100;
        if (child.remaining <= EPSILON) { child.remaining = 0; child.empty = true; }
        secondary.push({key: child.key, amount, material: materialOf(child, pass), depth: child.depth, chain: true});
      }
    }
    // The Regenerator: a dormant chamber wakes once, and only while the field is still active. The
    // count is bounded by the authored dormant list, so completion is always finite.
    const activated = [];
    const anyEmpty = drained.some(item => map.get(item.key).empty) || echoed.some(item => map.get(item.key).empty);
    if (dormantActivated < dormantKeys.length && (anyEmpty || drained.length === 0)) {
      const node = map.get(dormantKeys[dormantActivated++]);
      if (node) { node.active = true; activated.push(node.key); }
    }
    // Bioluminescence: an emptied chamber lights its neighbours into the record.
    const lit = [];
    if (env && env.bioluminescence) {
      for (const item of [...drained, ...echoed]) {
        const node = map.get(item.key);
        if (!node.empty) continue;
        for (const edge of graph.edges) {
          if (edge.a !== node.key) continue;
          const child = map.get(edge.b);
          if (child && !child.revealed) { child.revealed = true; lit.push(child.key); }
        }
      }
    }
    const rewired = graph.edges.map((edge, index) => ({edge, index}))
      .filter(item => Number.isInteger(item.edge.opensAt) && item.edge.opensAt === pass)
      .map(item => item.index);
    const mutated = graph.mutation === pass ? nodes.filter(node => node.mutates).map(node => node.key) : [];
    events.push({pass, drained, secondary, echoed, activated, lit, rewired, mutated,
      blocked: drained.length === 0 && echoed.length === 0});
    // The echo targets are the still-filled chambers behind a chamber that emptied this pass: a
    // completed release produces a delayed secondary release rather than replaying an empty one.
    if (graph.echo) {
      const next = [];
      for (const item of [...drained, ...echoed]) {
        if (!map.get(item.key).empty) continue;
        for (const edge of graph.edges) {
          if (edge.a !== item.key) continue;
          const child = map.get(edge.b);
          if (child && !child.empty && child.revealed) next.push(child.key);
        }
      }
      echo = [...new Set(next)];
    } else echo = [];
  }
  reveal(visits);
  const remaining = Math.round(nodes.reduce((sum, node) => sum + node.remaining, 0) * 100) / 100;
  const unrevealed = nodes.filter(node => !node.revealed);
  const gates = graph.gates.map((edge, index) => ({index, a: edge.a, b: edge.b, type: edge.gate, broken: broken.has(index)}));
  const migrating = graph.migrating ? graph.migrating[visits % graph.migrating.length] : null;
  const held = migrating && !broken.has(-1 - visits) ? migrating : null;
  return {
    graph, nodes, events, remaining, unrevealed: unrevealed.map(node => node.key),
    drawn: Math.round((graph.totalVolume - remaining) * 100) / 100,
    complete: remaining <= EPSILON && unrevealed.length === 0,
    found: nodes.filter(node => node.revealed).length,
    gates, migrating, held, env, units, tick,
    dormant: dormantKeys.filter((key, index) => index < dormantActivated),
    pending: dormantKeys.slice(dormantActivated),
    phaseClosed: nodes.filter(node => node.phased && !phaseOpen(node)).map(node => node.key),
    outlet: 'n0', pass: visits
  };
}

// Future draws with every gate open and every compartment known. Used for the pass estimate shown
// in the HUD and for deciding whether reward() should score the case as complete.
export function remainingDraws(graph, progress = {}) {
  const open = {p: Math.max(0, Math.min(64, progress.p || 0))};
  if (replay(graph, open, {openAll: true}).complete) return 0;
  for (let extra = 1; extra <= 32; extra++) {
    if (replay(graph, {...open, p: open.p + extra}, {openAll: true}).complete) return extra;
  }
  return 32;
}

// What a specific release would do, without committing it.
export function preview(graph, progress, tool, options = {}) {
  const env = options.env || null;
  const units = Number.isFinite(options.units) ? options.units : 1;
  const before = replay(graph, progress, {env, units});
  const steps = tool && tool.technique === 'vortex' ? 2 : 1;
  const state = replay(graph, {...progress, p: (progress.p || 0) + steps}, {env, units});
  const events = state.events.slice(before.pass);
  const drained = events.flatMap(event => [...event.drained, ...event.secondary]);
  const blocked = events.length === 0 || events.every(event => event.blocked);
  return {steps, drained, blocked, state, before, passes: (progress.p || 0) + steps};
}

// Deterministic material accounting used by the verification suite.
export function accounting(graph, progress) {
  const state = replay(graph, progress);
  return {initial: graph.totalVolume, consumed: state.drawn, remaining: state.remaining,
    negative: state.nodes.some(node => node.remaining < 0)};
}
