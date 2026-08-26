import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}

async function waitForHealth(baseUrl) {
  let lastError;
  for (let index = 0; index < 50; index += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error('test server did not start');
}

test('daily memory API keeps raw messages and creates traceable pending memories', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forward-memory-api-'));
  const mock = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const payload = JSON.parse(raw || '{}');
    const allText = JSON.stringify(payload.messages || payload.input || '');
    const organizer = allText.includes('每日记忆整理器');
    const content = organizer
      ? JSON.stringify({ summary: '用户今天确定了补考复习计划。', memory_candidates: [{ kind: 'decision', content: '用户决定今晚复习高等数学错题。', project: '9 月 5 日补考', importance: 4, tags: ['补考'], source_message_indexes: [0] }], project_updates: [{ project: '9 月 5 日补考', summary: '确定今晚复习错题。' }], update_suggestions: [] })
      : JSON.stringify({ reply: '已经记录。', actions: [], memory_candidates: [] });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  const mockPort = await listen(mock);
  const configPath = path.join(directory, 'providers.json');
  await writeFile(configPath, JSON.stringify({ active_profile: 'test', profiles: { test: { name: '测试模型', base_url: `http://127.0.0.1:${mockPort}/v1`, api_key: 'test-key', api_mode: 'chat_completions', models: ['test-model'], selected_model: 'test-model' } } }));
  const port = 20000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const appServer = spawn(process.execPath, ['server/index.mjs'], {
    cwd: path.resolve('.'), env: { ...process.env, PORT: String(port), VAULT_PATH: directory, AI_PROVIDERS_FILE: configPath, AI_BASE_URL: '', AI_API_KEY: '', AI_MODEL: '' },
    stdio: 'ignore'
  });
  try {
    await waitForHealth(baseUrl);
    const chat = await fetch(`${baseUrl}/api/assistant/respond`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '我决定今晚复习高等数学错题。', conversation_mode: 'assistant', conversation_options: { memory_scope: true, save_full_conversation: true, allow_memory_distillation: false } })
    });
    assert.equal(chat.status, 200);
    const daily = await fetch(`${baseUrl}/api/assistant/memory/daily-run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const dailyPayload = await daily.json();
    assert.equal(daily.status, 200);
    assert.equal(dailyPayload.run.status, 'completed');
    assert.equal(dailyPayload.created.length, 1);
    assert.equal(dailyPayload.created[0].status, 'pending_review');
    assert.equal(dailyPayload.created[0].source_message_ids.length, 1);
    const state = await (await fetch(`${baseUrl}/api/assistant/state`)).json();
    assert.equal(state.state.messages.length, 2);
    assert.equal(state.state.daily_memory_summaries.length, 1);
    const search = await fetch(`${baseUrl}/api/assistant/memory/search?q=%E9%AB%98%E6%95%B0%E9%94%99%E9%A2%98`);
    const searchPayload = await search.json();
    assert.equal(search.status, 200);
    assert.equal(searchPayload.results[0].item.id, dailyPayload.created[0].id);
    const archive = await fetch(`${baseUrl}/api/assistant/memory/export`);
    const archivePayload = await archive.json();
    assert.equal(archive.status, 200);
    assert.equal(archivePayload.schema_version, 1);
    assert.equal(archivePayload.raw_conversations[0].messages.length, 2);
    assert.equal(archivePayload.memory_items[0].id, dailyPayload.created[0].id);
  } finally {
    appServer.kill('SIGTERM');
    await new Promise((resolve) => mock.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
