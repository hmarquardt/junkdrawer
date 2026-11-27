import { sides, stagesSchema, validateWithSchema } from './contracts.mjs';
import { recoverExcerpt } from './text.mjs';

export const stageSchema = (kind) => stagesSchema[kind];

// Strict structured output needs every property required and local refs expanded.
const expandNode = (node) => {
  if (!node || typeof node !== 'object') return node;
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/$defs/'))
    return expandNode(stagesSchema.$defs[node.$ref.slice(8)]);
  if (Array.isArray(node)) return node.map(expandNode);
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (['$schema', '$comment', '$defs', 'minLength', '$ref'].includes(key)) continue;
    out[key] = expandNode(value);
  }
  return out;
};
export const wireSchema = (kind) => expandNode(JSON.parse(JSON.stringify(stagesSchema[kind])));

export const fillPair = (pair, fallback = 'not described') => {
  if (pair && typeof pair === 'object')
    for (const side of sides)
      if (typeof pair[side] !== 'string' || !pair[side].trim()) pair[side] = fallback;
  return pair;
};

// Architecture B merges the inspection, adherence and preference stage shapes into one call.
export function structuredSchema() {
  const pick = (name, keys) =>
    Object.fromEntries(keys.map((k) => [k, JSON.parse(JSON.stringify(stagesSchema[name].properties[k]))]));
  return expandNode({
    type: 'object',
    properties: {
      ...pick('inspection', Object.keys(stagesSchema.inspection.properties)),
      results: JSON.parse(JSON.stringify(stagesSchema.adherence.properties.results)),
      ...pick('preference', ['preference', 'preferenceEvidence', 'tieQuality']),
    },
    required: [...stagesSchema.inspection.required, 'results', 'preference', 'preferenceEvidence', 'tieQuality'],
    additionalProperties: false,
  });
}

export function validateCompile(data, request) {
  const corrections = [];
  if (Array.isArray(data?.requirements)) {
    const kept = data.requirements.filter((r) => {
      if (typeof r?.excerpt === 'string' && r.excerpt.trim()) return true;
      corrections.push({ kind: 'grounding', id: r?.id, excerpt: r?.excerpt });
      return false;
    });
    data = { ...data, requirements: kept };
  }
  validateWithSchema(data, stagesSchema.compile, 'compile');
  const seen = new Map();
  const aliases = new Map();
  const requirements = [];
  for (const r of data.requirements) {
    const excerpt = recoverExcerpt(request, r.excerpt);
    if (!excerpt) {
      corrections.push({ kind: 'grounding', id: r.id, excerpt: r.excerpt });
      continue;
    }
    let scope = r.scope;
    if (['functionality', 'later_state'].includes(r.kind) && scope === 'visible') {
      scope = r.kind === 'functionality' ? 'unobservable' : 'later';
      corrections.push({ kind: 'applicability', id: r.id, from: r.scope, to: scope, basis: r.kind });
    }
    if (seen.has(excerpt)) {
      aliases.set(r.id, seen.get(excerpt));
      continue;
    }
    seen.set(excerpt, r.id);
    requirements.push({ ...r, scope, excerpt });
  }
  requirements.aliases = aliases;
  requirements.corrections = corrections;
  return requirements;
}

export function validateAdherence(data, requirements, aliases = requirements.aliases || new Map()) {
  for (const result of data?.results || []) {
    fillPair(result.evidence);
    fillPair(result.basis);
  }
  validateWithSchema(data, stagesSchema.adherence, 'adherence');
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const seen = new Set();
  const corrections = [];
  for (const result of data.results) {
    const id = aliases.get(result.id) || result.id;
    const requirement = byId.get(id);
    if (!requirement) throw Error('Adherence references an uncompiled requirement.');
    if (seen.has(id)) continue;
    seen.add(id);
    for (const side of sides) {
      if (requirement.scope !== 'visible' && result.status[side] !== 'excluded') {
        corrections.push({
          kind: 'applicability',
          id,
          side,
          from: result.status[side],
          to: 'excluded',
          basis: requirement.scope,
        });
        result.status[side] = 'excluded';
      }
      if (requirement.scope === 'visible' && result.status[side] === 'excluded') {
        corrections.push({ kind: 'applicability', id, side, from: 'excluded', to: 'uncertain', basis: 'visible scope' });
        result.status[side] = 'uncertain';
      }
    }
  }
  if (seen.size !== requirements.length) throw Error('Adherence omitted a compiled requirement.');
  const assessed = requirements.map((r) => {
    const result = data.results.find((x) => (aliases.get(x.id) || x.id) === r.id);
    return { ...r, ...result };
  });
  assessed.corrections = corrections;
  return assessed;
}

export function validateInspection(data) {
  if (data) {
    fillPair(data.renderEvidence);
    for (const group of [data.passes, data.principles])
      if (group) for (const pair of Object.values(group)) fillPair(pair);
    for (const defect of data.defects || []) {
      if (typeof defect.location !== 'string' || !defect.location.trim()) defect.location = 'not described';
      fillPair(defect.evidence);
    }
  }
  validateWithSchema(data, stagesSchema.inspection, 'inspection');
  return data;
}

export function validatePreference(data) {
  fillPair(data?.preferenceEvidence);
  validateWithSchema(data, stagesSchema.preference, 'preference');
  return data;
}
