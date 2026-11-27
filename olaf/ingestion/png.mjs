// Dependency-free PNG crop support for native-resolution verification regions.
// Node-only: imported by the server, CLI and benchmark providers, never by browser modules.
import { inflateSync, deflateSync } from 'node:zlib';

const signature = [137, 80, 78, 71, 13, 10, 26, 10];
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function decodePng(bytes) {
  const buf = Buffer.from(bytes);
  if (signature.some((v, i) => buf[i] !== v)) throw Error('Expected PNG bytes.');
  let pos = 8;
  let header = null;
  const idat = [];
  let palette = null;
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR')
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    else if (type === 'PLTE') palette = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + length;
  }
  if (!header) throw Error('PNG header is missing.');
  if (header.bitDepth !== 8 || header.interlace !== 0)
    throw Error('Only non-interlaced 8-bit PNG crops are supported.');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colorType];
  if (!channels) throw Error('Unsupported PNG color type.');
  const { width, height } = header;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < height * (stride + 1)) throw Error('PNG image data is incomplete.');
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prior = y ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prior ? prior[x] : 0;
      const c = prior && x >= channels ? prior[x - channels] : 0;
      const value = line[x];
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw Error('Unsupported PNG row filter.');
      out[x] = (value + predicted) & 0xff;
    }
  }
  if (header.colorType === 3) {
    if (!palette) throw Error('PNG palette is missing.');
    const rgba = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const index = pixels[i];
      palette.copy(rgba, i * 4, index * 3, index * 3 + 3);
      rgba[i * 4 + 3] = 255;
    }
    return { width, height, channels: 4, data: rgba };
  }
  return { width, height, channels, data: pixels };
}

export function encodePng({ width, height, channels, data }) {
  const colorType = { 1: 0, 2: 4, 3: 2, 4: 6 }[channels];
  if (colorType == null) throw Error('Unsupported output channel count.');
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data).copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colorType;
  return Buffer.concat([
    Buffer.from(signature),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function cropImage(image, { x, y, width, height }) {
  if (
    ![x, y, width, height].every(Number.isInteger) ||
    x < 0 ||
    y < 0 ||
    width < 1 ||
    height < 1 ||
    x + width > image.width ||
    y + height > image.height
  )
    throw Error('Crop must fit within the original pixel dimensions.');
  const out = Buffer.alloc(width * height * image.channels);
  for (let row = 0; row < height; row++)
    Buffer.from(image.data).copy(
      out,
      row * width * image.channels,
      ((y + row) * image.width + x) * image.channels,
      ((y + row) * image.width + x + width) * image.channels,
    );
  return { width, height, channels: image.channels, data: out };
}

// Returns null when the source is not a PNG; callers then keep the full image only.
export function cropDataUrl(url, { side, label, y0, y1 }) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(url || '');
  if (!match) return null;
  try {
    const image = decodePng(Buffer.from(match[1], 'base64'));
    const top = Math.max(0, Math.min(image.height - 1, Math.round(y0)));
    const bottom = Math.max(top + 1, Math.min(image.height, Math.round(y1)));
    const crop = cropImage(image, { x: 0, y: top, width: image.width, height: bottom - top });
    return 'data:image/png;base64,' + encodePng(crop).toString('base64');
  } catch {
    return null;
  }
}
