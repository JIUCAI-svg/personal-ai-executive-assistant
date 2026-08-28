import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}

async function waitForHealth(baseUrl) {
  for (let index = 0; index < 50; index += 1) {
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('test server did not start');
}

test('chat alarm action is persisted and returned as a device action', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forward-alarm-api-'));
  const mock = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    assert.equal(request.url, '/v1/chat/completions');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      reply: '已为你设置手机闹钟。',
      actions: [{ type: 'set_alarm', time: '08:00', date: '2026-08-27', label: '起床提醒', repeat: 'none' }],
      memory_candidates: []
    }) } }] }));
  });
  const mockPort = await listen(mock);
  const configPath = path.join(directory, 'providers.json');
  await writeFile(configPath, JSON.stringify({ active_profile: 'test', profiles: { test: {
    name: '测试模型', base_url: `http://127.0.0.1:${mockPort}/v1`, api_key: 'test-key',
    api_mode: 'chat_completions', models: ['test-model'], selected_model: 'test-model'
  } } }));
  const port = 20000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const appServer = spawn(process.execPath, ['server/index.mjs'], {
    cwd: path.resolve('.'),
    env: { ...process.env, PORT: String(port), VAULT_PATH: directory, AI_PROVIDERS_FILE: configPath, AI_BASE_URL: '', AI_API_KEY: '', AI_MODEL: '' },
    stdio: 'ignore'
  });
  try {
    await waitForHealth(baseUrl);
    const response = await fetch(`${baseUrl}/api/assistant/respond`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '明天早上八点叫我起床', conversation_mode: 'assistant' })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.deviceActions.length, 1);
    assert.equal(payload.deviceActions[0].type, 'set_alarm');
    assert.equal(payload.deviceActions[0].label, '起床提醒');
    assert.equal(payload.actionResults.find((item) => item.type === 'set_alarm')?.ok, true);
    const state = JSON.parse(await readFile(path.join(directory, '.forward-assistant', 'state.json'), 'utf8'));
    assert.equal(state.alarms.length, 1);
    assert.equal(state.alarms[0].status, 'pending_device');
  } finally {
    appServer.kill('SIGTERM');
    await new Promise((resolve) => mock.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
