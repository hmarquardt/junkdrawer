// Deterministic text helpers shared by validation, grounding and benchmark review.

// Fold typographic variants and whitespace while retaining a map back to original offsets.
export function foldWithMap(text) {
  const quote = (c) => (/[\u2018\u2019\u201B\u2032]/.test(c) ? "'" : /[\u201C\u201D\u201F\u2033]/.test(c) ? '"' : c);
  let folded = '';
  const map = [];
  for (let i = 0; i < text.length; i++) {
    let c = quote(text[i]);
    if (/[\u2010-\u2015\u2212]/.test(c)) c = '-';
    if (c === '\u2026') c = '...';
    if (/\s/.test(c)) {
      if (folded.endsWith(' ')) continue;
      c = ' ';
    }
    if (/[A-Z]/.test(c)) c = c.toLowerCase();
    for (const ch of c) {
      folded += ch;
      map.push(i);
    }
  }
  return { folded, map };
}
export const foldText = (text) => foldWithMap(text).folded;

// Recover a unique punctuation- or whitespace-equivalent source phrase. Never rewrites the request.
export function recoverExcerpt(request, excerpt) {
  if (typeof excerpt !== 'string' || !excerpt.trim()) return null;
  if (request.includes(excerpt)) return excerpt;
  const { folded, map } = foldWithMap(request);
  const phrase = foldText(excerpt).trim();
  if (!phrase) return null;
  const index = folded.indexOf(phrase);
  if (index < 0 || folded.lastIndexOf(phrase) !== index) return null;
  const canonical = request.slice(map[index], map[index + phrase.length - 1] + 1);
  return request.includes(canonical) ? canonical : null;
}
// An explicit basis is required before a reasonable interpretation may be scored as missing.
export const substantiveBasis = (text) =>
  typeof text === 'string' && text.trim().length >= 24 && !/^\s*(?:none|n\/a|not applicable|no)\b/i.test(text);
export const genericClause = (text) =>
  /both (?:sides|designs|screenshots)|visually identical|equally (?:good|bad)|no (?:meaningful|visible) difference|no visual inspection/i.test(
    text,
  );
