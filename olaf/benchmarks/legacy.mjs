// Structured references for the original 16 cases. Requests, images and expected decisions are unchanged;
// this module only adds the requirement and defect facts implied by each fixture construction.
import { cases } from './cases.mjs';

const P = 'Use a purple “View collection” button.';
const E = 'Design an exhibition page about computing pioneers.';
const content = { excerpt: E, kind: 'content', scope: 'visible', status: { Left: 'met', Right: 'met' } };
const refs = {
  button: {
    requirements: [{ excerpt: P, kind: 'style', scope: 'visible', status: { Left: 'met', Right: 'missing' } }],
    vocabulary: ['button', 'purple'],
  },
  illustration: {
    requirements: [
      {
        excerpt: 'Show an illustrated portrait.',
        kind: 'content',
        scope: 'visible',
        status: { Left: 'missing', Right: 'met' },
      },
    ],
    vocabulary: ['portrait', 'illustration'],
  },
  component: {
    requirements: [
      {
        excerpt: 'Include a visible View collection button.',
        kind: 'component',
        scope: 'visible',
        status: { Left: 'missing', Right: 'met' },
      },
    ],
    vocabulary: ['button', 'collection'],
  },
  interpretation: {
    requirements: [
      {
        excerpt: 'Use a rounded button.',
        kind: 'style',
        scope: 'visible',
        status: { Left: 'met', Right: 'met' },
      },
    ],
    vocabulary: ['button', 'corner'],
  },
  overlap: { requirements: [content], defects: [{ side: 'Right', type: 'overlap', severity: 'major' }] },
  clipping: { requirements: [content], defects: [{ side: 'Left', type: 'clipping', severity: 'major' }] },
  imagery: { requirements: [content], defects: [{ side: 'Right', type: 'imagery', severity: 'major' }] },
  alignment: {
    requirements: [
      {
        excerpt: 'Align the footer with the header',
        kind: 'layout',
        scope: 'visible',
        status: { Left: 'missing', Right: 'met' },
      },
    ],
  },
  contrast: { requirements: [content], defects: [{ side: 'Left', type: 'contrast', severity: 'major' }] },
  hierarchy: { requirements: [content] },
  layering: {
    requirements: [
      {
        excerpt: 'Include an archive badge on the portrait',
        kind: 'component',
        scope: 'visible',
        status: { Left: 'met', Right: 'missing' },
      },
    ],
  },
  'adherence-over-polish': {
    requirements: [
      {
        excerpt: 'Use a compact heading',
        kind: 'style',
        scope: 'visible',
        status: { Left: 'met', Right: 'missing' },
      },
    ],
  },
  severe: {
    requirements: [{ excerpt: P, kind: 'style', scope: 'visible', status: { Left: 'met', Right: 'missing' } }],
    defects: [{ side: 'Left', type: 'contrast', severity: 'page_broken' }],
  },
  competing: {
    requirements: [content],
    defects: [
      { side: 'Left', type: 'clipping', severity: 'major' },
      { side: 'Right', type: 'contrast', severity: 'page_broken' },
    ],
  },
  tie: { requirements: [content] },
  functionality: {
    requirements: [
      {
        excerpt: 'working search',
        kind: 'functionality',
        scope: 'unobservable',
        status: { Left: 'excluded', Right: 'excluded' },
      },
    ],
  },
};
const categories = {
  button: 'adherence',
  illustration: 'adherence',
  component: 'adherence',
  interpretation: 'equivalence',
  overlap: 'defect',
  clipping: 'defect',
  imagery: 'defect',
  alignment: 'adherence',
  contrast: 'defect',
  hierarchy: 'preference',
  layering: 'adherence',
  'adherence-over-polish': 'adherence',
  severe: 'precedence',
  competing: 'precedence',
  tie: 'tie',
  functionality: 'applicability',
};
export const legacyCases = cases.map((c) => ({
  ...c,
  split: 'legacy',
  category: categories[c.id],
  objective: c.decision !== null && c.id !== 'hierarchy',
  reference: {
    decision: c.decision,
    stage: c.stage,
    certainty: c.id === 'hierarchy' ? 'provisional' : 'constructed',
  },
  requirements: refs[c.id].requirements,
  defects: refs[c.id].defects || [],
  vocabulary: refs[c.id].vocabulary || ['heading', 'button', 'portrait', 'footer'],
  absent: ['search field', 'modal', 'chart', 'tooltip', 'video'],
}));
