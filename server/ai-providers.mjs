import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

function text(value, limit = 240) {
  return String(value || '').trim().slice(0, limit);
}

function uniqueModels(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => text(value, 160)).filter(Boolean))];
}

const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);

function uniqueReasoningEfforts(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => text(value, 20).toLowerCase())
    .filter((value) => REASONING_EFFORTS.has(value)))];
}

function apiMode(value) {
  return text(value || 'chat_completions', 40).toLowerCase() === 'responses'
    ? 'responses'
    : 'chat_completions';
}

function catalogModels(catalog) {
  if (!catalog || typeof catalog !== 'object') return [];
  const values = [...(Array.isArray(catalog.models) ? catalog.models : [])];
  if (typeof catalog.message === 'string') {
    try {
      const parsed = JSON.parse(catalog.message);
      values.push(...(Array.isArray(parsed?.models) ? parsed.models : []));
      values.push(...(Array.isArray(parsed?.data) ? parsed.data.map((item) => item?.id) : []));
    } catch {
      // A stale catalog message is ignored; the provider can still accept a manually selected model.
    }
  }
  return uniqueModels(values);
}

function safeId(value) {
  return text(value, 120)
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizeProfile(id, profile = {}) {
  const models = uniqueModels([
    ...(Array.isArray(profile.models) ? profile.models : []),
    ...catalogModels(profile.model_catalog)
  ]);
  const selectedModel = text(profile.selected_model || profile.model, 160);
  if (selectedModel && !models.includes(selectedModel)) models.unshift(selectedModel);
  return {
    id: text(id, 120),
    name: text(profile.name || id, 120),
    base_url: text(profile.base_url, 500).replace(/\/$/, ''),
    api_key: text(profile.api_key, 1000),
    api_mode: apiMode(profile.api_mode),
    reasoning_efforts: uniqueReasoningEfforts(profile.reasoning_efforts || profile.reasoning_levels),
    selected_model: selectedModel,
    models
  };
}

export function normalizeAiProviderDraft(draft = {}, existing = null) {
  const name = text(draft.name || existing?.name, 120);
  const baseUrl = text(draft.base_url || existing?.base_url, 500).replace(/\/$/, '');
  const apiKey = text(draft.api_key || existing?.api_key, 1000);
  const requestedId = safeId(draft.id || existing?.id || name);
  const id = requestedId || `provider-${Date.now().toString(36)}`;
  const profile = normalizeProfile(id, {
    name: name || id,
    base_url: baseUrl,
    api_key: apiKey,
    api_mode: draft.api_mode ?? existing?.api_mode,
    models: draft.models ?? existing?.models,
    selected_model: draft.selected_model ?? existing?.selected_model,
    reasoning_efforts: draft.reasoning_efforts ?? existing?.reasoning_efforts
  });
  if (!profile.base_url || !/^https?:\/\//i.test(profile.base_url)) {
    const error = new Error('中转站地址必须是以 http:// 或 https:// 开头的完整地址。');
    error.status = 400;
    error.code = 'INVALID_PROVIDER_URL';
    throw error;
  }
  if (!profile.api_key) {
    const error = new Error('请填写该中转站的 API Key。');
    error.status = 400;
    error.code = 'PROVIDER_KEY_REQUIRED';
    throw error;
  }
  if (!profile.selected_model) {
    const error = new Error('请至少填写并选择一个模型。');
    error.status = 400;
    error.code = 'PROVIDER_MODEL_REQUIRED';
    throw error;
  }
  return profile;
}

export function loadAiProviders(filePath, fallback = {}) {
  const profiles = {};
  if (filePath && existsSync(filePath)) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
      const sourceProfiles = parsed?.profiles && typeof parsed.profiles === 'object' ? parsed.profiles : {};
      for (const [id, profile] of Object.entries(sourceProfiles)) {
        const normalized = normalizeProfile(id, profile);
        if (normalized.base_url && normalized.api_key) profiles[normalized.id] = normalized;
      }
      const activeId = text(parsed?.active_profile, 120);
      if (activeId && profiles[activeId]) fallback.active_profile = activeId;
    } catch (error) {
      console.error('AI provider registry could not be loaded', error?.message || 'invalid file');
    }
  }
  if (!Object.keys(profiles).length && fallback.base_url && fallback.api_key && fallback.model) {
    const fallbackProfile = normalizeProfile(fallback.id || 'default', {
      name: fallback.name || '默认网关',
      base_url: fallback.base_url,
      api_key: fallback.api_key,
      selected_model: fallback.model,
      models: [fallback.model]
    });
    profiles[fallbackProfile.id] = fallbackProfile;
    fallback.active_profile = fallbackProfile.id;
  }
  const active = profiles[fallback.active_profile] ? fallback.active_profile : Object.keys(profiles)[0] || '';
  return { profiles, active };
}

export function providerCatalog(registry) {
  return Object.values(registry.profiles).map((profile) => ({
    id: profile.id,
    name: profile.name,
    base_url: profile.base_url,
    api_mode: profile.api_mode,
    reasoning_efforts: profile.reasoning_efforts,
    selected_model: profile.selected_model,
    models: profile.models,
    active: profile.id === registry.active
  }));
}

export function providerConfig(registry) {
  return {
    version: 1,
    active_profile: registry.active || '',
    profiles: Object.fromEntries(Object.entries(registry.profiles).map(([id, profile]) => [id, {
      name: profile.name,
      base_url: profile.base_url,
      api_key: profile.api_key,
      api_mode: profile.api_mode,
      reasoning_efforts: profile.reasoning_efforts,
      selected_model: profile.selected_model,
      models: profile.models
    }]))
  };
}

export async function saveAiProviders(filePath, registry) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(providerConfig(registry), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, filePath);
}

export function selectAiProvider(registry, providerId, model, fallbackModel = '', reasoningEffort = '') {
  const requestedId = text(providerId, 120);
  const profile = registry.profiles[requestedId] || registry.profiles[registry.active] || Object.values(registry.profiles)[0];
  if (!profile) return null;
  const requestedModel = text(model, 160) || profile.selected_model || fallbackModel || profile.models[0] || '';
  if (!requestedModel) return null;
  if (profile.models.length && !profile.models.includes(requestedModel)) {
    const error = new Error(`模型不在提供商“${profile.name}”的可用列表中。`);
    error.status = 400;
    error.code = 'MODEL_NOT_AVAILABLE';
    throw error;
  }
  const requestedEffort = text(reasoningEffort, 20).toLowerCase();
  if (requestedEffort && !REASONING_EFFORTS.has(requestedEffort)) {
    const error = new Error('推理等级不受支持。');
    error.status = 400;
    error.code = 'REASONING_EFFORT_NOT_AVAILABLE';
    throw error;
  }
  if (requestedEffort && profile.reasoning_efforts.length && !profile.reasoning_efforts.includes(requestedEffort)) {
    const error = new Error(`推理等级不在提供商“${profile.name}”的可用列表中。`);
    error.status = 400;
    error.code = 'REASONING_EFFORT_NOT_AVAILABLE';
    throw error;
  }
  return { ...profile, model: requestedModel, reasoning_effort: requestedEffort };
}
