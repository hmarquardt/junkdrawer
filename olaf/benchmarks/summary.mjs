// Aggregate benchmark rows into comparison-ready metrics. Pure and offline.
const fraction = (rows, predicate) => ({
  success: rows.filter(predicate).length,
  total: rows.length,
});
const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

export function summarize(rows) {
  const labelled = rows.filter((r) => r.expected != null);
  const objective = rows.filter((r) => r.objective && r.expected != null);
  const valid = rows.filter((r) => r.valid);
  const reverse = rows.filter((r) => r.valid && r.consistent != null);
  const reverseDecided = reverse.filter((r) => r.decision !== 'REVIEW');
  const taxonomies = {};
  for (const row of rows) for (const tag of row.taxonomy || []) taxonomies[tag] = (taxonomies[tag] || 0) + 1;
  const costed = valid.filter((r) => r.estimatedUsd != null);
  const totalUsd = costed.length ? costed.reduce((n, r) => n + r.estimatedUsd, 0) : null;
  return {
    runs: rows.length,
    valid: fraction(rows, (r) => r.valid),
    decisionAgreement: fraction(objective, (r) => r.agreement === true),
    overallAgreement: fraction(labelled, (r) => r.agreement === true),
    objectiveStageAgreement: fraction(
      rows.filter((r) => r.objective && ['prompt_adherence', 'disqualifiers'].includes(r.expectedStage)),
      (r) => r.valid && r.stageMatch,
    ),
    stageAgreement: fraction(rows, (r) => r.valid && r.stageMatch),
    agreementByConfidence: Object.fromEntries(
      ['high', 'medium', 'low'].map((band) => [
        band,
        fraction(labelled.filter((r) => r.confidence === band), (r) => r.agreement === true),
      ]),
    ),
    byStage: Object.fromEntries(
      [...new Set(rows.map((r) => r.expectedStage))].map((stage) => [
        stage,
        fraction(rows.filter((r) => r.expectedStage === stage), (r) => r.valid && r.stageMatch),
      ]),
    ),
    byCategory: Object.fromEntries(
      [...new Set(rows.map((r) => r.category))].map((category) => [
        category,
        fraction(
          rows.filter((r) => r.category === category && r.expected != null),
          (r) => r.valid && r.agreement === true,
        ),
      ]),
    ),
    bySplit: Object.fromEntries(
      [...new Set(rows.map((r) => r.split))].map((split) => [
        split,
        fraction(
          rows.filter((r) => r.split === split && r.expected != null),
          (r) => r.valid && r.agreement === true,
        ),
      ]),
    ),
    positionalConsistency: fraction(reverseDecided, (r) => r.consistent === true),
    reverseOrderConsistencyAll: fraction(reverse, (r) => r.consistent === true),
    reverseOrderConsistencyStrict: fraction(reverse, (r) => r.consistent === true && r.decision !== 'REVIEW'),
    abstentions: rows.filter((r) => r.decision === 'REVIEW').length,
    evidenceFactuality: fraction(
      valid.filter((r) => r.decision !== 'REVIEW'),
      (r) => r.evidenceGrounded === true,
    ),
    structuralValidity: fraction(rows, (r) => r.valid),
    taxonomy: taxonomies,
    latencyMs: {
      mean: valid.length ? Math.round(valid.reduce((n, r) => n + (r.latencyMs || 0), 0) / valid.length) : null,
      p95: percentile(valid.map((r) => r.latencyMs || 0), 95),
      max: valid.length ? Math.max(...valid.map((r) => r.latencyMs || 0)) : null,
    },
    tokens: {
      input: valid.length && valid.every((r) => r.inputTokens != null)
        ? valid.reduce((n, r) => n + r.inputTokens, 0)
        : null,
      output: valid.length && valid.every((r) => r.outputTokens != null)
        ? valid.reduce((n, r) => n + r.outputTokens, 0)
        : null,
    },
    estimatedUsd: totalUsd,
    usdPerEvaluation: totalUsd != null && valid.length ? totalUsd / valid.length : null,
  };
}
