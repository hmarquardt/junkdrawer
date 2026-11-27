// Phase 2 benchmark dataset. References were fixed from the fixture construction and rubric before inference.
// Objective cases carry a decision and stage implied by the constructed pixels; subjective cases carry no decision.
import { legacyCases } from './legacy.mjs';

export const P = 'Use a purple “View collection” button.';
export const E = 'Design an exhibition page about computing pioneers.';
const content = { excerpt: E, kind: 'content', scope: 'visible', status: { Left: 'met', Right: 'met' } };
const req = (excerpt, kind, status, scope = 'visible') => ({ excerpt, kind, scope, status });
const met = (left, right) => ({ Left: left, Right: right });
const bug = (side, type, severity) => ({ side, type, severity });

function make(id, split, category, request, left, right, reference, extra = {}) {
  return {
    id,
    split,
    category,
    request,
    left,
    right,
    objective: reference.decision !== null,
    reference: { certainty: 'constructed', ...reference },
    requirements: [],
    defects: [],
    vocabulary: ['heading', 'button', 'portrait', 'footer'],
    absent: ['modal', 'chart', 'tooltip', 'video', 'notification banner'],
    ...extra,
  };
}

export const newCases = [
  make('clip-severe', 'dev', 'defect', E, 'clip40', 'standard',
    { decision: 'Right', stage: 'disqualifiers' }, {
      requirements: [content],
      defects: [bug('Left', 'clipping', 'major')],
      vocabulary: ['heading', 'title', 'letter'],
    }),
  make('clip-subtle', 'dev', 'defect', E, 'clip56', 'standard',
    { decision: 'Right', stage: 'disqualifiers' }, {
      requirements: [content],
      defects: [bug('Left', 'clipping', 'minor')],
      vocabulary: ['heading', 'bottom', 'descender'],
    }),
  make('clip-small-text', 'dev', 'defect', E, 'clipsmall', 'standard',
    { decision: 'Right', stage: 'disqualifiers' }, {
      requirements: [content],
      defects: [bug('Left', 'clipping', 'minor')],
      vocabulary: ['paragraph', 'text', 'line'],
    }),
  make('clip-font-size', 'dev', 'defect', E, 'cliplarge', 'clipsmall',
    { decision: 'Right', stage: 'disqualifiers' }, {
      requirements: [content],
      defects: [bug('Left', 'clipping', 'major'), bug('Right', 'clipping', 'minor')],
      vocabulary: ['heading', 'text', 'line'],
    }),
  make('ellipsis-legitimate', 'dev', 'preference', E, 'ellipsis', 'standard',
    { decision: null, stage: 'preference_or_tie' }, {
      requirements: [content],
      vocabulary: ['text', 'ellipsis', 'paragraph'],
    }),
  make('overlap-severe', 'dev', 'defect', E, 'overlapsevere', 'standard',
    { decision: 'Right', stage: 'disqualifiers' }, {
      requirements: [content],
      defects: [bug('Left', 'overlap', 'major')],
      vocabulary: ['heading', 'button', 'paragraph'],
    }),
  make('overlap-subtle', 'dev', 'defect', E, 'overlapsubtle', 'standard',
    { decision: 'Right', stage: 'disqualifiers' }, {
      requirements: [content],
      defects: [bug('Left', 'overlap', 'minor')],
      vocabulary: ['heading', 'paragraph', 'text'],
    }),
  make('layering-intentional', 'dev', 'adherence', E + ' Include an archive badge on the portrait.',
    'seal', 'standard', { decision: 'Left', stage: 'prompt_adherence' }, {
      requirements: [req('Include an archive badge on the portrait', 'component', met('met', 'missing'))],
      vocabulary: ['badge', 'archive', 'portrait'],
    }),
  make('contrast-severe', 'dev', 'defect', E, 'contrast', 'standard',
    { decision: 'Right', stage: 'disqualifiers' }, {
      requirements: [content],
      defects: [bug('Left', 'contrast', 'major')],
      vocabulary: ['paragraph', 'text', 'background'],
    }),
  make('contrast-moderate', 'dev', 'defect', E, 'contrastmoderate', 'standard',
    { decision: 'Right', stage: 'disqualifiers' }, {
      requirements: [content],
      defects: [bug('Left', 'contrast', 'major')],
      vocabulary: ['paragraph', 'text', 'contrast'],
    }),
  make('contrast-mild', 'dev', 'preference', E, 'contrastmild', 'standard',
    { decision: null, stage: 'preference_or_tie' }, {
      requirements: [content],
      vocabulary: ['paragraph', 'text', 'contrast'],
    }),
  make('page-washed', 'dev', 'defect', E, 'washed', 'standard',
    { decision: 'Right', stage: 'disqualifiers' }, {
      requirements: [content],
      defects: [bug('Left', 'contrast', 'page_broken')],
      vocabulary: ['text', 'heading', 'button'],
    }),
  make('both-page-broken', 'dev', 'precedence', E, 'washed', 'redbroken',
    { decision: 'REVIEW', stage: 'review' }, {
      requirements: [content],
      defects: [bug('Left', 'contrast', 'page_broken'), bug('Right', 'contrast', 'page_broken')],
      vocabulary: ['text', 'heading', 'button'],
    }),
  make('disabled-request', 'dev', 'adherence', 'Show the collection button in a disabled state.',
    'disabled', 'standard', { decision: 'Left', stage: 'prompt_adherence' }, {
      requirements: [req('disabled state', 'style', met('met', 'missing'))],
      vocabulary: ['button', 'disabled', 'gray'],
    }),
  make('disabled-faint', 'dev', 'adherence', 'Show the collection button in a disabled state.',
    'disabledfaint', 'standard', { decision: 'Left', stage: 'prompt_adherence' }, {
      requirements: [req('disabled state', 'style', met('met', 'missing'))],
      vocabulary: ['button', 'disabled', 'faint'],
    }),
  make('rounded-equivalent', 'dev', 'equivalence', 'Use rounded corners on the button.',
    'roundsmall', 'round', { decision: 'Tie', stage: 'tie' }, {
      requirements: [req('rounded corners on the button', 'style', met('met', 'met'))],
      vocabulary: ['button', 'corner', 'radius'],
    }),
  make('color-family', 'dev', 'equivalence', 'Use a purple button.',
    'violet', 'plum', { decision: 'Tie', stage: 'tie' }, {
      requirements: [req('purple button', 'style', met('met', 'met'))],
      vocabulary: ['button', 'purple', 'violet', 'plum'],
    }),
  make('color-outside-family', 'dev', 'adherence', 'Use a purple button.',
    'plum', 'red', { decision: 'Left', stage: 'prompt_adherence' }, {
      requirements: [req('purple button', 'style', met('met', 'missing'))],
      vocabulary: ['button', 'purple', 'red'],
    }),
  make('layout-alternative', 'dev', 'preference', E, 'alters', 'standard',
    { decision: null, stage: 'preference_or_tie' }, {
      requirements: [content],
      vocabulary: ['heading', 'portrait', 'column'],
    }),
  make('polish-vs-adherence', 'dev', 'adherence', P, 'polishedred', 'standard',
    { decision: 'Right', stage: 'prompt_adherence' }, {
      requirements: [req(P, 'style', met('missing', 'met'))],
      vocabulary: ['button', 'purple', 'red'],
    }),
  make('explicit-vs-catastrophic', 'dev', 'precedence', P, 'purplebroken', 'red',
    { decision: 'Right', stage: 'disqualifiers' }, {
      requirements: [req(P, 'style', met('met', 'missing'))],
      defects: [bug('Left', 'contrast', 'page_broken')],
      vocabulary: ['text', 'button', 'page'],
    }),
  make('compact-heading', 'dev', 'adherence', 'Use a compact heading.',
    'tight', 'standard', { decision: 'Left', stage: 'prompt_adherence' }, {
      requirements: [req('compact heading', 'style', met('met', 'missing'))],
      vocabulary: ['heading', 'title'],
    }),
  make('genuine-tie', 'dev', 'tie', E, 'standard', 'standardcopy',
    { decision: 'Tie', stage: 'tie' }, {
      requirements: [content],
      vocabulary: ['heading', 'portrait', 'button'],
    }),
  make('missing-label', 'dev', 'adherence', 'Include a visible View collection button.',
    'missinglabel', 'standard', { decision: 'Right', stage: 'prompt_adherence' }, {
      requirements: [req('visible View collection button', 'component', met('missing', 'met'))],
      vocabulary: ['button', 'label', 'collection'],
    }),
  make('missing-section', 'dev', 'adherence', 'Include a section label above the heading.',
    'missingaside', 'standard', { decision: 'Right', stage: 'prompt_adherence' }, {
      requirements: [req('section label above the heading', 'component', met('missing', 'met'))],
      vocabulary: ['label', 'section', 'heading'],
    }),
  make('offscreen-search', 'dev', 'applicability', 'Include a search field.',
    'offsearch', 'standard', { decision: 'Tie', stage: 'tie' }, {
      requirements: [req('search field', 'component', met('missing', 'missing'))],
      vocabulary: ['search', 'field', 'heading'],
    }),
  make('offscreen-cta', 'dev', 'applicability',
    'Include a prominent View collection button above the fold.',
    'offcta', 'standard', { decision: 'Right', stage: 'prompt_adherence' }, {
      requirements: [
        req('prominent View collection button above the fold', 'component', met('missing', 'met')),
      ],
      vocabulary: ['button', 'collection', 'fold'],
    }),
  make('later-state', 'dev', 'applicability',
    'Use a purple button and a working search on the next screen.',
    'standard', 'red', { decision: 'Left', stage: 'prompt_adherence' }, {
      requirements: [
        req('Use a purple button', 'style', met('met', 'missing')),
        req('working search on the next screen', 'later_state', met('excluded', 'excluded'), 'later'),
      ],
      vocabulary: ['button', 'purple', 'screen'],
    }),
  make('functionality-only', 'dev', 'applicability',
    'Make the collection button open a working search.',
    'standard', 'standardcopy', { decision: 'Tie', stage: 'tie' }, {
      requirements: [req('working search', 'functionality', met('excluded', 'excluded'), 'unobservable')],
      vocabulary: ['button', 'search', 'layout'],
    }),
  make('position-left', 'dev', 'position', P, 'standard', 'red',
    { decision: 'Left', stage: 'prompt_adherence' }, {
      requirements: [req(P, 'style', met('met', 'missing'))],
      vocabulary: ['button', 'purple'],
    }),
  make('position-right', 'dev', 'position', P, 'red', 'standard',
    { decision: 'Right', stage: 'prompt_adherence' }, {
      requirements: [req(P, 'style', met('missing', 'met'))],
      vocabulary: ['button', 'purple'],
    }),
  make('cta-label-contrast', 'dev', 'defect', P, 'ctafaint', 'standard',
    { decision: 'Right', stage: 'disqualifiers' }, {
      requirements: [req(P, 'style', met('met', 'met'))],
      defects: [bug('Left', 'contrast', 'major')],
      vocabulary: ['button', 'label', 'text'],
    }),
  make('holdout-clip-levels', 'holdout', 'defect', E, 'clip40', 'clip56',
    { decision: 'Right', stage: 'disqualifiers' }, {
      requirements: [content],
      defects: [bug('Left', 'clipping', 'major'), bug('Right', 'clipping', 'minor')],
      vocabulary: ['heading', 'bottom', 'text'],
    }),
  make('holdout-contrast-levels', 'holdout', 'defect', E, 'contrast', 'contrastmoderate',
    { decision: 'Right', stage: 'disqualifiers', lessAffected: 'Right' }, {
      requirements: [content],
      defects: [bug('Left', 'contrast', 'major'), bug('Right', 'contrast', 'major')],
      vocabulary: ['paragraph', 'text', 'contrast'],
    }),
  make('holdout-overlap-vs-clip', 'holdout', 'defect', E, 'overlap', 'clip',
    { decision: 'Right', stage: 'disqualifiers', lessAffected: 'Right', certainty: 'provisional' }, {
      requirements: [content],
      defects: [bug('Left', 'overlap', 'major'), bug('Right', 'clipping', 'major')],
      vocabulary: ['heading', 'paragraph', 'text'],
    }),
  make('holdout-both-broken', 'holdout', 'precedence', P, 'purplebroken', 'washed',
    { decision: 'REVIEW', stage: 'review' }, {
      requirements: [req(P, 'style', met('met', 'met'))],
      defects: [bug('Left', 'contrast', 'page_broken'), bug('Right', 'contrast', 'page_broken')],
      vocabulary: ['text', 'button', 'page'],
    }),
  make('holdout-ellipsis-vs-clip', 'holdout', 'defect', E, 'ellipsis', 'clip',
    { decision: 'Left', stage: 'disqualifiers' }, {
      requirements: [content],
      defects: [bug('Right', 'clipping', 'major')],
      vocabulary: ['text', 'paragraph', 'heading'],
    }),
  make('holdout-disabled-vs-missing', 'holdout', 'adherence',
    'Show the collection button in a disabled state.',
    'disabled', 'missing', { decision: 'Left', stage: 'prompt_adherence' }, {
      requirements: [req('disabled state', 'style', met('met', 'missing'))],
      vocabulary: ['button', 'disabled', 'gray'],
    }),
  make('holdout-shift-minor', 'holdout', 'adherence',
    E + ' Align the footer with the header.',
    'shiftminor', 'standard', { decision: 'Right', stage: 'prompt_adherence' }, {
      requirements: [req('Align the footer with the header', 'layout', met('missing', 'met'))],
      vocabulary: ['footer', 'header', 'edge'],
    }),
  make('holdout-placeholder-vs-broken', 'holdout', 'defect', E,
    'imageryplaceholder', 'broken', { decision: 'Left', stage: 'disqualifiers' }, {
      requirements: [content],
      defects: [bug('Right', 'imagery', 'major')],
      vocabulary: ['image', 'portrait', 'preview'],
    }),
  make('holdout-polish-vs-purple', 'holdout', 'adherence', P,
    'polishedred', 'plum', { decision: 'Right', stage: 'prompt_adherence' }, {
      requirements: [req(P, 'style', met('missing', 'met'))],
      vocabulary: ['button', 'purple', 'red'],
    }),
  make('holdout-color-family', 'holdout', 'equivalence', 'Use a purple button.',
    'standard', 'violet', { decision: 'Tie', stage: 'tie' }, {
      requirements: [req('purple button', 'style', met('met', 'met'))],
      vocabulary: ['button', 'purple', 'violet'],
    }),
  make('holdout-photo-request', 'holdout', 'adherence', 'Use a photographic portrait.',
    'photo', 'standard', { decision: 'Left', stage: 'prompt_adherence' }, {
      requirements: [req('photographic portrait', 'content', met('met', 'missing'))],
      vocabulary: ['portrait', 'photograph', 'illustration'],
    }),
  make('holdout-illustrated-request', 'holdout', 'adherence', 'Show an illustrated portrait.',
    'standard', 'photo', { decision: 'Left', stage: 'prompt_adherence' }, {
      requirements: [req('illustrated portrait', 'content', met('met', 'missing'))],
      vocabulary: ['portrait', 'illustration', 'photograph'],
    }),
  make('holdout-both-missing', 'holdout', 'tie', 'Include a visible View collection button.',
    'empty', 'empty2', { decision: 'Tie', stage: 'tie' }, {
      requirements: [req('visible View collection button', 'component', met('missing', 'missing'))],
      vocabulary: ['button', 'page', 'header'],
    }),
  make('holdout-noncompliant-aesthetic', 'holdout', 'adherence', 'Use a compact heading.',
    'airy', 'tight', { decision: 'Right', stage: 'prompt_adherence' }, {
      requirements: [req('compact heading', 'style', met('missing', 'met'))],
      vocabulary: ['heading', 'spacing', 'title'],
    }),
  make('holdout-position-rounded', 'holdout', 'position', 'Use rounded corners on the button.',
    'round', 'roundsmall', { decision: 'Tie', stage: 'tie' }, {
      requirements: [req('rounded corners on the button', 'style', met('met', 'met'))],
      vocabulary: ['button', 'corner', 'radius'],
    }),
  make('holdout-purple-missing-vs-broken', 'holdout', 'precedence', P,
    'missinglabel', 'purplebroken', { decision: 'Left', stage: 'disqualifiers' }, {
      requirements: [req(P, 'style', met('missing', 'met'))],
      defects: [bug('Right', 'contrast', 'page_broken')],
      vocabulary: ['button', 'label', 'text'],
    }),
];

export const cases = [...legacyCases, ...newCases];
export const imageNames = [...new Set(cases.flatMap((c) => [c.left, c.right]))].sort();
export const splitCases = (split) => cases.filter((c) => split === 'all' || c.split === split);

const evidenceFor = (status, noun) =>
  ({
    met: `the ${noun} is visible and matches the request`,
    alternative: `the ${noun} uses a reasonable alternative implementation`,
    missing: `the ${noun} is absent from this capture`,
    uncertain: `the ${noun} cannot be confirmed at this resolution`,
    excluded: `this capture cannot show the ${noun}`,
  })[status];
const locationFor = {
  overlap: 'heading area',
  clipping: 'heading text',
  imagery: 'portrait slot',
  alignment: 'footer edge',
  layout: 'page structure',
  contrast: 'body text',
};
// Build the canonical observation implied by a constructed reference. Used only for offline
// precedence tests and for scoring model observations; never sent to a provider.
export function referenceObservation(c) {
  const noun = c.vocabulary[0] || 'element';
  const secondary = c.vocabulary[1] || 'footer';
  const pairText = (text) => ({ Left: text, Right: text });
  const requirements = c.requirements.map((r) => ({
    excerpt: r.excerpt,
    kind: r.kind,
    scope: r.scope,
    status: { ...r.status },
    evidence: {
      Left: evidenceFor(r.status.Left, noun),
      Right: evidenceFor(r.status.Right, noun),
    },
  }));
  const defects = c.defects.map((d) => {
    const location = locationFor[d.type] || noun;
    return {
      side: d.side,
      type: d.type,
      severity: d.severity,
      location,
      evidence: {
        Left: d.side === 'Left' ? `the ${location} is damaged by ${d.type}` : `the ${location} is intact`,
        Right: d.side === 'Right' ? `the ${location} is damaged by ${d.type}` : `the ${location} is intact`,
      },
    };
  });
  const stage = c.reference.stage;
  const preference =
    stage === 'tie'
      ? 'Tie'
      : stage === 'preference'
        ? c.reference.decision || 'Left'
        : stage === 'preference_or_tie'
          ? 'Left'
          : 'uncertain';
  return {
    rendering: pairText('rendered'),
    renderEvidence: pairText(`the ${noun} and ${secondary} are visible`),
    requirements,
    passes: Object.fromEntries(
      ['first_look', 'structure', 'type', 'color', 'details'].map((k) => [
        k,
        pairText(`the ${noun} sits in the main content area`),
      ]),
    ),
    principles: Object.fromEntries(
      ['hierarchy', 'grid', 'spacing', 'alignment', 'typography', 'color', 'contrast', 'consistency'].map((k) => [
        k,
        pairText(`the ${noun} and ${secondary} share a consistent style`),
      ]),
    ),
    defects,
    lessAffected: c.reference.lessAffected || 'comparable',
    impactEvidence: pairText(`the ${noun} keeps the main content readable`),
    preference,
    preferenceEvidence: pairText(`the ${noun} is clearly visible beside the ${secondary}`),
    tieQuality: 'good',
    confidence: 'high',
    limitations: [],
    inferences: [],
  };
}
