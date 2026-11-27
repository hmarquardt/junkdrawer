// Deterministic error taxonomy for Phase 2 benchmark rows. No provider calls here.
import { foldText } from '../engine/text.mjs';

export const stageMatches = (expected, actual) =>
  expected === 'preference_or_tie' ? ['preference', 'tie'].includes(actual) : expected === actual;

const sameRequirement = (a, b) => {
  const x = foldText(a),
    y = foldText(b);
  return x === y || x.includes(y) || y.includes(x);
};
const bestMatch = (observation, excerpt) =>
  observation.requirements
    .filter((x) => sameRequirement(x.excerpt, excerpt))
    .sort((a, b) => foldText(b.excerpt).length - foldText(a.excerpt).length)[0];

// Evidence factuality is checked against the fixture's known elements, never against model prose.
export function evidenceAudit(c, why) {
  const text = foldText(why || '');
  const vocabulary = c.vocabulary.map(foldText);
  const absent = (c.absent || []).map(foldText);
  const negation = (term) => {
    const index = text.indexOf(term);
    if (index < 0) return false;
    const window = text.slice(Math.max(0, index - 24), index);
    return /\b(no|not|without|missing|absent|never)\s*$/.test(window);
  };
  const hallucinated = absent.filter((term) => text.includes(term) && !negation(term));
  return {
    grounded: vocabulary.some((term) => text.includes(term)) && hallucinated.length === 0,
    hallucinated,
  };
}

export function classify(c, result) {
  const errors = new Set();
  if (!result) {
    errors.add('invalid_output');
    return [...errors];
  }
  const observation = result.observation;
  const reference = c.requirements || [];
  for (const r of reference) {
    const found = bestMatch(observation, r.excerpt);
    if (!found) {
      errors.add('requirement_omission');
      continue;
    }
    if (found.scope !== r.scope) errors.add('applicability_error');
    for (const side of ['Left', 'Right'])
      if (found.status[side] !== r.status[side]) {
        const pair = [found.status[side], r.status[side]];
        if (pair.some((v) => ['alternative', 'missing'].includes(v)))
          errors.add('semantic_equivalence_error');
        else errors.add('applicability_error');
      }
  }
  for (const found of observation.requirements)
    if (!reference.some((r) => sameRequirement(r.excerpt, found.excerpt)))
      errors.add('invented_requirement');
  for (const d of c.defects || []) {
    const found = observation.defects.find((x) => x.side === d.side && x.type === d.type);
    if (!found) errors.add('missed_defect');
    else if (found.severity !== d.severity) errors.add('incorrect_defect_severity');
  }
  for (const found of observation.defects)
    if (!(c.defects || []).some((d) => d.side === found.side && d.type === found.type))
      errors.add('false_positive_defect');
  const audit = evidenceAudit(c, result.why);
  if (audit.hallucinated.length) errors.add('visual_hallucination');
  if (!audit.grounded && result.decision !== 'REVIEW') errors.add('unsupported_explanation');
  if (result.verification && result.verification.consistent === false) errors.add('position_inconsistency');
  if (c.reference.decision !== null && result.decision !== c.reference.decision) {
    if (
      ['prompt_adherence', 'disqualifiers'].includes(c.reference.stage) &&
      ['preference', 'tie', 'review'].includes(result.stage)
    )
      errors.add('decision_precedence_violation');
    else if (['tie', 'preference'].includes(c.reference.stage)) errors.add('preference_disagreement');
    else errors.add('decision_disagreement');
  }
  if (result.decision === 'REVIEW' && c.reference.decision !== 'REVIEW') errors.add('abstention');
  return [...errors];
}
