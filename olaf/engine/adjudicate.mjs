import { sides, other, pair } from './contracts.mjs';

export function adjudicate(o) {
  const outcome = (decision, stage, evidence) => ({ decision, stage, evidence });
  const review = (evidence) => outcome('REVIEW', 'review', evidence);
  const eligible = o.requirements.filter((r) => r.scope === 'visible');
  const counts = pair((side) => eligible.filter((r) => ['met', 'alternative'].includes(r.status[side])).length);
  const ambiguous = o.requirements.filter((r) => r.scope === 'uncertain');
  const unknown = pair(
    (side) =>
      eligible.filter((r) => r.status[side] === 'uncertain').length +
      ambiguous.filter(
        (r) =>
          r.status[side] !== r.status[other(side)] &&
          ['met', 'alternative', 'uncertain'].includes(r.status[side]),
      ).length,
  );
  const rank = { minor: 1, major: 2, page_broken: 3 };
  const worst = pair(
    (side) => o.defects.filter((d) => d.side === side).sort((a, b) => rank[b.severity] - rank[a.severity])[0],
  );
  const severity = pair((side) => rank[worst[side]?.severity] || 0);
  if (sides.some((s) => o.rendering[s] === 'uncertain')) return review(o.renderEvidence);
  const rendered = sides.filter((s) => o.rendering[s] === 'rendered');
  if (rendered.length < 2)
    return rendered.length ? outcome(rendered[0], 'rendering', o.renderEvidence) : review(o.renderEvidence);
  for (const side of sides) {
    const rival = other(side);
    if (counts[side] <= counts[rival] + unknown[rival]) continue;
    if (severity[side] === 3 && severity[rival] < 3)
      return outcome(rival, 'disqualifiers', worst[side].evidence);
    const witness = eligible.find(
      (r) => ['met', 'alternative'].includes(r.status[side]) && r.status[rival] === 'missing',
    );
    return witness ? outcome(side, 'prompt_adherence', witness.evidence) : review(o.preferenceEvidence);
  }
  const unresolved =
    eligible.find((r) => sides.some((s) => r.status[s] === 'uncertain')) ||
    ambiguous.find((r) => r.status.Left !== r.status.Right);
  if (unresolved) return review(unresolved.evidence);
  if (severity.Left !== severity.Right) {
    const loser = severity.Left > severity.Right ? 'Left' : 'Right';
    return outcome(other(loser), 'disqualifiers', worst[loser].evidence);
  }
  if (severity.Left && severity.Left === severity.Right) {
    if (o.lessAffected === 'uncertain') return review(o.impactEvidence);
    if (sides.includes(o.lessAffected)) return outcome(o.lessAffected, 'disqualifiers', o.impactEvidence);
  }
  if (o.preference === 'uncertain') return review(o.preferenceEvidence);
  if (o.preference === 'Tie') {
    // Even a genuine tie needs something visibly present in each image.
    const generic =
      /both (?:sides|designs|screenshots)|visually identical|equally (?:good|bad)|no (?:meaningful|visible) difference/i;
    const evidence = [o.preferenceEvidence, o.passes.structure, o.passes.type, o.passes.details].find((pair) =>
      sides.every((s) => !generic.test(pair[s])),
    );
    return evidence ? outcome('Tie', 'tie', evidence) : review(o.preferenceEvidence);
  }
  return outcome(o.preference, 'preference', o.preferenceEvidence);
}

// Evidence is a pair of self-contained visible clauses, with side names supplied by code.
export function explain({ decision, evidence }, o) {
  const clause = (side) =>
    evidence[side]
      .trim()
      .replace(/[.!?]+$/, '')
      .replace(/^./, (c) => c.toLowerCase());
  if (decision === 'REVIEW')
    return 'Review required. The available observations do not support a reliable comparison.';
  if (decision === 'Tie')
    return (
      'It is a tie because both designs are equally ' +
      o.tieQuality +
      '. On Left, ' +
      clause('Left') +
      ', while on Right, ' +
      clause('Right') +
      '.'
    );
  const rival = other(decision);
  return decision + ' is better because ' + clause(decision) + '. On ' + rival + ', ' + clause(rival) + '.';
}
