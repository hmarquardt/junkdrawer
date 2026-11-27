import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePreset, presets } from '../presets.mjs';
import { archiveReport } from '../ingestion/diagnose.mjs';
import { historyRecord, HISTORY_LIMIT, HISTORY_MAX_AGE_DAYS } from '../history.mjs';

test('presets only offer configured model identifiers and always allow custom/diagnostic', () => {
  assert.equal(resolvePreset('accuracy', []).available, false);
  assert.equal(resolvePreset('accuracy', ['gpt-4.1-mini']).available, false);
  assert.equal(resolvePreset('accuracy', ['gpt-6.2-sol']).available, true);
  assert.equal(resolvePreset('economy', ['gpt-4.1-mini']).available, true);
  assert.equal(resolvePreset('economy', ['gpt-6.2-sol']).available, false);
  assert.equal(resolvePreset('diagnostic', []).available, true);
  assert.equal(resolvePreset('custom', []).available, true);
  assert.match(resolvePreset('accuracy', []).reason, /OLAF_MODELS/);
  assert.equal(presets.accuracy.architecture, 'a');
  assert.equal(presets.economy.architecture, 'd');
});

test('history records exclude images and archives, include hashes and bounded fields', () => {
  const result = {
    taskId: 't1',
    rubricVersion: '1.1',
    decision: 'Left',
    stage: 'prompt_adherence',
    confidence: 'high',
    evidence: { Left: 'button is purple', Right: 'button is red' },
    observation: { limitations: ['synthetic'] },
    telemetry: { provider: 'OpenAI', model: 'gpt-4.1-mini', latencyMs: 100, estimatedUsd: 0.001 },
    verification: { consistent: true },
    diagnostics: { architecture: 'a' },
  };
  const task = { images: { Left: { sha256: 'a' }, Right: { sha256: 'b' } } };
  const record = historyRecord({
    result,
    task,
    preset: 'economy',
    requestHash: 'r',
    now: new Date('2026-11-27T12:00:00Z'),
  });
  assert.equal(record.inputHashes.request, 'r');
  assert.equal(record.inputHashes.Left, 'a');
  assert.equal(record.winner, 'Left');
  assert.equal(record.architecture, 'a');
  assert.equal(record.reverseConsistent, true);
  assert.ok(!('observation' in record));
  assert.ok(!('images' in record));
  assert.equal(HISTORY_LIMIT, 200);
  assert.equal(HISTORY_MAX_AGE_DAYS, 180);
});

test('archive report exposes counts, image associations, dimensions, assignments and ambiguities', () => {
  const report = archiveReport({
    archiveBytes: 4096,
    metadata: {
      mimeParts: 5,
      htmlParts: 1,
      embeddedImages: 2,
      rootLocation: 'https://archive.invalid/page.html',
      images: [
        {
          label: 'Left candidate',
          side: 'Left',
          partIndex: 1,
          mime: 'image/png',
          bytes: 1200,
          cid: 'left@local',
          location: 'dir/left.png',
        },
        {
          label: 'Archive image 3',
          side: null,
          partIndex: 2,
          mime: 'image/jpeg',
          bytes: 800,
          cid: '',
          location: 'dir/right.jpg',
        },
      ],
    },
    recovery: {
      requests: ['Use a purple button.'],
      warnings: ['Right assignment needs confirmation from the image pool.'],
    },
    assets: [
      { width: 700, height: 390, assignedSide: 'Left' },
      { width: 640, height: 480, assignedSide: null },
    ],
  });
  assert.equal(report.mimeParts, 5);
  assert.equal(report.htmlDocuments, 1);
  assert.equal(report.imageResources, 2);
  assert.equal(report.images[0].dimensions, '700 × 390');
  assert.equal(report.images[0].cid, 'left@local');
  assert.equal(report.images[0].assignedSide, 'Left');
  assert.equal(report.assignments.Left, 'Left candidate');
  assert.equal(report.assignments.Right, null);
  assert.equal(report.recoveredRequest, 'Use a purple button.');
  assert.ok(report.ambiguities.some((a) => /not assigned/.test(a)));
  assert.ok(report.ambiguities.some((a) => /Right assignment/.test(a)));
  assert.equal(report.rootLocation, 'https://archive.invalid/page.html');
});

test('archive report keeps multiple request candidates and never invents a recovery', () => {
  const report = archiveReport({
    recovery: { requests: ['one', 'two'], warnings: ['Multiple possible requests recovered.'] },
  });
  assert.equal(report.recoveredRequest, null);
  assert.deepEqual(report.requestCandidates, ['one', 'two']);
  assert.ok(report.ambiguities.some((a) => /Multiple possible requests/.test(a)));
});
