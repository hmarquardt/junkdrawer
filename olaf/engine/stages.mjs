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
  validateWithSchema(data, stagesSchema.compile, 'compile');
  const seen = new Map();
  const aliases = new Map();
  const requirements = [];
  for (const r of data.requirements) {
    const excerpt = recoverExcerpt(request, r.excerpt);
    if (!excerpt) throw Error('Compiled requirement is not grounded in the request.');
    if (['functionality', 'later_state'].includes(r.kind) && r.scope === 'visible')
      throw Error('Hidden behavior cannot enter visible scoring.');
    if (seen.has(excerpt)) {
      aliases.set(r.id, seen.get(excerpt));
      continue;
    }
    seen.set(excerpt, r.id);
    requirements.push({ ...r, excerpt });
  }
  requirements.aliases = aliases;
  return requirements;
}

export function validateAdherence(data, requirements, aliases = requirements.aliases || new Map()) {
  validateWithSchema(data, stagesSchema.adherence, 'adherence');
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const seen = new Set();
  for (const result of data.results) {
    const id = aliases.get(result.id) || result.id;
    const requirement = byId.get(id);
    if (!requirement) throw Error('Adherence references an uncompiled requirement.');
    if (seen.has(id)) continue;
    seen.add(id);
    for (const side of sides) {
      if (requirement.scope !== 'visible' && result.status[side] !== 'excluded')
        throw Error('Unobservable requirements must be excluded on both sides.');
      if (requirement.scope === 'visible' && result.status[side] === 'excluded')
        throw Error('Visible requirements cannot be excluded.');
    }
  }
  if (seen.size !== requirements.length) throw Error('Adherence omitted a compiled requirement.');
  return requirements.map((r) => {
    const result = data.results.find((x) => (aliases.get(x.id) || x.id) === r.id);
    return { ...r, ...result };
  });
}

export function validateInspection(data) {
  validateWithSchema(data, stagesSchema.inspection, 'inspection');
  for (const defect of data.defects) {
    if (defect.severity === 'page_broken' && (defect.scope === 'localized' || defect.impact === 'cosmetic'))
      throw Error('A localized cosmetic defect cannot be page-broken.');
    if (defect.impact === 'unreadable' && defect.scope === 'localized' && defect.severity === 'minor')
      throw Error('Unreadable localized content is at least a major defect.');
  }
  return data;
}

export function validatePreference(data) {
  validateWithSchema(data, stagesSchema.preference, 'preference');
  return data;
}
