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
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('test server did not start');
}

test('server scheduler is enabled without duplicating an already completed day', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forward-memory-scheduler-'));
  const mock = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: '自动整理完成。', memory_candidates: [], project_updates: [], update_suggestions: [] }) } }] }));
  });
  const mockPort = await listen(mock);
  const configPath = path.join(directory, 'providers.json');
  await writeFile(configPath, JSON.stringify({ active_profile: 'test', profiles: { test: {
    name: '测试模型', base_url: `http://127.0.0.1:${mockPort}/v1`, api_key: 'test-key', api_mode: 'chat_completions', models: ['test-model'], selected_model: 'test-model'
  } } }));
  const port = 23000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const appServer = spawn(process.execPath, ['server/index.mjs'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(port), VAULT_PATH: directory, AI_PROVIDERS_FILE: configPath, AI_BASE_URL: '', AI_API_KEY: '', AI_MODEL: '' }, stdio: 'ignore' });
  try {
    await waitForHealth(baseUrl);
    const health = await (await fetch(`${baseUrl}/api/health`)).json();
    assert.equal(health.ok, true);
    const state = JSON.parse(await readFile(path.join(directory, '.forward-assistant', 'state.json'), 'utf8'));
    assert.equal(state.ai_preferences.memory_daily_time, '22:00');
    assert.equal(state.ai_preferences.memory_auto_daily, true);
  } finally {
    appServer.kill('SIGTERM');
    await new Promise((resolve) => mock.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
