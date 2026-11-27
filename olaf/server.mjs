import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { configuredModels, openAIProvider } from './providers/openai.mjs';
import manifest from './fixtures/manifest.json' with { type: 'json' };
const root = new URL('../', import.meta.url);
const files = new Set([
  'olaf.html',
  'olaf-review.html',
  'favicon.ico',
  'analytics-lite.js',
  ...Object.keys(manifest).map((name) => 'olaf/fixtures/images/' + name + '.png'),
  ...[
    'app.mjs',
    'presets.mjs',
    'history.mjs',
    
    'review.mjs',
    'style.css',
    'engine/contracts.mjs',
    'engine/adjudicate.mjs',
    'engine/evaluate.mjs',
    'engine/pipeline.mjs',
    'engine/stages.mjs',
    'engine/assessment.mjs',
    'engine/text.mjs',
    'engine/verify.mjs',
    'schemas/stages.v1.json',
    'ingestion/mime.mjs',
    'ingestion/archive.mjs',
    'ingestion/images.mjs',
    'ingestion/diagnose.mjs',
    'providers/mock.mjs',
    'schemas/task.v1.json',
    'schemas/result.v1.json',
    'schemas/perception.v1.json',
    'fixtures/manifest.json',
    'benchmarks/dataset.mjs',
    'benchmarks/legacy.mjs',
    'benchmarks/cases.mjs',
    'benchmarks/taxonomy.mjs',
  ].map((f) => 'olaf/' + f),
]);
const mime = {
  html: 'text/html',
  mjs: 'text/javascript',
  js: 'text/javascript',
  json: 'application/json',
  css: 'text/css',
  png: 'image/png',
  ico: 'image/x-icon',
};
const stages = ['compile', 'adherence', 'inspection', 'preference', 'structured', 'verify'];
export async function startServer(port = 4173, env = process.env) {
  let active = false;
  const server = http.createServer(async (req, res) => {
    const host = '127.0.0.1:' + server.address().port;
    const reply = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    if (req.headers.host !== host) return reply(403, { error: 'Unknown host.' });
    const path = req.url.split('?')[0].slice(1);
    if (req.method === 'GET' && path === 'olaf/config') return reply(200, { models: configuredModels(env) });
    if (req.method === 'POST' && ['olaf/observe', 'olaf/stage'].includes(path)) {
      if (req.headers.origin !== 'http://' + host || req.headers['content-type'] !== 'application/json')
        return reply(403, { error: 'Same-origin JSON required.' });
      if (active) return reply(429, { error: 'Another observation is running.' });
      active = true;
      const controller = new AbortController();
      res.on('close', () => controller.abort());
      try {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 48 * 1024 * 1024)
            return reply(413, { error: 'The pair exceeds the 48 MiB transport limit.' });
          chunks.push(chunk);
        }
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          return reply(400, { error: 'Invalid JSON.' });
        }
        const isStage = path === 'olaf/stage';
        if (
          !body ||
          typeof body.request !== 'string' ||
          !body.request.trim() ||
          body.request.length > 64000 ||
          !['unknown', 'full_page', 'viewport', 'specific_screen'].includes(body.captureScope) ||
          !configuredModels(env).includes(body.model) ||
          (isStage && !stages.includes(body.stage))
        )
          return reply(400, { error: 'Invalid request, scope, model or stage.' });
        if (
          (isStage && body.stage !== 'compile') ||
          !isStage
        ) {
          if (
            !body.images ||
            typeof body.images.Left !== 'string' ||
            typeof body.images.Right !== 'string' ||
            body.images.Left.length + body.images.Right.length > 64 * 1024 * 1024
          )
            return reply(400, { error: 'Invalid request, scope, model or stage.' });
        }
        if (
          (Array.isArray(body.requirements) && body.requirements.length > 50) ||
          (Array.isArray(body.claims) && body.claims.length > 20) ||
          (Array.isArray(body.crops) && body.crops.length > 8)
        )
          return reply(400, { error: 'Stage payload exceeds its limit.' });
        const provider = openAIProvider(() => body.images, { env });
        const out = isStage
          ? await provider.stage(body.stage, {
              task: body,
              model: body.model,
              signal: controller.signal,
              diagnostic: body.diagnostic === true,
              requirements: body.requirements,
              claims: body.claims,
              crops: body.crops,
            })
          : await provider.observe(body, {
              model: body.model,
              signal: controller.signal,
              diagnostic: body.diagnostic === true,
            });
        return reply(200, out);
      } catch (e) {
        // Only fixed descriptions and numeric HTTP status can reach the browser.
        const msg =
          e.name === 'TimeoutError'
            ? 'Vision service timed out.'
            : /^Vision service (?:returned HTTP \d{3}\.|connection failed\.|returned incomplete JSON\.)$/.test(
                  e.message,
                )
              ? e.message
              : 'Observation failed. Check the model and embedded images.';
        if (!res.destroyed) reply(502, { error: msg });
      } finally {
        active = false;
      }
      return;
    }
    const file = path || 'olaf.html';
    if (req.method !== 'GET' || !files.has(file)) return reply(404, { error: 'Unknown resource.' });
    try {
      const bytes = await readFile(new URL(file, root));
      res.writeHead(200, {
        'Content-Type': mime[file.split('.').pop()],
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
      });
      res.end(bytes);
    } catch {
      reply(404, { error: 'Missing asset.' });
    }
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startServer(Number(process.argv[2] || 4173));
  console.log('OLAF workspace at http://127.0.0.1:' + server.address().port + '/olaf.html');
}
