import { pair, swap, other, validateTask, validateObservation } from './contracts.mjs';
import { evaluate, buildResult, mapReverse, validateResult } from './evaluate.mjs';
import { adjudicateDetailed } from './adjudicate.mjs';
import {
  assembleObservation,
  normalizeAssessment,
  normalizePerception,
  inspectionOf,
  preferenceOf,
  placeholderPreference,
  swapAssessment,
} from './assessment.mjs';
import {
  validateCompile,
  validateAdherence,
  validateInspection,
  validatePreference,
} from './stages.mjs';
import { validateWithSchema, stagesSchema } from './contracts.mjs';
import { claimsFor, validateVerify, applyVerification } from './verify.mjs';
import { recoverExcerpt } from './text.mjs';

export const architectures = ['a', 'b', 'c', 'd'];
export const architectureNames = {
  a: 'Single pass',
  b: 'Structured perception',
  c: 'Staged evaluation',
  d: 'Targeted verification',
};

const aggregate = (stages, provider, model) => ({
  provider: provider.name,
  model: stages.find((s) => s.model)?.model || model,
  latencyMs: stages.reduce((n, s) => n + (s.latencyMs || 0), 0),
  inputTokens: stages.every((s) => s.inputTokens != null) ? stages.reduce((n, s) => n + s.inputTokens, 0) : null,
  outputTokens: stages.every((s) => s.outputTokens != null) ? stages.reduce((n, s) => n + s.outputTokens, 0) : null,
  estimatedUsd: stages.every((s) => s.estimatedUsd != null) ? stages.reduce((n, s) => n + s.estimatedUsd, 0) : null,
});

// Native-resolution horizontal bands used by targeted verification. Sources are never modified.
export function cropRegions(task, bands = 3) {
  const regions = [];
  for (const side of ['Left', 'Right']) {
    const height = task.images[side].height;
    for (let i = 0; i < bands; i++) {
      const y0 = Math.round((height * i) / bands);
      const y1 = Math.round((height * (i + 1)) / bands);
      regions.push({ side, label: side + ' region ' + (i + 1) + ' of ' + bands, y0, y1 });
    }
  }
  return regions;
}

function stageRunner(task, provider, options) {
  const stages = [];
  async function call(kind, extra = {}) {
    options.signal?.throwIfAborted();
    const start = performance.now();
    const out = await provider.stage(kind, {
      task,
      model: options.model,
      signal: options.signal,
      diagnostic: options.diagnostic,
      ...extra,
    });
    options.signal?.throwIfAborted();
    const telemetry = {
      stage: kind,
      provider: provider.name,
      model: out.model || options.model,
      latencyMs: Math.round(performance.now() - start),
      inputTokens: out.usage?.inputTokens ?? null,
      outputTokens: out.usage?.outputTokens ?? null,
      estimatedUsd: out.usage?.estimatedUsd ?? null,
    };
    stages.push(telemetry);
    return { data: out.data, telemetry, crops: out.crops || [] };
  }
  return { call, stages };
}

function structuredSchemas() {
  const inspection = stagesSchema.inspection;
  const pick = (keys) => Object.fromEntries(keys.map((k) => [k, inspection.properties[k]]));
  return {
    type: 'object',
    properties: {
      ...pick(Object.keys(inspection.properties)),
      results: stagesSchema.adherence.properties.results,
      preference: stagesSchema.preference.properties.preference,
      preferenceEvidence: stagesSchema.preference.properties.preferenceEvidence,
      tieQuality: stagesSchema.preference.properties.tieQuality,
    },
    required: [...inspection.required, 'results', 'preference', 'preferenceEvidence', 'tieQuality'],
    additionalProperties: false,
  };
}


function mergeStructured(data, requirements) {
  validateWithSchema(data, structuredSchemas(), 'structured');
  const assessed = validateAdherence({ results: data.results }, requirements);
  const inspection = validateInspection(inspectionOf(data));
  const preference = validatePreference(preferenceOf(data));
  return { requirements: assessed, inspection, preference };
}

function decideWithoutPreference(observation) {
  const probe = adjudicateDetailed({ ...observation, preference: 'uncertain' });
  const last = probe.trace.at(-1);
  return last?.step === 'review' && last.detail === 'no reliable preference evidence' ? 'needed' : 'settled';
}

async function runStaged(task, provider, options, architecture) {
  const runner = stageRunner(task, provider, options);
  const compiled = await runner.call('compile');
  const requirements = validateCompile(compiled.data, task.request);
  const diagnostics = { architecture, compiled, corrections: [], verification: null };
  let assessment;
  if (architecture === 'b') {
    const structured = await runner.call('structured', { requirements });
    const merged = mergeStructured(structured.data, requirements);
    assessment = {
      ...merged.inspection,
      ...merged.preference,
      requirements: merged.requirements,
    };
  } else {
    const [adherence, inspection] = await Promise.all([
      runner.call('adherence', { requirements }),
      runner.call('inspection'),
    ]);
    const results = validateAdherence(adherence.data, requirements);
    const inspected = validateInspection(inspection.data);
    let preference = placeholderPreference(inspected);
    const preview = assembleObservation({ ...inspected, ...preference, requirements: results });
    if (decideWithoutPreference(preview) === 'needed') {
      const pref = await runner.call('preference', {
        requirements: results.map((r) => ({
          excerpt: r.excerpt,
          status: r.status,
          evidence: r.evidence,
        })),
      });
      preference = validatePreference(pref.data);
    }
    assessment = { ...inspected, ...preference, requirements: results };
  }
  const normalized = normalizeAssessment(assessment);
  diagnostics.corrections = normalized.corrections;
  diagnostics.requirements = normalized.assessment.requirements;
  const observation = assembleObservation(normalized.assessment);
  validateObservation(observation, task);
  const result = buildResult(task, observation, aggregate(runner.stages, provider, options.model), {
    ...diagnostics,
    stages: runner.stages,
  });
  return { result, assessment: normalized.assessment, stages: runner.stages };
}

async function runVerification(task, provider, options) {
  const runner = stageRunner(task, provider, options);
  const start = performance.now();
  const observed = await provider.observe(task, {
    model: options.model,
    signal: options.signal,
    diagnostic: options.diagnostic,
  });
  const telemetry = {
    stage: 'observe',
    provider: provider.name,
    model: observed.model || options.model,
    latencyMs: Math.round(performance.now() - start),
    inputTokens: observed.usage?.inputTokens ?? null,
    outputTokens: observed.usage?.outputTokens ?? null,
    estimatedUsd: observed.usage?.estimatedUsd ?? null,
  };
  runner.stages.push(telemetry);
  let observation = recoverRequirements(structuredClone(observed.observation), task.request);
  const guard = normalizePerception(observation);
  observation = guard.observation;
  validateObservation(observation, task);
  const claims = claimsFor(observation).slice(0, 8);
  const verification = { claims: claims.length, checks: [], corrections: guard.corrections, crops: [] };
  if (claims.length) {
    const verified = await runner.call('verify', { claims, crops: cropRegions(task) });
    const checked = validateVerify(verified.data, claims);
    const applied = applyVerification(observation, checked, claims);
    observation = applied.observation;
    verification.checks = checked.checks;
    verification.corrections = [...guard.corrections, ...applied.corrections];
    verification.crops = verified.crops;
  }
  validateObservation(observation, task);
  const result = buildResult(task, observation, aggregate(runner.stages, provider, options.model), {
    architecture: 'd',
    verification,
    stages: runner.stages,
    corrections: [],
  });
  return { result, assessment: null, stages: runner.stages };
}

function recoverRequirements(observation, request) {
  for (const r of observation.requirements || []) {
    if (typeof r?.excerpt !== 'string' || request.includes(r.excerpt)) continue;
    const recovered = recoverExcerpt(request, r.excerpt);
    if (recovered) r.excerpt = recovered;
  }
  return observation;
}

// Compare per-stage observations after mapping the reversed run back to original identities.
export function orderComparison(forward, mappedReversed) {
  if (!forward || !mappedReversed) return null;
  const requirementFlips = [];
  const byId = new Map(mappedReversed.requirements.map((r) => [r.id || r.excerpt, r]));
  forward.requirements.forEach((r, i) => {
    const counterpart = byId.get(r.id || r.excerpt) || mappedReversed.requirements[i];
    if (!counterpart) return;
    for (const side of ['Left', 'Right'])
      if (r.status[side] !== counterpart.status[side])
        requirementFlips.push({ excerpt: r.excerpt, side, first: r.status[side], reversed: counterpart.status[side] });
  });
  const severity = (a) =>
    Object.fromEntries(
      ['Left', 'Right'].map((side) => [
        side,
        Math.max(
          0,
          ...a.defects.filter((d) => d.side === side).map((d) => ({ minor: 1, major: 2, page_broken: 3 })[d.severity]),
        ),
      ]),
    );
  return {
    requirementFlips,
    severityFlips: ['Left', 'Right'].filter((side) => severity(forward)[side] !== severity(mappedReversed)[side]),
    preferenceFlip: forward.preference !== mappedReversed.preference,
  };
}

export async function evaluateArchitecture(
  task,
  provider,
  {
    architecture = 'a',
    model,
    signal,
    reverse = false,
    diagnostic = false,
    timeoutMs = 95000,
    progress = () => {},
  } = {},
) {
  if (!architectures.includes(architecture)) throw Error('Unknown evaluation architecture.');
  task = structuredClone(validateTask(task));
  const timed = AbortSignal.timeout(timeoutMs);
  const options = { model, diagnostic, signal: signal ? AbortSignal.any([timed, signal]) : timed };
  const run = async (input) => {
    options.signal.throwIfAborted();
    if (architecture === 'a') {
      progress('Inspecting the confirmed pair…');
      const result = await evaluate(input, provider, {
        model,
        signal: options.signal,
        diagnostic,
        timeoutMs,
      });
      return { result, assessment: null, stages: [result.telemetry] };
    }
    progress(
      architecture === 'd'
        ? 'Inspecting the confirmed pair before targeted verification…'
        : 'Compiling explicit visual requirements…',
    );
    return architecture === 'd'
      ? runVerification(input, provider, options)
      : runStaged(input, provider, options, architecture);
  };
  const forward = await run(task);
  const result = forward.result;
  if (reverse) {
    progress('Verifying with reversed image order…');
    const reversed = await run(swap(task));
    const mappedDecision = mapReverse(reversed.result.decision);
    const mappedAssessment = reversed.assessment ? swapAssessment(reversed.assessment) : null;
    result.verification = {
      reversedDecision: reversed.result.decision,
      mappedDecision,
      reversedStage: reversed.result.stage,
      candidateIds: reversed.result.candidateIds,
      consistent: mappedDecision === result.decision,
      telemetry: reversed.result.telemetry,
    };
    if (!result.verification.consistent) result.confidence = 'low';
    const comparison = orderComparison(forward.assessment, mappedAssessment);
    if (comparison) result.diagnostics.order = comparison;
    result.diagnostics.reversed = {
      decision: reversed.result.decision,
      stage: reversed.result.stage,
      stages: reversed.result.diagnostics?.stages || [],
      observation: reversed.result.observation,
      assessment: mappedAssessment,
    };
  }
  return validateResult(result, task);
}

