import { pair, perceptionSchema } from '../engine/contracts.mjs';
import manifest from '../fixtures/manifest.json' with { type: 'json' };
export const demoRequest = 'Use a purple “View collection” button.';
const keys = (k) => Object.keys(perceptionSchema.properties[k].properties);
export function mockProvider(hashOf) {
  return {
    name: 'Mock',
    async observe(task, { signal }) {
      await new Promise((resolve, reject) => {
        const done = () => {
          signal?.removeEventListener('abort', abort);
          resolve();
        };
        const timer = setTimeout(done, 180);
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
      const hashes = await Promise.all([hashOf(task.images.Left), hashOf(task.images.Right)]);
      const known =
        task.request === demoRequest &&
        [manifest.standard.hash, manifest.red.hash].every((h) => hashes.includes(h));
      const color = (side) =>
        hashes[side === 'Left' ? 0 : 1] === manifest.standard.hash ? 'purple' : 'rust red';
      const evidence = pair((s) =>
        known
          ? 'the View collection button is ' + color(s)
          : 'no visual inspection is available for this image',
      );
      const notes = {
        first_look: 'the exhibit title dominates the page',
        structure: 'the portrait sits to the right of the heading',
        type: 'the large serif heading sits above smaller body text',
        color: null,
        details: 'the header and footer share a left edge',
        hierarchy: 'the title is larger than the section label',
        grid: 'the portrait occupies the right column',
        spacing: 'a gap separates the title and body',
        alignment: 'the heading and button share a left edge',
        typography: 'the title uses a serif face',
        contrast: 'the dark title stands out against cream',
        consistency: 'header and footer use uppercase labels',
      };
      const record = (k) =>
        Object.fromEntries(
          keys(k).map((key) => [key, known && notes[key] ? pair(() => notes[key]) : evidence]),
        );
      return {
        model: 'fixture-v1',
        usage: { estimatedUsd: 0 },
        observation: {
          rendering: pair(() => (known ? 'rendered' : 'uncertain')),
          renderEvidence: known ? pair(() => 'the exhibition page is visible') : evidence,
          requirements: known
            ? [
                {
                  excerpt: demoRequest,
                  scope: 'visible',
                  kind: 'style',
                  status: pair((s) => (color(s) === 'purple' ? 'met' : 'missing')),
                  evidence,
                },
              ]
            : [],
          passes: record('passes'),
          principles: record('principles'),
          defects: [],
          lessAffected: 'comparable',
          impactEvidence: evidence,
          preference: known ? 'Tie' : 'uncertain',
          preferenceEvidence: evidence,
          tieQuality: 'good',
          confidence: known ? 'high' : 'low',
          limitations: [
            known
              ? 'Scripted observations for the synthetic demo.'
              : 'Mock mode has no observations for this input. Select a live provider to inspect it.',
          ],
          inferences: [],
        },
      };
    },
  };
}
