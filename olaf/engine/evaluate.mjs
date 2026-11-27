import { pair, swap, other, validateTask, validateObservation, validateShape } from './contracts.mjs';
import { adjudicate, explain } from './adjudicate.mjs';
export function validateResult(result, task) {
  validateShape(result);
  validateObservation(result.observation, task);
  const expected = adjudicate(result.observation);
  if (
    result.taskId !== task.id ||
    ['Left', 'Right'].some((s) => result.candidateIds[s] !== task.images[s].id) ||
    expected.decision !== result.decision ||
    expected.stage !== result.stage ||
    result.captureScope !== task.captureScope ||
    result.confidence !==
      (expected.decision === 'REVIEW' || result.verification?.consistent === false
        ? 'low'
        : result.observation.confidence) ||
    ['Left', 'Right'].some((s) =>
      ['width', 'height', 'mime'].some((k) => result.captures[s][k] !== task.images[s][k]),
    ) ||
    ['Left', 'Right'].some((s) => expected.evidence[s] !== result.evidence[s]) ||
    result.why !== explain(expected, result.observation)
  )
    throw Error('Result conflicts with decision evidence.');
  const sentences = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(result.why)];
  if (
    result.decision !== 'REVIEW' &&
    Object.values(result.evidence).some((clause) =>
      /\b(?:Left|Right) is better|\bit is a tie|\b(?:button|link|filter) (?:works|responds)(?:\b|$)/i.test(
        clause,
      ),
    )
  )
    throw Error('Evidence contains a verdict or an unobservable claim.');
  if (
    sentences.length < 2 ||
    sentences.length > 3 ||
    /\b(?:website|candidate|option|design|image|screenshot)\s+[AB]\b|\b(?:first|second) (?:design|candidate|option|screenshot)\b|\b(?:I (?:like|prefer)|clicking works)\b/i.test(
      result.why,
    )
  )
    throw Error('Comparative explanation failed the style check.');
  if (result.verification) {
    const v = result.verification;
    if (
      ['Left', 'Right'].some((s) => v.candidateIds[s] !== result.candidateIds[other(s)]) ||
      v.mappedDecision !== mapReverse(v.reversedDecision) ||
      v.consistent !== (v.mappedDecision === result.decision)
    )
      throw Error('Invalid reverse-order mapping.');
  }
  return result;
}
export const mapReverse = (d) => (['Left', 'Right'].includes(d) ? other(d) : d);
export async function evaluate(
  task,
  provider,
  { model, signal, reverse = false, diagnostic = false, timeoutMs = 95000, progress = () => {} } = {},
) {
  task = structuredClone(validateTask(task));
  const attempts = [];
  async function run(input) {
    signal?.throwIfAborted();
    const start = performance.now();
    const timed = AbortSignal.timeout(timeoutMs);
    const runSignal = signal ? AbortSignal.any([timed, signal]) : timed;
    const {
      observation,
      usage = {},
      model: actualModel = model,
    } = await provider.observe(input, { model, signal: runSignal, diagnostic });
    runSignal.throwIfAborted();
    signal?.throwIfAborted();
    const telemetry = {
      provider: provider.name,
      model: actualModel,
      latencyMs: Math.round(performance.now() - start),
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      estimatedUsd: usage.estimatedUsd ?? null,
    };
    attempts.push(telemetry);
    // Recover an exact source excerpt only for a unique punctuation-equivalent match.
    const fold = (text) => text.replace(/['"‘’“”]/g, '"').replace(/[A-Z]/g, (c) => c.toLowerCase());
    if (Array.isArray(observation?.requirements))
      for (const r of observation.requirements) {
        if (typeof r?.excerpt !== 'string' || input.request.includes(r.excerpt)) continue;
        const source = fold(input.request),
          phrase = fold(r.excerpt),
          index = source.indexOf(phrase);
        if (index >= 0 && source.lastIndexOf(phrase) === index)
          r.excerpt = input.request.slice(index, index + phrase.length);
      }
    try {
      validateObservation(observation, input);
      const decision = adjudicate(observation);
      return validateResult(
        {
          version: '1.0',
          rubricVersion: '1.1',
          taskId: input.id,
          candidateIds: pair((s) => input.images[s].id),
          captureScope: input.captureScope,
          captures: pair((s) => {
            const { width, height, mime } = input.images[s];
            return { width, height, mime };
          }),
          ...decision,
          confidence: decision.decision === 'REVIEW' ? 'low' : observation.confidence,
          why: explain(decision, observation),
          observation,
          telemetry,
        },
        input,
      );
    } catch (error) {
      error.attempts = attempts;
      throw error;
    }
  }
  progress('Inspecting the confirmed pair…');
  const result = await run(task);
  if (reverse) {
    progress('Verifying with reversed image order…');
    const reversed = await run(swap(task));
    const mappedDecision = mapReverse(reversed.decision);
    result.verification = {
      reversedDecision: reversed.decision,
      mappedDecision,
      reversedStage: reversed.stage,
      candidateIds: reversed.candidateIds,
      consistent: mappedDecision === result.decision,
      telemetry: reversed.telemetry,
    };
    if (!result.verification.consistent) result.confidence = 'low';
  }
  return validateResult(result, task);
}
