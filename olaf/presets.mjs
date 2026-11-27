// Named evaluation configurations. Model identifiers are only offered when the local server reports them.
export const presets = {
  accuracy: {
    label: 'Accuracy',
    description: 'Flagship model, single pass, reverse-order verification.',
    provider: 'openai',
    model: 'gpt-6.2-sol',
    architecture: 'a',
    reverse: true,
    diagnostic: false,
    requiresModel: true,
  },
  economy: {
    label: 'Economy',
    description: 'Economical model, targeted verification, no reverse pass.',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    architecture: 'd',
    reverse: false,
    diagnostic: false,
    requiresModel: true,
  },
  diagnostic: {
    label: 'Diagnostic',
    description: 'Current model, detailed evidence and reverse-order verification.',
    provider: null,
    model: null,
    architecture: 'd',
    reverse: true,
    diagnostic: true,
    requiresModel: false,
  },
  custom: {
    label: 'Custom',
    description: 'Manual model and architecture selection.',
    provider: null,
    model: null,
    architecture: null,
    reverse: null,
    diagnostic: null,
    requiresModel: false,
  },
};
export const presetNames = Object.keys(presets);
export const presetNameFor = (id) =>
  Object.entries(presets).find(([, p]) => p.label === id)?.[0] || 'custom';
export function resolvePreset(name, models = []) {
  const preset = presets[name];
  if (!preset) return { available: false, reason: 'Unknown preset.' };
  if (name === 'custom') return { available: true, preset };
  if (preset.requiresModel) {
    const available = models.includes(preset.model);
    return {
      available,
      preset,
      reason: available
        ? ''
        : `${preset.model} is not configured. Add it to OLAF_MODELS and restart the local server.`,
    };
  }
  return { available: true, preset };
}
