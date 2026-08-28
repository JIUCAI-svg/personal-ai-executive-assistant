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
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('test server did not start');
}

test('thread APIs preserve a selected conversation and keep temporary chat out of history', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forward-threads-api-'));
  const mock = http.createServer(async (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: '已经记录这段对话。', actions: [], memory_candidates: [] }) } }] }));
  });
  const mockPort = await listen(mock);
  const configPath = path.join(directory, 'providers.json');
  await writeFile(configPath, JSON.stringify({ active_profile: 'test', profiles: { test: {
    name: '测试模型', base_url: `http://127.0.0.1:${mockPort}/v1`, api_key: 'test-key',
    api_mode: 'chat_completions', models: ['test-model'], selected_model: 'test-model'
  } } }));
  const port = 22000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const appServer = spawn(process.execPath, ['server/index.mjs'], {
    cwd: path.resolve('.'),
    env: { ...process.env, PORT: String(port), VAULT_PATH: directory, AI_PROVIDERS_FILE: configPath, AI_BASE_URL: '', AI_API_KEY: '', AI_MODEL: '' },
    stdio: 'ignore'
  });
  try {
    await waitForHealth(baseUrl);
    const state = await (await fetch(`${baseUrl}/api/assistant/state`)).json();
    const project = state.state.projects[0];
    assert.ok(project?.id);

    const created = await (await fetch(`${baseUrl}/api/assistant/threads`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_mode: 'project', project_id: project.id, project: project.name, conversation_options: {
        memory_scope: true, save_full_conversation: true, allow_memory_distillation: true
      } })
    })).json();
    assert.equal(created.thread.mode, 'project');
    assert.equal(created.thread.project_id, project.id);

    const changed = await (await fetch(`${baseUrl}/api/assistant/threads/${created.thread.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_options: {
        memory_scope: false, save_full_conversation: true, allow_memory_distillation: false
      } })
    })).json();
    assert.equal(changed.thread.memory_scope, false);
    assert.equal(changed.thread.allow_memory_distillation, false);

    const reply = await (await fetch(`${baseUrl}/api/assistant/respond`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '项目今天已经推进了一步。', thread_id: created.thread.id, conversation_mode: 'project' })
    })).json();
    assert.equal(reply.thread.id, created.thread.id);

    const list = await (await fetch(`${baseUrl}/api/assistant/threads`)).json();
    assert.equal(list.threads.length, 1);
    assert.equal(list.threads[0].id, created.thread.id);
    assert.equal(list.threads[0].message_count, 2);

    const detail = await (await fetch(`${baseUrl}/api/assistant/threads/${created.thread.id}`)).json();
    assert.equal(detail.thread.messages.length, 2);
    assert.deepEqual(detail.thread.messages.map((message) => message.role), ['user', 'assistant']);

    const temporary = await (await fetch(`${baseUrl}/api/assistant/threads`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_mode: 'temporary', conversation_options: {
        memory_scope: false, save_full_conversation: false, allow_memory_distillation: false
      } })
    })).json();
    assert.equal(temporary.thread.mode, 'temporary');
    const listAfterTemporary = await (await fetch(`${baseUrl}/api/assistant/threads`)).json();
    assert.equal(listAfterTemporary.threads.length, 1);
  } finally {
    appServer.kill('SIGTERM');
    await new Promise((resolve) => mock.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
