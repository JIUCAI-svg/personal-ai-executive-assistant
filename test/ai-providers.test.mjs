import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAiProviders, normalizeAiProviderDraft, providerCatalog, selectAiProvider } from '../server/ai-providers.mjs';

test('provider catalog never returns API keys and normalizes manual provider drafts', () => {
  const profile = normalizeAiProviderDraft({
    name: '我的中转站', base_url: 'https://relay.example/v1/', api_key: 'secret-key', api_mode: 'responses',
    models: ['gpt-5.5', 'gpt-5.5'], selected_model: 'gpt-5.5', reasoning_efforts: ['low', 'high', 'invalid']
  });
  const registry = { active: profile.id, profiles: { [profile.id]: profile } };
  const catalog = providerCatalog(registry);
  assert.equal(profile.base_url, 'https://relay.example/v1');
  assert.deepEqual(profile.reasoning_efforts, ['low', 'high']);
  assert.equal(catalog[0].api_key, undefined);
  assert.equal(JSON.stringify(catalog).includes('secret-key'), false);
});

test('provider loader supports the persisted profile registry shape', () => {
  const registry = loadAiProviders('', { base_url: 'https://example.test/v1', api_key: 'key', model: 'model', id: 'fallback' });
  assert.equal(registry.active, 'fallback');
  assert.equal(registry.profiles.fallback.model, undefined);
  assert.equal(registry.profiles.fallback.selected_model, 'model');
});

test('active provider selection wins over a legacy environment fallback model', () => {
  const registry = {
    active: 'relay',
    profiles: {
      relay: {
        id: 'relay', name: '中转站', base_url: 'https://example.test/v1', api_key: 'key',
        models: ['gpt-current'], selected_model: 'gpt-current', reasoning_efforts: []
      }
    }
  };
  const selected = selectAiProvider(registry, '', '', 'deepseek-legacy');
  assert.equal(selected.model, 'gpt-current');
});

test('partial edits retain a legacy provider ID and its model catalog', () => {
  const existing = {
    id: '合聚ai', name: '合聚ai', base_url: 'https://example.test/v1', api_key: 'key', api_mode: 'responses',
    models: ['codex-auto-review', 'gpt-5.4'], selected_model: 'codex-auto-review', reasoning_efforts: []
  };
  const updated = normalizeAiProviderDraft({ selected_model: 'gpt-5.4' }, existing);
  assert.equal(updated.id, '合聚ai');
  assert.deepEqual(updated.models, existing.models);
  assert.equal(updated.selected_model, 'gpt-5.4');
});
