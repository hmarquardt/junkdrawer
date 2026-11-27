import { sides, stagesSchema, validateWithSchema } from './contracts.mjs';
import { fillPair } from './stages.mjs';

export const claimsFor = (observation) => {
  const claims = [];
  for (const side of sides)
    if (observation.rendering[side] === 'failed')
      claims.push({ target: 'rendering:' + side, kind: 'rendering', expected: 'failed' });
  observation.requirements.forEach((r, i) => {
    for (const side of sides)
      if (r.status[side] === 'uncertain')
        claims.push({ target: 'R' + (i + 1) + ':' + side, kind: 'requirement', expected: r.status[side] });
  });
  observation.defects.forEach((d, i) =>
    claims.push({
      target: 'D' + (i + 1),
      kind: 'defect',
      expected: d.severity,
      type: d.type,
      location: d.location,
      side: d.side,
    }),
  );
  if (observation.defects.some((d) => d.severity === 'page_broken'))
    claims.push({ target: 'readability', kind: 'readability', expected: 'unreadable' });
  return claims;
};

const suggestedValues = {
  requirement: ['met', 'alternative', 'missing', 'uncertain'],
  defect: ['minor', 'major', 'page_broken', 'remove'],
  readability: ['readable', 'unreadable'],
  rendering: ['rendered', 'failed'],
};

export function validateVerify(data, claims) {
  for (const check of data?.checks || []) fillPair(check.evidence, 'not reported');
  validateWithSchema(data, stagesSchema.verify, 'verify');
  const byTarget = new Map(claims.map((c) => [c.target, c]));
  const seen = new Set();
  for (const check of data.checks) {
    const claim = byTarget.get(check.target);
    if (!claim) throw Error('Verification references an unknown claim.');
    if (seen.has(check.target)) throw Error('Verification repeats a claim.');
    seen.add(check.target);
    if (check.suggested && !suggestedValues[claim.kind].includes(check.suggested))
      throw Error('Verification suggestion is not valid for this claim.');
    if (check.verdict === 'refuted' && !check.suggested)
      throw Error('A refuted claim needs a concrete suggestion.');
  }
  return data;
}

// Apply only explicit, grounded corrections; keep an auditable list for diagnostics.
export function applyVerification(observation, verification, claims) {
  const o = structuredClone(observation);
  const byTarget = new Map(claims.map((c) => [c.target, c]));
  const corrections = [];
  const removals = new Set();
  for (const check of verification.checks) {
    const claim = byTarget.get(check.target);
    if (check.verdict !== 'refuted') {
      corrections.push({ ...claim, verdict: check.verdict, applied: false, note: check.note });
      continue;
    }
    if (claim.kind === 'requirement' && check.suggested) {
      const [id, side] = check.target.split(':');
      const requirement = o.requirements[Number(id.slice(1)) - 1];
      if (requirement && requirement.status[side] !== check.suggested) {
        corrections.push({
          ...claim,
          verdict: check.verdict,
          applied: true,
          from: requirement.status[side],
          to: check.suggested,
          note: check.note,
        });
        requirement.status[side] = check.suggested;
      }
    } else if (claim.kind === 'defect' && check.suggested) {
      const index = Number(claim.target.slice(1)) - 1;
      if (check.suggested === 'remove') {
        corrections.push({ ...claim, verdict: check.verdict, applied: true, to: 'remove', note: check.note });
        removals.add(index);
      } else if (o.defects[index] && o.defects[index].severity !== check.suggested) {
        corrections.push({
          ...claim,
          verdict: check.verdict,
          applied: true,
          from: o.defects[index].severity,
          to: check.suggested,
          note: check.note,
        });
        o.defects[index].severity = check.suggested;
      }
    } else if (claim.kind === 'rendering' && check.suggested) {
      const side = check.target.split(':')[1];
      if (o.rendering[side] !== check.suggested) {
        corrections.push({
          ...claim,
          verdict: check.verdict,
          applied: true,
          from: o.rendering[side],
          to: check.suggested,
          note: check.note,
        });
        o.rendering[side] = check.suggested;
      }
    } else if (claim.kind === 'readability' && check.suggested === 'readable') {
      for (const defect of o.defects)
        if (defect.severity === 'page_broken') {
          corrections.push({
            target: check.target,
            verdict: check.verdict,
            applied: true,
            from: 'page_broken',
            to: 'major',
            note: check.note,
          });
          defect.severity = 'major';
        }
    }
  }
  if (removals.size) o.defects = o.defects.filter((_, index) => !removals.has(index));
  return { observation: o, corrections };
}
