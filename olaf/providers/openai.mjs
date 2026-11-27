// Server/CLI only. Neither the endpoint nor authorization is supplied by browser clients.
import { perceptionSchema } from '../engine/contracts.mjs';
import { messages } from '../prompts/perception.mjs';
import { imageType } from '../ingestion/images.mjs';
// Keep local non-empty-string checks even on models supporting only core JSON Schema.
const wireSchema = JSON.parse(
  JSON.stringify(perceptionSchema, (key, value) =>
    ['$schema', 'minLength'].includes(key) ? undefined : value,
  ),
);
// For short briefs, the structured decoder can select only real source phrases.
function schemaForRequest(request) {
  const words = [...request.matchAll(/\S+/g)];
  if (!words.length || words.length > 14 || request.length > 240) return wireSchema;
  const excerpts = new Set();
  for (let first = 0; first < words.length; first++) {
    for (const last of words.slice(first)) {
      const phrase = request.slice(words[first].index, last.index + last[0].length);
      excerpts.add(phrase);
      const trimmed = phrase.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (trimmed) excerpts.add(trimmed);
    }
  }
  const schema = structuredClone(wireSchema);
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
  return {
    name: 'OpenAI',
    async observe(task, { model, signal, diagnostic }) {
      if (!configuredModels(env).includes(model))
        throw Error('Vision model is unavailable. Check the local provider configuration.');
      const images = await resolveImages(task);
      for (const url of [images.Left, images.Right]) {
        const m =
          typeof url === 'string' && /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url);
        if (!m || imageType(Buffer.from(m[2].slice(0, 24), 'base64')) !== m[1])
          throw Error('Expected embedded raster image data.');
      }
      const response = await transport('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(90000), ...(signal ? [signal] : [])]),
        headers: { Authorization: 'Bearer ' + env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: messages(task.request, task.captureScope, images, diagnostic),
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'olaf_observations', strict: true, schema: schemaForRequest(task.request) },
          },
        }),
      }).catch((e) => {
        if (e.name === 'AbortError' || e.name === 'TimeoutError') throw e;
        throw Error('Vision service connection failed.');
      });
      if (!response.ok) throw Error('Vision service returned HTTP ' + response.status + '.');
      const data = await response.json().catch(() => {
        throw Error('Vision service returned incomplete JSON.');
      });
      let observation;
      try {
        observation = JSON.parse(data.choices[0].message.content);
      } catch {
        throw Error('Vision service returned incomplete JSON.');
      }
      const inputTokens = data.usage?.prompt_tokens ?? null,
        outputTokens = data.usage?.completion_tokens ?? null;
      // Optional operator-supplied per-million-token rates, for a single configured model.
      const rates = env.OLAF_USD_PER_MILLION?.split(',').map(Number);
      let estimatedUsd =
        configuredModels(env).length === 1 &&
        rates?.length === 2 &&
        rates.every((v) => Number.isFinite(v) && v >= 0) &&
        inputTokens != null &&
        outputTokens != null
          ? (inputTokens * rates[0] + outputTokens * rates[1]) / 1e6
          : null;
      if (
        !rates &&
        /^gpt-4\.1-mini(?:-2025-04-14)?$/.test(data.model || model) &&
        inputTokens != null &&
        outputTokens != null
      ) {
        const cached = data.usage?.prompt_tokens_details?.cached_tokens || 0;
        estimatedUsd = ((inputTokens - cached) * 0.4 + cached * 0.1 + outputTokens * 1.6) / 1e6;
      }
      return { observation, model: data.model || model, usage: { inputTokens, outputTokens, estimatedUsd } };
    },
  };
}
