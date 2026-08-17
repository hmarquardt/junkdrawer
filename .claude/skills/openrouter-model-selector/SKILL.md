---
name: openrouter-model-selector
description: Add or repair a user-configurable OpenRouter model selector in a Junkdrawer page. Use when a page calls the OpenRouter API and needs the settings UI — local-only API key storage, a provider-grouped <optgroup> model select populated from openrouter.ai/api/v1/models after a key is entered, a Refresh models action, a visible status element, and graceful fallback to the saved/default model on failure.
---

# OpenRouter Model Selector

Project convention (AGENTS.md): OpenRouter pages must not hard-code one model. Provide a key field + model selector with these behaviors:

- Store key and selected model **locally only** (localStorage or IndexedDB, matching the page's existing storage pattern). Never transmit the key anywhere except `openrouter.ai`.
- Default model when nothing is saved: `openai/gpt-4.1-mini`.
- Fetch `https://openrouter.ai/api/v1/models` (with the user's key) only after a key is entered or saved. No hidden OpenRouter calls beyond model-list loading and explicit user actions.
- Populate the `<select>` with `<optgroup>` per provider — the provider is the ID prefix before `/` (`openai/gpt-4.1-mini` → group `openai`).
- Preserve the saved/current model as a fallback `<option>` if the fetch fails or the model is absent from the list — the page must stay usable.
- Include a manual **Refresh models** button and a visible `role="status"` element for loading/error states.

## Reference implementation

Adapt storage keys to the page's existing namespacing.

```html
<div class="field">
  <label for="orApiKey">OpenRouter API key</label>
  <input id="orApiKey" type="password" autocomplete="off" placeholder="sk-or-v1-…" />
  <p class="help">Stored only in this browser; sent directly to OpenRouter.</p>
</div>
<div class="field">
  <label for="orModel">Model</label>
  <select id="orModel"></select>
</div>
<button id="orRefreshModels" type="button">Refresh models</button>
<div id="orModelStatus" role="status" aria-live="polite"></div>
```

```js
const OR_KEY = 'mytool.openrouter';            // { apiKey, model }
const DEFAULT_MODEL = 'openai/gpt-4.1-mini';

const loadOr = () => {
  try { return { model: DEFAULT_MODEL, ...JSON.parse(localStorage.getItem(OR_KEY) || '{}') }; }
  catch { return { model: DEFAULT_MODEL }; }
};
const saveOr = (s) => localStorage.setItem(OR_KEY, JSON.stringify({ apiKey: s.apiKey || '', model: s.model || DEFAULT_MODEL }));

function renderModelSelect(select, models, current) {
  select.innerHTML = '';
  const groups = {};
  for (const m of models) (groups[m.id.split('/')[0] || 'other'] ??= []).push(m);
  for (const provider of Object.keys(groups).sort()) {
    const og = document.createElement('optgroup');
    og.label = provider;
    for (const m of groups[provider].sort((a, b) => a.id.localeCompare(b.id)))
      og.append(new Option(m.name || m.id, m.id));
    select.append(og);
  }
  // Fallback: keep the saved/default model selectable even if not in the list
  if (current && !models.some(m => m.id === current))
    select.append(new Option(`${current} (saved)`, current));
  select.value = current || DEFAULT_MODEL;
}

async function fetchModels({ key, select, status }) {
  if (!key) { status.textContent = 'Enter an API key first.'; return; }
  status.textContent = 'Loading models…';
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${key}`, 'HTTP-Referer': location.origin, 'X-Title': document.title }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data } = await res.json();
    renderModelSelect(select, data || [], select.value || DEFAULT_MODEL);
    status.textContent = `${(data || []).length} models loaded.`;
  } catch (err) {
    // Keep the saved/default model usable; show the error instead of blocking.
    renderModelSelect(select, [], select.value || DEFAULT_MODEL);
    status.textContent = `Model list failed to load (${err.message}). Using saved model.`;
  }
}
```

Wiring: on page load, hydrate the key field and render the select with the saved model (no fetch unless a key already exists — fetching once on load with a saved key is acceptable and matches existing pages like `weather_nerd.html`). Save on change. `orRefreshModels` calls `fetchModels`.

## Verify

- With no key: no network call; select shows `openai/gpt-4.1-mini`.
- With a key: list loads, providers appear as `<optgroup>` labels, selection persists across reload.
- With a bad key/offline: status shows the error; the saved model remains selected and usable.
- Remember to bump the page version (`junkdrawer-version-bump` skill) after editing.
