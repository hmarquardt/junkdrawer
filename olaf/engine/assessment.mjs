import { sides, other, pair } from './contracts.mjs';
import { substantiveBasis } from './text.mjs';

const negativeEvidence = (text, alternative) =>
  /\b(?:absent|missing|lacks|cannot be seen|not (?:visible|present|shown)|no (?:visible )?(?:button|label|badge|field|search|heading))\b/i.test(
    text || '',
  ) ||
  (alternative && /\b(?:enabled|active|ordinary|default state)\b/i.test(text || ''));
const failureEvidence = /\b(?:fail|error|blank|empty white|cannot load|did not render|does not render|not render|unavailable|404|500|no content)\b/i;
const unreadableEvidence = /\b(?:unreadable|washed|faint|low contrast|blends? into|fades? into|disappears?|cannot read|illegible)\b/i;
const widespreadEvidence = /\b(?:whole|entire|all|every|throughout|page[- ]wide|widespread|main text)\b/i;

// Guards for the single-pass observation: grounded evidence outranks an optimistic status or rendering label.
export function normalizePerception(o) {
  const observation = structuredClone(o);
  const corrections = [];
  for (const [i, r] of observation.requirements.entries())
    for (const side of sides) {
      const status = r.status[side],
        text = r.evidence[side];
      if (['met', 'alternative'].includes(status) && negativeEvidence(text, status === 'alternative')) {
        corrections.push({
          kind: 'status',
          requirement: i + 1,
          side,
          from: status,
          to: 'missing',
          basis: text,
        });
        r.status[side] = 'missing';
      }
    }
  for (const side of sides) {
    const text = observation.renderEvidence[side];
    if (observation.rendering[side] === 'failed' && !failureEvidence.test(text) && unreadableEvidence.test(text)) {
      corrections.push({ kind: 'rendering', side, from: 'failed', to: 'rendered', basis: text });
      observation.rendering[side] = 'rendered';
    }
  }
  for (const [i, d] of observation.defects.entries())
    if (
      d.type === 'contrast' &&
      d.severity === 'major' &&
      unreadableEvidence.test(d.evidence[d.side] || '') &&
      widespreadEvidence.test(`${d.location} ${d.evidence[d.side]}`)
    ) {
      corrections.push({
        kind: 'severity',
        defect: i + 1,
        from: 'major',
        to: 'page_broken',
        basis: `${d.location} ${d.evidence[d.side]}`,
      });
      d.severity = 'page_broken';
    }
  return { observation, corrections };
}


// Deterministic corrections applied to stage evidence before adjudication.
// 1. A reasonable alternative interpretation meets the requirement when the stage supplies an explicit basis.
// 2. Severe-defect severity follows observable scope and impact, so a styling win cannot hide unreadable output.
export function normalizeAssessment(assessment) {
  const corrections = [];
  const requirements = assessment.requirements.map((r) => {
    if (r.scope !== 'visible' || !r.alternative) return r;
    const status = { ...r.status };
    for (const side of sides) {
      if (
        ['met', 'alternative'].includes(status[side]) &&
        negativeEvidence(r.evidence?.[side], status[side] === 'alternative')
      ) {
        corrections.push({
          kind: 'status',
          id: r.id,
          side,
          from: status[side],
          to: 'missing',
          basis: r.evidence[side],
        });
        status[side] = 'missing';
      }
      if (status[side] === 'missing' && r.alternative[side] === true && substantiveBasis(r.basis?.[side])) {
        corrections.push({
          kind: 'equivalence',
          id: r.id,
          side,
          from: 'missing',
          to: 'alternative',
          basis: r.basis[side],
        });
        status[side] = 'alternative';
      }
    }
    return { ...r, status };
  });
  const defects = assessment.defects.map((d, i) => {
    let severity = d.severity;
    if (d.impact === 'unreadable' && ['widespread', 'page'].includes(d.scope) && severity !== 'page_broken') {
      corrections.push({ kind: 'severity', defect: i + 1, from: severity, to: 'page_broken', basis: 'unreadable ' + d.scope });
      severity = 'page_broken';
    } else if (d.impact === 'obstructive' && severity === 'minor') {
      corrections.push({ kind: 'severity', defect: i + 1, from: severity, to: 'major', basis: 'obstructive content' });
      severity = 'major';
    } else if (severity === 'page_broken' && (d.scope === 'localized' || d.impact === 'cosmetic')) {
      corrections.push({ kind: 'severity', defect: i + 1, from: severity, to: 'major', basis: 'localized cosmetic defect' });
      severity = 'major';
    }
    return { ...d, severity };
  });
  return { assessment: { ...assessment, requirements, defects }, corrections };
}

const pick = (source, keys) => Object.fromEntries(keys.map((k) => [k, source[k]]));

export const inspectionOf = (stage) =>
  pick(stage, [
    'rendering',
    'renderEvidence',
    'passes',
    'principles',
    'defects',
    'lessAffected',
    'impactEvidence',
    'confidence',
    'limitations',
    'inferences',
  ]);
export const preferenceOf = (stage) =>
  pick(stage, ['preference', 'preferenceEvidence', 'tieQuality', 'confidence', 'limitations']);

export const placeholderPreference = (inspection) => ({
  preference: 'uncertain',
  preferenceEvidence: inspection.passes.details,
  tieQuality: 'good',
  confidence: 'low',
  limitations: ['The preference stage was not required for this decision.'],
});

// Merge the assessment into the versioned paired-observation contract used by the adjudicator.
export function assembleObservation(assessment) {
  return {
    rendering: assessment.rendering,
    renderEvidence: assessment.renderEvidence,
    requirements: assessment.requirements.map((r) => pick(r, ['excerpt', 'kind', 'scope', 'status', 'evidence'])),
    passes: assessment.passes,
    principles: assessment.principles,
    defects: assessment.defects.map((d) => pick(d, ['side', 'type', 'severity', 'location', 'evidence'])),
    preference: assessment.preference,
    preferenceEvidence: assessment.preferenceEvidence,
    tieQuality: assessment.tieQuality,
    confidence: assessment.confidence,
    limitations: assessment.limitations,
    inferences: assessment.inferences,
    lessAffected: assessment.lessAffected,
    impactEvidence: assessment.impactEvidence,
  };
}

// Swap every paired field so a reversed run can be reported against original candidate identities.
export function swapAssessment(a) {
  const swapPair = (value) => (value && typeof value === 'object' && 'Left' in value && 'Right' in value
    ? { Left: value.Right, Right: value.Left }
    : value);
  const swapSide = (value) => (value === 'Left' ? 'Right' : value === 'Right' ? 'Left' : value);
  const swapObject = (object) => Object.fromEntries(Object.entries(object).map(([k, v]) => [k, swapPair(v)]));
  return {
    ...a,
    rendering: swapPair(a.rendering),
    renderEvidence: swapPair(a.renderEvidence),
    passes: swapObject(a.passes),
    principles: swapObject(a.principles),
    requirements: a.requirements.map((r) => ({
      ...r,
      status: swapPair(r.status),
      evidence: swapPair(r.evidence),
      basis: swapPair(r.basis),
      alternative: swapPair(r.alternative),
      confidence: swapPair(r.confidence),
    })),
    defects: a.defects.map((d) => ({ ...d, side: swapSide(d.side), evidence: swapPair(d.evidence) })),
    lessAffected: swapSide(a.lessAffected),
    impactEvidence: swapPair(a.impactEvidence),
    preference: swapSide(a.preference),
    preferenceEvidence: swapPair(a.preferenceEvidence),
  };
}

const rank = { minor: 1, major: 2, page_broken: 3 };
export const severe = (defects) => defects.some((d) => rank[d.severity] === 3);
export const worstSeverity = (defects) => Math.max(0, ...defects.map((d) => rank[d.severity] || 0));
