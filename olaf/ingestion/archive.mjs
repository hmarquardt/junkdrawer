import { parseArchive } from './mime.mjs';
const raster = /^image\/(png|jpeg|webp)$/;
export function extractArchive(bytes, adapter = genericAdapter) {
  const archive = parseArchive(bytes);
  archive.size = bytes.length;
  return adapter.extract(archive);
}
export const genericAdapter = {
  extract(archive) {
    const warnings = [...archive.warnings],
      texts = new Set();
    const images = archive.parts
      .filter((p) => raster.test(p.mime))
      .map((p) => ({
        part: p,
        blob: new Blob([p.bytes], { type: p.mime }),
        label: 'Archive image ' + (p.index + 1),
        side: null,
        partIndex: p.index,
        mime: p.mime,
        bytes: p.bytes.length,
        cid: p.cid || '',
        location: p.location || '',
      }));
    const doc = document.implementation.createHTMLDocument('');
    const html = archive.parts.filter((p) => p.mime === 'text/html');
    for (const p of html) {
      // Template contents in a detached, browsing-context-free document stay inert.
      const template = doc.createElement('template');
      template.innerHTML = p.text;
      const root = template.content;
      root
        .querySelectorAll('script,style,iframe,object,embed,svg,template,noscript')
        .forEach((el) => el.remove());
      let base = p.location || archive.rootLocation || 'https://archive.invalid/';
      const htmlBase = root.querySelector('base[href]')?.getAttribute('href');
      if (htmlBase) {
        try {
          base = new URL(htmlBase, base).href;
        } catch {
          warnings.push('Invalid HTML base location.');
        }
      }
      for (const img of root.querySelectorAll('img[src]')) {
        const src = img.getAttribute('src');
        const part = archive.resolveRef(src, base);
        let entry = part && images.find((i) => i.part === part);
        const inline = /^data:(image\/(?:png|jpeg|webp));base64,([\s\w+/=]+)$/i.exec(src);
        if (!entry && inline) {
          try {
            const bytes = Uint8Array.from(atob(inline[2]), (c) => c.charCodeAt(0));
            entry = {
              blob: new Blob([bytes], { type: inline[1] }),
              label: 'Inline image ' + (images.length + 1),
              side: null,
              partIndex: null,
              mime: inline[1],
              bytes: bytes.length,
              cid: '',
              location: '',
            };
            images.push(entry);
          } catch {
            warnings.push('Invalid inline image.');
          }
        }
        if (!entry) {
          warnings.push('An HTML image had no recoverable embedded resource.');
          continue;
        }
        const label = img.alt.trim() || img.closest('figure')?.querySelector('figcaption')?.textContent.trim();
        if (label) {
          entry.label = label.slice(0, 160);
          const side = /^(Left|Right)(?:\s+(?:candidate|screenshot|image))?$/i.exec(label)?.[1]?.toLowerCase();
          if (side) {
            const labelSide = side === 'left' ? 'Left' : 'Right';
            entry.side = entry.side && entry.side !== labelSide ? 'ambiguous' : labelSide;
          }
        }
      }
      for (const el of root.querySelectorAll('textarea, h1,h2,h3,h4,h5,h6,dt,strong,label')) {
        const content = el.textContent.trim();
        if (el.matches('textarea')) {
          if (content) texts.add(content);
          continue;
        }
        if (/^(?:original (?:user )?request|user request|request|prompt)\s*:?$/i.test(content)) {
          const next = el.nextElementSibling?.textContent.trim();
          if (next) texts.add(next);
        }
      }
    }
    if (!texts.size)
      for (const p of archive.parts.filter((p) => p.mime === 'text/plain'))
        if (p.text.trim()) texts.add(p.text.trim());
    if (texts.size !== 1)
      warnings.push(
        texts.size
          ? 'Multiple possible requests recovered. Choose or edit one.'
          : 'Original request was not identified.',
      );
    if (!html.length) warnings.push('No HTML document recovered.');
    const assigned = {};
    for (const side of ['Left', 'Right']) {
      const matches = images.filter((i) => i.side === side);
      if (matches.length === 1) assigned[side] = matches[0];
      else warnings.push(side + ' assignment needs confirmation from the image pool.');
    }
    return {
      requests: [...texts],
      images,
      assigned,
      warnings: [...new Set(warnings)],
      metadata: {
        htmlParts: html.length,
        embeddedImages: images.length,
        mimeParts: archive.parts.length,
        rootLocation: archive.rootLocation || '',
        archiveBytes: archive.size ?? null,
        images: images.map((image) => ({
          label: image.label,
          side: image.side,
          partIndex: image.partIndex ?? null,
          mime: image.mime || image.blob.type,
          bytes: image.bytes ?? image.blob.size,
          cid: image.cid || '',
          location: image.location || '',
        })),
      },
    };
  },
};
