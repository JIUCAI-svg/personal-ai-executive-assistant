import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function waitForHealth(baseUrl) {
  for (let index = 0; index < 50; index += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('test server did not start');
}

test('proactive AI alarm actions are returned for Android execution', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forward-proactive-api-'));
  const mock = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    assert.equal(request.url, '/v1/chat/completions');
    const body = JSON.parse(raw);
    assert.ok(Array.isArray(body.tools));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      choices: [{ message: {
        content: '',
        tool_calls: [{
          id: 'call-proactive-alarm',
          type: 'function',
          function: {
            name: 'set_alarm',
            arguments: JSON.stringify({ time: '08:30', date: '2026-08-31', label: '主动起床提醒', repeat: 'none' })
          }
        }]
      } }]
    }));
  });
  const mockPort = await listen(mock);
  const configPath = path.join(directory, 'providers.json');
  await writeFile(configPath, JSON.stringify({ active_profile: 'test', profiles: { test: {
    name: '测试模型', base_url: `http://127.0.0.1:${mockPort}/v1`, api_key: 'test-key',
    api_mode: 'chat_completions', models: ['test-model'], selected_model: 'test-model'
  } } }));
  const port = 21000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const appServer = spawn(process.execPath, ['server/index.mjs'], {
    cwd: path.resolve('.'),
    env: { ...process.env, PORT: String(port), VAULT_PATH: directory, AI_PROVIDERS_FILE: configPath, AI_BASE_URL: '', AI_API_KEY: '', AI_MODEL: '' },
    stdio: 'ignore'
  });
  try {
    await waitForHealth(baseUrl);
    const response = await fetch(`${baseUrl}/api/assistant/proactive`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: '系统检测到需要重新判断的事项。',
        observed_at: '2026-08-31T12:00:00+08:00',
        timezone: 'Asia/Shanghai'
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.deviceActions.length, 1);
    assert.equal(payload.deviceActions[0].type, 'set_alarm');
    assert.equal(payload.deviceActions[0].label, '主动起床提醒');
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

test('proactive assistant messages are persisted in the selected conversation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forward-proactive-message-'));
  const mock = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    assert.equal(request.url, '/v1/chat/completions');
    const body = JSON.parse(raw);
    assert.ok(Array.isArray(body.tools));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      choices: [{ message: {
        content: '',
        tool_calls: [{
          id: 'call-proactive-message',
          type: 'function',
          function: {
            name: 'send_proactive_message',
            arguments: JSON.stringify({ title: '向前', message: '这是一个主动消息，请在对话中继续。' })
          }
        }]
      } }]
    }));
  });
  const mockPort = await listen(mock);
  const configPath = path.join(directory, 'providers.json');
  await writeFile(configPath, JSON.stringify({ active_profile: 'test', profiles: { test: {
    name: '测试模型', base_url: `http://127.0.0.1:${mockPort}/v1`, api_key: 'test-key',
    api_mode: 'chat_completions', models: ['test-model'], selected_model: 'test-model'
  } } }));
  const port = 21500 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const appServer = spawn(process.execPath, ['server/index.mjs'], {
    cwd: path.resolve('.'),
    env: { ...process.env, PORT: String(port), VAULT_PATH: directory, AI_PROVIDERS_FILE: configPath, AI_BASE_URL: '', AI_API_KEY: '', AI_MODEL: '' },
    stdio: 'ignore'
  });
  try {
    await waitForHealth(baseUrl);
    const created = await (await fetch(`${baseUrl}/api/assistant/threads`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_mode: 'assistant', conversation_options: {
        memory_scope: true, save_full_conversation: true, allow_memory_distillation: false
      } })
    })).json();
    const threadId = created.thread.id;
    const response = await fetch(`${baseUrl}/api/assistant/proactive`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'phone_usage', thread_id: threadId,
        event: '系统检测到一项需要重新判断的事项。',
        observed_at: '2026-08-31T12:00:00+08:00', timezone: 'Asia/Shanghai',
        idempotency_key: 'proactive-message-test'
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.thread_id, threadId);
    assert.equal(payload.delivered, true);
    assert.equal(payload.persisted, true);
    assert.equal(payload.message.thread_id, threadId);
    const detail = await (await fetch(`${baseUrl}/api/assistant/threads/${threadId}`)).json();
    assert.equal(detail.thread.messages.at(-1).content, '这是一个主动消息，请在对话中继续。');
    assert.equal(detail.thread.messages.at(-1).proactive, true);
  } finally {
    appServer.kill('SIGTERM');
    await new Promise((resolve) => mock.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
