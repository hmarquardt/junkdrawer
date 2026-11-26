// Reproducible supernatural region plates for Dani the Pimple Popper 1.3 — The Midnight Clinic.
// Run from the repository root: node tools/danny-midnight-textures.cjs
// Output: danny/midnight-clinic/<plate>.jpg (PNG when sips is unavailable).
// Every plate is generated from the seeds and parameters below. No third-party art is used.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {execFileSync} = require('node:child_process');
const WIDTH = 768, HEIGHT = 576;
const OUT = path.resolve(__dirname, '..', 'danny', 'midnight-clinic');

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function lattice(rand, cells) {
  const grid = new Float32Array((cells + 2) * (cells + 2));
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  return (x, y) => {
    const fx = Math.min(cells - .001, Math.max(0, x * cells)), fy = Math.min(cells - .001, Math.max(0, y * cells));
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

function plate(o) {
  const rand = rng(o.seed);
  const n1 = lattice(rand, 5), n2 = lattice(rand, 19), n3 = lattice(rand, 67);
  const px = Buffer.alloc(WIDTH * HEIGHT * 3);
  const [r0, g0, b0] = o.base, [r1, g1, b1] = o.flush;
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const u = x / WIDTH, v = y / HEIGHT;
    const c = n1(u, v), m = n2(u, v), f = n3(u, v);
    let relief = Math.sin((u + v) * Math.PI) * .05;
    if (o.pattern === 'scaled') relief = Math.sin((v + Math.sin(u * 9) * .05) * 34) * .09 + Math.cos(u * 27) * .04;
    if (o.pattern === 'mineral') relief = (Math.abs(Math.sin(u * 17 + m * 3)) + Math.abs(Math.cos(v * 21))) * .06 - .03;
    if (o.pattern === 'amphibian') relief = Math.sin(u * 13 + m * 4) * .05 + Math.cos(v * 17) * .04;
    if (o.pattern === 'impossible') relief = Math.sin(u * 9 + v * 7 + m * 6) * .08 + (f - .5) * .12;
    const tone = clamp01(.5 + (c - .5) * .5 + (m - .5) * .32 + relief);
    const blush = clamp01((m - .42) * 1.4 + o.flushAmount * (1 - v * .5));
    const shade = .9 + .16 * (1 - v) + relief * .6;
    let r = mix(r0, r1, blush * .5) * (.86 + tone * .2) * shade;
    let g = mix(g0, g1, blush * .5) * (.86 + tone * .2) * shade;
    let b = mix(b0, b1, blush * .5) * (.86 + tone * .2) * shade;
    if (o.pattern === 'iridescent') {
      const band = .5 + .5 * Math.sin(u * 11 + v * 6 + m * 4);
      r += band * 13; g += Math.sin(band * Math.PI) * 16; b += (1 - band) * 18;
    }
    const grain = (f - .5) * o.grain;
    r += grain; g += grain * .95; b += grain * .9;
    const sheen = Math.pow(clamp01((c - .55) * 2.2), 2) * o.oil;
    r += sheen * 30; g += sheen * 26; b += sheen * 22;
    const i = (y * WIDTH + x) * 3;
    px[i] = Math.max(0, Math.min(255, r)); px[i + 1] = Math.max(0, Math.min(255, g)); px[i + 2] = Math.max(0, Math.min(255, b));
  }
  const blend = (x, y, color, alpha) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT || alpha <= 0) return;
    const i = (Math.round(y) * WIDTH + Math.round(x)) * 3;
    px[i] = mix(px[i], color[0], alpha); px[i + 1] = mix(px[i + 1], color[1], alpha); px[i + 2] = mix(px[i + 2], color[2], alpha);
  };
  // Hair and fur, drawn as tapered curves.
  if (o.hair) for (let n = 0; n < o.hair.count; n++) {
    const x0 = rand() * WIDTH, y0 = rand() * HEIGHT, len = o.hair.length * (.55 + rand() * .9);
    const ang = (o.hair.angle + (rand() - .5) * o.hair.spread) * Math.PI, curl = (rand() - .5) * o.hair.curl;
    const tone = .5 + rand() * .5, alpha = o.hair.alpha * (.45 + rand() * .55);
    const color = [o.hair.tint[0] + tone * 40, o.hair.tint[1] + tone * 30, o.hair.tint[2] + tone * 22];
    for (let s = 0; s < Math.ceil(len * 1.4); s++) {
      const t = s / Math.ceil(len * 1.4);
      const perp = Math.sin(t * Math.PI * 1.35) * curl * 16 + Math.sin(t * Math.PI * 2.7 + n) * curl * 4;
      const width = (o.hair.weight || 1) * (1 - t * .6);
      for (let o2 = -Math.ceil(width); o2 <= Math.ceil(width); o2++) {
        blend(x0 + Math.cos(ang) * len * t + Math.cos(ang + Math.PI / 2) * (perp + o2),
          y0 + Math.sin(ang) * len * t + Math.sin(ang + Math.PI / 2) * (perp + o2),
          color, alpha * (1 - t * .35) * (1 - Math.abs(o2) / (width + 1)));
      }
    }
  }
  // Overlapping scales: rows of arcs with a bright leading edge.
  if (o.pattern === 'scaled') {
    const w = 34, h = 24;
    for (let row = 0; row < Math.ceil(HEIGHT / h) + 1; row++) for (let col = 0; col < Math.ceil(WIDTH / w) + 1; col++) {
      const cx = col * w + (row % 2) * w / 2, cy = row * h;
      for (let a = 0; a <= Math.PI; a += .08) {
        blend(cx + Math.cos(a) * w * .55, cy + Math.sin(a) * h * .9, [30, 24, 18], .22);
        blend(cx + Math.cos(a) * w * .5, cy + Math.sin(a) * h * .8, [230, 214, 170], .10);
      }
    }
  }
  // Mycelium: branching filaments with spore nodes.
  if (o.pattern === 'mycelial') {
    for (let root = 0; root < 14; root++) {
      let x = rand() * WIDTH, y = rand() * HEIGHT, ang = rand() * Math.PI * 2;
      for (let step = 0; step < 90; step++) {
        ang += (rand() - .5) * .5;
        x += Math.cos(ang) * 4; y += Math.sin(ang) * 4;
        blend(x, y, [226, 214, 196], .18);
        if (step % 9 === 0) for (let r = 2; r < 6; r++) blend(x + r, y, [244, 236, 220], .07);
        if (rand() > .86) { ang += Math.PI / 3; }
      }
    }
  }
  // Bioluminescent spots for the alien, ghost and fungoid plates.
  if (o.glow) for (let n = 0; n < o.glow; n++) {
    const x = rand() * WIDTH, y = rand() * HEIGHT, rad = 8 + rand() * 26;
    for (let d = rad; d > 0; d -= 2) {
      const a = (1 - d / rad) ** 2 * .22;
      for (let t = 0; t < Math.PI * 2; t += .3) blend(x + Math.cos(t) * d, y + Math.sin(t) * d, [120, 255, 226], a);
    }
  }
  // Mineral facets for troll skin.
  if (o.pattern === 'mineral') for (let n = 0; n < 40; n++) {
    const x = rand() * WIDTH, y = rand() * HEIGHT, r = 10 + rand() * 26;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) blend(x + Math.cos(a) * r, y + Math.sin(a) * r, [212, 208, 198], .18);
  }
  const k = .97;
  for (let i = 0; i < px.length; i++) px[i] = Math.min(255, px[i] * k);
  return encode(px, WIDTH, HEIGHT);
}
function encode(pixels, width, height) {
  const table = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ c >>> 1 : c >>> 1; return c; });
  const crc = buffer => { let c = -1; for (const byte of buffer) c = table[(c ^ byte) & 255] ^ c >>> 8; return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; pixels.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = {plate, encode};
