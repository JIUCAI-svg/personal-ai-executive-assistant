import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createLargeHistoryFixture } from './fixtures/large-history.mjs';

async function waitForHealth(baseUrl) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('test server did not start');
}

async function measuredFetch(url, options) {
  const started = performance.now();
  const response = await fetch(url, options);
  const headersMs = performance.now() - started;
  const text = await response.text();
  return { response, payload: JSON.parse(text), bytes: Buffer.byteLength(text), headers_ms: +headersMs.toFixed(2), total_ms: +(performance.now() - started).toFixed(2) };
}

test('large retained history stays intact while UI state/action/memory payloads are lightweight', async () => {
  const fixture = await createLargeHistoryFixture({ imageBytes: 8_400_000 });
  const port = 24000 + Math.floor(Math.random() * 500);
  const baseUrl = `http://127.0.0.1:${port}`;
  const appServer = spawn(process.execPath, ['server/index.mjs'], {
    cwd: path.resolve('.'),
    env: { ...process.env, PORT: String(port), VAULT_PATH: fixture.directory, AI_PROVIDERS_FILE: fixture.configPath,
      AI_BASE_URL: '', AI_API_KEY: '', AI_MODEL: '', AI_GATEWAY_TOKEN: '', SUPABASE_URL: '', SUPABASE_ANON_KEY: '' },
    stdio: 'ignore'
  });
  try {
    await waitForHealth(baseUrl);
    const fullMeasurement = await measuredFetch(`${baseUrl}/api/assistant/state`);
    const full = fullMeasurement.payload;
    assert.equal(fullMeasurement.response.status, 200);
    assert.ok(fullMeasurement.bytes > 8_000_000);
    assert.equal(full.state.messages.length, 2001);
    assert.equal(full.state.messages.at(-1).attachments[0].data_url, fixture.image);

    const uiMeasurement = await measuredFetch(`${baseUrl}/api/assistant/state?view=ui`);
    const ui = uiMeasurement.payload;
    assert.equal(uiMeasurement.response.status, 200);
    assert.ok(uiMeasurement.bytes < 100_000);
    assert.equal(ui.state.projection, 'ui');
    assert.equal(ui.state.messages, undefined);
    assert.equal(ui.state.history_counts.messages, 2001);
    assert.equal(ui.state.history_counts.action_logs, 2000);

    const actionOptions = {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Assistant-View': 'ui' },
      body: JSON.stringify({ thread_id: fixture.thread.id, actions: [{ type: 'start_task_timer', task_id: full.state.tasks[0].id }] })
    };
    const actionMeasurement = await measuredFetch(`${baseUrl}/api/assistant/actions`, actionOptions);
    const action = actionMeasurement.payload;
    assert.equal(action.ok, true);
    assert.equal(action.state.projection, 'ui');
    assert.equal(action.state.messages, undefined);
    assert.ok(actionMeasurement.bytes < 100_000);
    const fullActionMeasurement = await measuredFetch(`${baseUrl}/api/assistant/actions`, {
      ...actionOptions, headers: { 'Content-Type': 'application/json' }
    });
    assert.equal(fullActionMeasurement.payload.state.time_sessions.filter((item) => item.status === 'running').length, 1);

    const memoryOptions = {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Assistant-View': 'ui' },
      body: JSON.stringify({ status: 'active' })
    };
    const memoryMeasurement = await measuredFetch(`${baseUrl}/api/assistant/memories/fixture-memory`, memoryOptions);
    const memory = memoryMeasurement.payload;
    assert.equal(memory.ok, true);
    assert.equal(memory.state.projection, 'ui');
    assert.equal(memory.state.messages, undefined);
    assert.ok(memoryMeasurement.bytes < 100_000);
    const fullMemoryMeasurement = await measuredFetch(`${baseUrl}/api/assistant/memories/fixture-memory`, {
      ...memoryOptions, headers: { 'Content-Type': 'application/json' }
    });
    assert.ok(fullMemoryMeasurement.bytes > 8_000_000);
    assert.equal(fullMemoryMeasurement.payload.state.memory_items[0].status, 'active');

    const history = await (await fetch(`${baseUrl}/api/assistant/threads/${fixture.thread.id}?limit=1`)).json();
    assert.equal(history.thread.messages.length, 1);
    assert.ok(history.thread.messages[0].attachments[0].data_url.length > 8_000_000);
    const archive = await (await fetch(`${baseUrl}/api/assistant/memory/export?view=ui`)).json();
    assert.equal(archive.raw_conversations[0].messages.length, 2001);
    assert.equal(archive.raw_conversations[0].messages.at(-1).attachments[0].data_url, fixture.image);
    const persisted = await fixture.store.read();
    assert.equal(persisted.messages.length, 2001);
    assert.equal(persisted.messages.at(-1).attachments[0].data_url, fixture.image);
    assert.equal(persisted.action_logs.filter((item) => item.type === 'fixture').length, 2000);
    assert.equal(persisted.memory_items[0].status, 'active');
    console.log(JSON.stringify({ latency_fixture: [
      ['state_full', fullMeasurement], ['state_ui', uiMeasurement], ['action_full', fullActionMeasurement],
      ['action_ui', actionMeasurement], ['memory_full', fullMemoryMeasurement], ['memory_ui', memoryMeasurement]
    ].map(([name, { bytes, headers_ms, total_ms }]) => ({ name, bytes, headers_ms, total_ms })) }));
  } finally {
    appServer.kill('SIGTERM');
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
