// Reproducible procedural region plates for Dani the Pimple Popper: The Pore Explorer.
// Run from the repository root: node tools/danny-pore-textures.cjs
// Output: danny/pore-explorer/<region>.jpg (PNG when sips is unavailable).
// No third-party art is used. Every plate is generated from the seeds and parameters below,
// so the expansion ships original, documented artwork instead of recolored facial plates.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {execFileSync} = require('node:child_process');

const WIDTH = 768, HEIGHT = 576;
const OUT = path.resolve(__dirname, '..', 'danny', 'pore-explorer');

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// Smooth value noise on a wrap-free lattice; three octaves give macro relief without tiles.
function lattice(rand, cells) {
  const grid = new Float32Array((cells + 2) * (cells + 2));
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  return (x, y) => {
    const fx = Math.min(cells - 0.001, Math.max(0, x * cells)), fy = Math.min(cells - 0.001, Math.max(0, y * cells));
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const at = (px, py) => grid[(py + 1) * (cells + 2) + px + 1];
    const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
    const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
    return top + (bottom - top) * sy;
  };
}
const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = v => Math.min(1, Math.max(0, v));


function plate(options) {
  const rand = rng(options.seed);
  const n1 = lattice(rand, 5), n2 = lattice(rand, 17), n3 = lattice(rand, 61);
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
  const hair = [], pores = [];
  const [r0, g0, b0] = options.base, [r1, g1, b1] = options.flush;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const u = x / WIDTH, v = y / HEIGHT;
      const coarse = n1(u, v), mid = n2(u, v), fine = n3(u, v);
      // Macro relief: region-specific curvature so each plate reads as different anatomy.
      let relief = 0;
      if (options.curvature === 'shoulder') relief = -Math.exp(-Math.pow((v - 0.35) * 4.2, 2)) * 0.22;
      else if (options.curvature === 'neck') relief = Math.sin(v * Math.PI * 2.4) * 0.08;
      else if (options.curvature === 'ear') relief = Math.sin(u * Math.PI * 2.2) * 0.12 + Math.exp(-Math.pow((u - 0.62) * 3.6, 2) - Math.pow((v - 0.55) * 3.6, 2)) * -0.3;
      else if (options.curvature === 'arm') relief = Math.exp(-Math.pow((u - 0.45) * 3.4, 2)) * 0.12;
      else if (options.curvature === 'back') relief = Math.sin(u * Math.PI) * 0.07;
      else relief = Math.sin((u + v) * Math.PI) * 0.05;
      const tone = clamp01(0.5 + (coarse - 0.5) * 0.55 + (mid - 0.5) * 0.3 + relief);
      const blush = clamp01((mid - 0.42) * 1.5 + options.flushAmount * (1 - v * 0.6));
      const shade = 0.9 + 0.18 * (1 - v) + relief * 0.5;
      let r = mix(r0, r1, blush * 0.55) * (0.86 + tone * 0.2) * shade;
      let g = mix(g0, g1, blush * 0.55) * (0.86 + tone * 0.2) * shade;
      let b = mix(b0, b1, blush * 0.55) * (0.86 + tone * 0.2) * shade;
      // Fine skin grain and sebaceous sheen.
      const grain = (fine - 0.5) * options.grain;
      r += grain; g += grain * 0.94; b += grain * 0.9;
      const sheen = Math.pow(clamp01((coarse - 0.55) * 2.2), 2) * options.oil;
      r += sheen * 26; g += sheen * 22; b += sheen * 16;
      const i = (y * WIDTH + x) * 3;
      pixels[i] = Math.max(0, Math.min(255, r));
      pixels[i + 1] = Math.max(0, Math.min(255, g));
      pixels[i + 2] = Math.max(0, Math.min(255, b));
      // Pore openings and follicles are placed from the same lattice so they follow the relief.
      if (fine > 0.978 - options.pores * 0.004) pores.push([x, y, mid > 0.62 ? 1 : 0]);
    }
  }
  // Wrinkle and cartilage creases.
  for (const crease of options.creases || []) {
    const rand2 = rng(options.seed ^ crease.seed);
    for (let t = 0; t <= 1; t += 0.002) {
      const x = Math.round(mix(crease.from[0], crease.to[0], t) + Math.sin(t * crease.waves * Math.PI) * crease.bend * WIDTH);
      const y = Math.round(mix(crease.from[1], crease.to[1], t) + Math.cos(t * crease.waves * Math.PI) * crease.bend * HEIGHT * 0.4);
      const alpha = crease.alpha * (0.5 + 0.5 * Math.sin(t * 9 + rand2() * 0.2));
      for (let o = 0; o < crease.width; o++) {
        const yy = y + o;
        if (x < 1 || x >= WIDTH - 1 || yy < 1 || yy >= HEIGHT - 1) continue;
        const i = (yy * WIDTH + x) * 3;
        pixels[i] *= 1 - alpha; pixels[i + 1] *= 1 - alpha * 0.9; pixels[i + 2] *= 1 - alpha * 0.85;
      }
    }
  }
  for (const [x, y, size] of pores) {
    for (let dy = -size - 1; dy <= size + 1; dy++) for (let dx = -size - 1; dx <= size + 1; dx++) {
      const px = x + dx, py = y + dy;
      if (px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) continue;
      const d = Math.hypot(dx, dy);
      const falloff = Math.max(0, 1 - d / (size + 1.4));
      if (falloff <= 0) continue;
      const i = (py * WIDTH + px) * 3;
      pixels[i] *= 1 - 0.20 * falloff; pixels[i + 1] *= 1 - 0.24 * falloff; pixels[i + 2] *= 1 - 0.26 * falloff;
      // A faint raised rim reads as a follicle mouth under raking light.
      if (d > size + 0.3 && dy < 0) { pixels[i] *= 1.05; pixels[i + 1] *= 1.04; pixels[i + 2] *= 1.03; }
    }
  }
  // Hair is drawn as tapered, anti-aliased curves. Density, length and curvature come from the
  // region record, which also feeds the gameplay modifiers (instrument drag and scan noise).
  const hairRand = rng(options.seed ^ 0x51f15e);
  for (let n = 0; n < options.hair.count; n++) {
    const x0 = hairRand() * WIDTH, y0 = hairRand() * HEIGHT;
    const length = options.hair.length * (0.55 + hairRand() * 0.9);
    const angle = (options.hair.angle + (hairRand() - 0.5) * options.hair.spread) * Math.PI;
    const tone = 0.45 + hairRand() * 0.55;
    const alpha = options.hair.alpha * (0.45 + hairRand() * 0.55);
    hair.push({x0, y0, length, angle, tone, alpha,
      curl: (hairRand() - 0.5) * options.hair.curl, wave: hairRand() * Math.PI * 2,
      width: 0.55 + hairRand() * options.hair.weight * 0.55});
  }
  const blend = (x, y, color, alpha) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const i = (y * WIDTH + x) * 3;
    pixels[i] = mix(pixels[i], color[0], alpha);
    pixels[i + 1] = mix(pixels[i + 1], color[1], alpha);
    pixels[i + 2] = mix(pixels[i + 2], color[2], alpha);
  };
  for (const h of hair) {
    const steps = Math.max(12, Math.ceil(h.length * 1.4));
    let px = h.x0, py = h.y0;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, along = t * h.length;
      const perp = Math.sin(t * Math.PI * 1.35) * h.curl * 16 + Math.sin(t * Math.PI * 2.7 + h.wave) * h.curl * 4;
      const nx = h.x0 + Math.cos(h.angle) * along + Math.cos(h.angle + Math.PI / 2) * perp;
      const ny = h.y0 + Math.sin(h.angle) * along + Math.sin(h.angle + Math.PI / 2) * perp;
      const width = Math.max(0.35, h.width * (1 - t * 0.8));
      const color = options.hair.tint
        ? [options.hair.tint[0] + h.tone * 46, options.hair.tint[1] + h.tone * 32, options.hair.tint[2] + h.tone * 22]
        : [40 + h.tone * 52, 29 + h.tone * 36, 22 + h.tone * 26];
      const segments = Math.max(2, Math.ceil(Math.hypot(nx - px, ny - py) * 2));
      for (let k = 0; k <= segments; k++) {
        const q = k / segments, sx = px + (nx - px) * q, sy = py + (ny - py) * q;
        for (let o = -1; o <= 1; o++) {
          const offset = o * width;
          const ax = Math.round(sx + Math.cos(h.angle + Math.PI / 2) * offset);
          const ay = Math.round(sy + Math.sin(h.angle + Math.PI / 2) * offset);
          blend(ax, ay, color, h.alpha * (1 - Math.abs(o) * 0.45) * (1 - t * 0.35));
        }
      }
      if (s === 1) { blend(Math.round(px), Math.round(py), [62, 46, 38], h.alpha * 1.2); }
      px = nx; py = ny;
    }
  }
  // Gentle optical falloff toward the plate edges, matching the macro lenses in the base game.
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const d = Math.hypot(x / WIDTH - 0.5, y / HEIGHT - 0.5) * 1.42;
    // Keep the plate edge nearly flat: the renderer samples past the border when it warps, so a
    // strong edge vignette would show as a rectangular smear in the macro view.
    const k = 1 - 0.05 * d * d;
    const i = (y * WIDTH + x) * 3;
    pixels[i] *= k; pixels[i + 1] *= k; pixels[i + 2] *= k;
  }
  return encodePNG(pixels, WIDTH, HEIGHT);
}


function encodePNG(pixels, width, height) {
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ c >>> 1 : c >>> 1;
    return c;
  });
  const crc = buffer => {
    let c = -1;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ c >>> 8;
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2; header[10] = 0; header[11] = 0; header[12] = 0;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    pixels.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
}

const plates = {
  'back': {seed: 0x9a17c3, base: [196, 148, 121], flush: [176, 116, 104], flushAmount: 0.5, grain: 13, oil: 0.7,
    curvature: 'back', pores: 0.8, hair: {count: 130, length: 30, angle: 1.42, spread: 0.45, curl: 0.24, alpha: 0.24, weight: 1.2, tint: [48, 35, 27]},
    creases: [{from: [0.08, 0.28], to: [0.94, 0.34], waves: 1.3, bend: 0.012, alpha: 0.10, width: 2, seed: 3},
      {from: [0.16, 0.66], to: [0.9, 0.62], waves: 0.9, bend: 0.01, alpha: 0.08, width: 2, seed: 9}]},
  'shoulder': {seed: 0x51b0de, base: [206, 158, 132], flush: [190, 126, 112], flushAmount: 0.62, grain: 12, oil: 0.9,
    curvature: 'shoulder', pores: 0.6, hair: {count: 80, length: 24, angle: 0.5, spread: 0.5, curl: 0.22, alpha: 0.2, weight: 1.0, tint: [60, 44, 34]},
    creases: [{from: [0.05, 0.44], to: [0.96, 0.40], waves: 1.6, bend: 0.02, alpha: 0.12, width: 2, seed: 4}]},
  'ear': {seed: 0x7c2e11, base: [214, 158, 142], flush: [204, 120, 112], flushAmount: 0.72, grain: 10, oil: 1.2,
    curvature: 'ear', pores: 0.45, hair: {count: 24, length: 12, angle: 1.1, spread: 0.8, curl: 0.5, alpha: 0.16, weight: 0.8},
    creases: [{from: [0.12, 0.24], to: [0.8, 0.36], waves: 1.7, bend: 0.05, alpha: 0.20, width: 3, seed: 7},
      {from: [0.22, 0.56], to: [0.86, 0.62], waves: 1.2, bend: 0.04, alpha: 0.16, width: 3, seed: 8},
      {from: [0.36, 0.16], to: [0.42, 0.82], waves: 0.7, bend: 0.03, alpha: 0.14, width: 2, seed: 11}]},
  'scalp': {seed: 0x3f88aa, base: [189, 136, 112], flush: [170, 104, 92], flushAmount: 0.4, grain: 11, oil: 1.0,
    curvature: 'scalp', pores: 0.9, hair: {count: 300, length: 130, angle: 1.3, spread: 0.16, curl: 0.2, alpha: 0.34, weight: 1.7, tint: [46, 33, 25]},
    creases: [{from: [0.3, 0.03], to: [0.36, 0.98], waves: 0.5, bend: 0.02, alpha: 0.16, width: 2, seed: 13}]},
  'arm': {seed: 0x2d66f0, base: [203, 152, 126], flush: [184, 118, 106], flushAmount: 0.55, grain: 12, oil: 0.8,
    curvature: 'arm', pores: 0.55, hair: {count: 170, length: 26, angle: 1.6, spread: 0.3, curl: 0.18, alpha: 0.26, weight: 0.9, tint: [52, 38, 29]},
    creases: [{from: [0.1, 0.72], to: [0.92, 0.68], waves: 1.1, bend: 0.012, alpha: 0.09, width: 2, seed: 15}]},
  'neck': {seed: 0x6b1299, base: [199, 146, 124], flush: [182, 112, 102], flushAmount: 0.58, grain: 12, oil: 0.85,
    curvature: 'neck', pores: 0.7, hair: {count: 70, length: 16, angle: 1.5, spread: 0.55, curl: 0.3, alpha: 0.18, weight: 0.9},
    creases: [{from: [0.06, 0.3], to: [0.95, 0.33], waves: 1.5, bend: 0.012, alpha: 0.13, width: 2, seed: 17},
      {from: [0.1, 0.52], to: [0.92, 0.55], waves: 1.2, bend: 0.01, alpha: 0.11, width: 2, seed: 19},
      {from: [0.14, 0.74], to: [0.88, 0.72], waves: 1.0, bend: 0.01, alpha: 0.09, width: 2, seed: 23}]}
};

fs.mkdirSync(OUT, {recursive: true});
for (const [name, options] of Object.entries(plates)) {
  const png = plate(options);
  const target = path.join(OUT, name + '.png');
  fs.writeFileSync(target, png);
  const jpg = path.join(OUT, name + '.jpg');
  try {
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '70', target, '--out', jpg], {stdio: 'ignore'});
    fs.unlinkSync(target);
    console.log(name + '.jpg', Math.round(fs.statSync(jpg).size / 1024) + ' kB');
  } catch {
    console.log(name + '.png', Math.round(png.length / 1024) + ' kB (sips unavailable; PNG kept)');
  }
}
