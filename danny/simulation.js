export const cases = [
  ['The opening shift', 'Left cheek', 'Three little troublemakers clocked in before you did.', 3],
  ['Forehead forecast', 'Forehead', 'A localized outbreak of extremely small drama.', 4],
  ['The chin committee', 'Chin', 'Every pore has filed a separate grievance.', 4],
  ['Overtime on the right', 'Right cheek', 'The night crew left a few things on your desk.', 5],
  ['Pore performance review', 'Jawline', 'Management has requested measurable pops.', 5],
  ['The grand expulsion', 'Temple', 'One final field between you and paid vacation.', 6]
];
export const tools = [
  {name:'Loop extractor', type:'Balanced', speed:0.75, window:0.15, xp:0},
  {name:'Precision tip', type:'Fine control', speed:0.54, window:0.19, xp:60},
  {name:'Vacuum pen', type:'High speed', speed:1.04, window:0.16, xp:180}
];
const names = ['Whitehead', 'Blackhead', 'Congested pore'];
export const ranks = ['Trainee','Pore scout','Field specialist','Shift lead','Pore legend'];
export function rank(xp) { return ranks[Math.min(4, Math.floor(xp / 120))]; }
export function random(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let n = Math.imul(seed ^ seed >>> 15, 1 | seed);
    n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}
export function makeField(index) {
  const rng = random(17031 + index * 3499);
  const sites = [[.47,.47],[.72,.67],[.25,.34],[.68,.28],[.34,.73],[.81,.47]];
  return sites.slice(0,cases[index][3]).map(([x,y], id) => {
    const type = (id + index) % 3;
    return {id, x:x + (rng()-.5)*.09, y:y + (rng()-.5)*.09,
      size:.042 + rng()*.013, phase:rng()*6.28, goal:.49 + rng()*.25,
      resistance:.86 + rng()*.28 + index*.025, type, name:names[type]};
  });
}
export function pressure(seconds, target, tool) {
  const cycle = seconds * tool.speed / target.resistance;
  return 1 - Math.abs(1 - cycle % 2);
}
export function assess(value, target, tool) {
  const error = Math.abs(value - target.goal);
  return {success:error <= tool.window, perfect:error <= tool.window*.35};
}
export function newCampaign() {
  return {caseIndex:0, cleared:[], xp:0, total:0, tool:0, sound:true, revision:0};
}
