import { imageType } from './images.mjs';
// The byte-string representation maps every octet 1:1, including binary MIME bodies.
const MAX_ARCHIVE = 64 * 1024 * 1024;
function binary(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 32768) out += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return out;
}
const octets = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
function decode(body, encoding) {
  if (encoding === 'base64') return octets(atob(body.replace(/\s/g, '')));
  if (encoding === 'quoted-printable')
    body = body
      .replace(/=\r?\n/g, '')
      .replace(/=([a-f\d]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  if (encoding && !['7bit', '8bit', 'binary', 'quoted-printable'].includes(encoding))
    throw Error('Unsupported encoding.');
  return octets(body);
}
const param = (v, k) =>
  (new RegExp('(?:^|;)\\s*' + k + '\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))', 'i').exec(v) || [])
    .slice(1)
    .find(Boolean);
const resolve = (ref, base) => {
  try {
    return new URL(ref, new URL(base || '.', 'https://archive.invalid/')).href.split('#')[0];
  } catch {
    return ref.split('#')[0];
  }
};
export function parseArchive(input) {
  if (input.length > MAX_ARCHIVE) throw Error('Archive exceeds the 64 MiB import limit.');
  const parts = [],
    warnings = [];
  let nodes = 0,
    rootLocation = '';
  function walk(raw, depth, base) {
    if (++nodes > 2048 || depth > 12) throw Error('Archive exceeds the MIME nesting or part limit.');
    const sep = /\r?\n\r?\n/.exec(raw);
    if (!sep || sep.index > 65536) {
      warnings.push('Skipped a part with incomplete headers.');
      return;
    }
    const headers = Object.create(null);
    for (const line of raw
      .slice(0, sep.index)
      .replace(/\r?\n[ \t]+/g, ' ')
      .split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    const contentType = headers['content-type'] || '';
    let mime = contentType.split(';')[0].trim().toLowerCase();
    base = headers['content-base'] ? resolve(headers['content-base'], base) : base;
    const location = headers['content-location'] ? resolve(headers['content-location'], base) : '';
    if (!depth) rootLocation = headers['snapshot-content-location'] || location;
    const body = raw.slice(sep.index + sep[0].length);
    if (mime.startsWith('multipart/')) {
      let boundary = param(contentType, 'boundary');
      if (!boundary) {
        boundary = /^--([^\r\n]{1,200})\r?$/m.exec(body)?.[1];
        warnings.push('Multipart boundary was missing.');
      }
      if (!boundary || boundary.length > 200) return;
      const escaped = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const markers = new RegExp('^--' + escaped + '(--)?[ \\t]*(?:\\r?\\n|$)', 'gm');
      let start = null,
        closed = false;
      for (const m of body.matchAll(markers)) {
        if (start !== null)
          walk(body.slice(start, m.index).replace(/\r?\n$/, ''), depth + 1, location || base || rootLocation);
        if (m[1]) {
          closed = true;
          break;
        }
        start = m.index + m[0].length;
      }
      if (!closed) {
        warnings.push('Multipart section is incomplete.');
        if (start !== null) walk(body.slice(start), depth + 1, location || base || rootLocation);
      }
      return;
    }
    if (
      ![
        'text/html',
        'text/plain',
        'image/png',
        'image/jpeg',
        'image/webp',
        'application/octet-stream',
      ].includes(mime)
    )
      return;
    let bytes;
    try {
      bytes = decode(body, (headers['content-transfer-encoding'] || '').toLowerCase());
    } catch {
      warnings.push('Skipped an undecodable ' + mime + ' part.');
      return;
    }
    if (mime === 'application/octet-stream') {
      mime = imageType(bytes);
      if (!mime) return;
    }
    const part = {
      index: parts.length,
      mime,
      location,
      cid: (headers['content-id'] || '').replace(/^<|>$/g, ''),
      bytes,
    };
    if (mime.startsWith('text/')) {
      const charset =
        param(contentType, 'charset') ||
        /charset\s*=\s*["']?([\w-]+)/i.exec(binary(bytes.subarray(0, 1024)))?.[1] ||
        'utf-8';
      try {
        part.text = new TextDecoder(charset).decode(bytes);
      } catch {
        warnings.push('Unknown character encoding. Used UTF-8.');
        part.text = new TextDecoder().decode(bytes);
      }
    }
    parts.push(part);
  }
  walk(binary(input), 0, '');
  if (!parts.length) warnings.push('No supported archive parts recovered.');
  return {
    parts,
    warnings,
    rootLocation,
    resolveRef(ref, base = rootLocation) {
      if (/^cid:/i.test(ref)) {
        let id = ref.slice(4);
        try {
          id = decodeURIComponent(id);
        } catch {
          return undefined;
        }
        return (
          parts.find((p) => p.cid && p.cid.toLowerCase() === id.toLowerCase()) ||
          parts.find((p) => p.location === ref)
        );
      }
      const url = resolve(ref, base);
      return parts.find((p) => p.location && (resolve(p.location, rootLocation) === url || p.location === ref));
    },
  };
}
