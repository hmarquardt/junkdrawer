export function imageType(bytes) {
  const is = (offset, ...values) => values.every((v, i) => bytes[offset + i] === v);
  if (is(0, 137, 80, 78, 71, 13, 10, 26, 10)) return 'image/png';
  if (is(0, 255, 216, 255)) return 'image/jpeg';
  if (is(0, 82, 73, 70, 70) && is(8, 87, 69, 66, 80)) return 'image/webp';
  return null;
}
export async function hashBlob(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('');
}
export async function normalizeImage(blob, source, provenance) {
  const mime = imageType(new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
  if (!mime) throw Error('Expected PNG, JPEG or WebP image bytes.');
  const file = blob.slice(0, blob.size, mime);
  const bitmap = await createImageBitmap(file);
  const ref = {
    id: crypto.randomUUID(),
    mime,
    width: bitmap.width,
    height: bitmap.height,
    bytes: file.size,
    source,
    provenance,
  };
  bitmap.close();
  ref.sha256 = await hashBlob(file);
  return { ref, blob: file, url: URL.createObjectURL(file) };
}
export async function cropImage(asset, { x, y, width, height }) {
  if (
    ![x, y, width, height].every(Number.isInteger) ||
    x < 0 ||
    y < 0 ||
    width < 1 ||
    height < 1 ||
    x + width > asset.ref.width ||
    y + height > asset.ref.height
  )
    throw Error('Crop must fit within the original pixel dimensions.');
  const bitmap = await createImageBitmap(asset.blob);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, x, y, width, height, 0, 0, width, height);
  bitmap.close();
  const cropped = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!cropped) throw Error('Could not create this crop.');
  return normalizeImage(cropped, 'crop', asset.ref.id + ' [' + [x, y, width, height].join(', ') + ']');
}
export const dataURL = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(Error('Could not read image.'));
    r.readAsDataURL(blob);
  });
