// Server/CLI only. Neither the endpoint nor authorization is supplied by browser clients.
import { perceptionSchema } from '../engine/contracts.mjs';
import { wireSchema, structuredSchema } from '../engine/stages.mjs';
import { messages } from '../prompts/perception.mjs';
import {
  compileMessages,
  adherenceMessages,
  structuredMessages,
  inspectionMessages,
  preferenceMessages,
  verifyMessages,
} from '../prompts/stages.mjs';
import { imageType } from '../ingestion/images.mjs';
import { cropDataUrl } from '../ingestion/png.mjs';
import { estimatedUsd } from './pricing.mjs';
// Keep local non-empty-string checks even on models supporting only core JSON Schema.
const wirePerception = JSON.parse(
  JSON.stringify(perceptionSchema, (key, value) => (['$schema', 'minLength'].includes(key) ? undefined : value)),
);
// For short briefs, the structured decoder can select only real source phrases.
function schemaForRequest(request) {
  const words = [...request.matchAll(/\S+/g)];
  if (!words.length || words.length > 14 || request.length > 240) return wirePerception;
  const excerpts = new Set();
  for (let first = 0; first < words.length; first++) {
    for (const last of words.slice(first)) {
      const phrase = request.slice(words[first].index, last.index + last[0].length);
      excerpts.add(phrase);
      const trimmed = phrase.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (trimmed) excerpts.add(trimmed);
    }
  }
  const schema = structuredClone(wirePerception);
  schema.properties.requirements.items.properties.excerpt.enum = [...excerpts];
  return schema;
}
export function configuredModels(env = process.env) {
  return env.OPENAI_API_KEY
    ? (env.OLAF_MODELS || 'gpt-4.1-mini')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    : [];
}
export function openAIProvider(resolveImages, { env = process.env, transport = fetch } = {}) {
  const stageSchemas = {
    compile: () => wireSchema('compile'),
    adherence: () => wireSchema('adherence'),
    inspection: () => wireSchema('inspection'),
    preference: () => wireSchema('preference'),
    structured: () => structuredSchema(),
    verify: () => wireSchema('verify'),
  };
  async function call({ messages: body, schema, name, model, signal }) {
    const response = await transport('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(90000), ...(signal ? [signal] : [])]),
      headers: { Authorization: 'Bearer ' + env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: body,
        response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
      }),
    }).catch((e) => {
      if (e.name === 'AbortError' || e.name === 'TimeoutError') throw e;
      throw Error('Vision service connection failed.');
    });
    if (!response.ok) throw Error('Vision service returned HTTP ' + response.status + '.');
    const data = await response.json().catch(() => {
      throw Error('Vision service returned incomplete JSON.');
    });
    let parsed;
    try {
      parsed = JSON.parse(data.choices[0].message.content);
    } catch {
      throw Error('Vision service returned incomplete JSON.');
    }
    const inputTokens = data.usage?.prompt_tokens ?? null,
      outputTokens = data.usage?.completion_tokens ?? null,
      cachedTokens = data.usage?.prompt_tokens_details?.cached_tokens || 0;
    const actualModel = data.model || model;
    return {
      data: parsed,
      model: actualModel,
      usage: {
        inputTokens,
        outputTokens,
        cachedTokens,
        estimatedUsd: estimatedUsd({
          env,
          models: configuredModels(env),
          actualModel,
          usage: { inputTokens, outputTokens, cachedTokens },
        }),
      },
    };
  }
  async function resolve(task) {
    const images = await resolveImages(task);
    for (const url of [images.Left, images.Right]) {
      const m =
        typeof url === 'string' && /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url);
      if (!m || imageType(Buffer.from(m[2].slice(0, 24), 'base64')) !== m[1])
        throw Error('Expected embedded raster image data.');
    }
    return images;
  }
  return {
    name: 'OpenAI',
    async observe(task, { model, signal, diagnostic }) {
      if (!configuredModels(env).includes(model))
        throw Error('Vision model is unavailable. Check the local provider configuration.');
      const images = await resolve(task);
      const out = await call({
        messages: messages(task.request, task.captureScope, images, diagnostic),
        schema: schemaForRequest(task.request),
        name: 'olaf_observations',
        model,
        signal,
      });
      return { observation: out.data, model: out.model, usage: out.usage };
    },
    async stage(kind, { task, model, signal, requirements, claims, crops = [], diagnostic }) {
      if (!configuredModels(env).includes(model))
        throw Error('Vision model is unavailable. Check the local provider configuration.');
      if (!stageSchemas[kind]) throw Error('Unknown observation stage.');
      const images = kind === 'compile' ? null : await resolve(task);
      const stageCrops = [];
      if (kind === 'verify')
        for (const crop of crops) {
          const url = cropDataUrl(images[crop.side], crop);
          if (url) stageCrops.push({ label: crop.label, url });
        }
      const body =
        kind === 'compile'
          ? compileMessages(task.request, task.captureScope)
          : kind === 'adherence'
            ? adherenceMessages(task.request, task.captureScope, requirements, images)
            : kind === 'structured'
              ? structuredMessages(task.request, task.captureScope, requirements, images, diagnostic)
              : kind === 'inspection'
              ? inspectionMessages(task.captureScope, images, diagnostic)
              : kind === 'preference'
                ? preferenceMessages(task.request, task.captureScope, images, requirements)
                : kind === 'verify'
                  ? verifyMessages(claims, task.captureScope, images, stageCrops)
                  : null;
      if (!body) throw Error('Unknown observation stage.');
      const out = await call({ messages: body, schema: stageSchemas[kind](), name: 'olaf_' + kind, model, signal });
      return { ...out, crops: stageCrops.map((c) => c.label) };
    },
  };
}
