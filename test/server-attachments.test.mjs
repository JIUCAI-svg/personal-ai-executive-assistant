import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AssistantStateStore } from '../server/state-store.mjs';

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

test('appendMessage persists inline images as gateway file references', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forward-att-store-'));
  try {
    const store = new AssistantStateStore(directory);
    const thread = await store.createThread({ mode: 'assistant', save_full_conversation: true });
    const message = await store.appendMessage(
      { id: thread.id, save_full_conversation: true },
      'user', '帮我看一下这张图', null,
      [{ data_url: TINY_PNG, name: 't.png', type: 'image/png' }]
    );
    assert.match(message.attachments[0].url, /^\/api\/attachments\/.+/);
    assert.ok(!message.attachments[0].data_url, 'inline data_url must not be persisted');
    const filePath = store.attachmentFilePath(path.basename(message.attachments[0].url));
    assert.ok(existsSync(filePath), 'attachment file should exist on disk');

    const detail = await store.getThreadMessages(thread.id, 200);
    assert.equal(detail.messages.at(-1).attachments[0].url, message.attachments[0].url);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('migrateMessageAttachmentsToFiles moves legacy inline images out of the state', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forward-att-migrate-'));
  try {
    const store = new AssistantStateStore(directory);
    const thread = await store.createThread({ mode: 'assistant', save_full_conversation: true });
    // Hand-write a legacy inline attachment the way old builds stored them.
    await store.mutate((state) => {
      state.messages.push({
        id: 'legacy-1', thread_id: thread.id, role: 'user', content: '旧图片',
        action_result: null, attachments: [{ data_url: TINY_PNG, name: 'old.png', type: '' }],
        request_id: null, created_at: '2026-09-01T12:00:00+08:00'
      });
      return null;
    });
    const result = await store.migrateMessageAttachmentsToFiles();
    assert.equal(result.converted, 1);
    const detail = await store.getThreadMessages(thread.id, 200);
    assert.match(detail.messages[0].attachments[0].url, /^\/api\/attachments\//);
    assert.ok(!detail.messages[0].attachments[0].data_url);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('getThreadMessages after parameter returns only newer messages', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forward-att-after-'));
  try {
    const store = new AssistantStateStore(directory);
    const thread = await store.createThread({ mode: 'assistant', save_full_conversation: true });
    const first = await store.appendMessage({ id: thread.id, save_full_conversation: true }, 'user', '第一条', null, []);
    const second = await store.appendMessage({ id: thread.id, save_full_conversation: true }, 'assistant', '第二条', null, []);
    const detail = await store.getThreadMessages(thread.id, 200, first.id);
    assert.equal(detail.incremental, true);
    assert.equal(detail.messages.length, 1);
    assert.equal(detail.messages[0].id, second.id);
    // An unknown anchor falls back to the full transcript.
    const fallback = await store.getThreadMessages(thread.id, 200, 'missing-id');
    assert.equal(fallback.incremental, false);
    assert.equal(fallback.messages.length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('attachment files are served only through the gateway token', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forward-att-http-'));
  const port = 22300 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const appServer = spawn(process.execPath, ['server/index.mjs'], {
    cwd: path.resolve('.'),
    env: { ...process.env, PORT: String(port), VAULT_PATH: directory, AI_BASE_URL: '', AI_API_KEY: '', AI_MODEL: '', AI_GATEWAY_TOKEN: 'test-token' },
    stdio: 'ignore'
  });
  try {
    await waitForHealth(baseUrl);
    const store = new AssistantStateStore(directory);
    const saved = await store.storeAttachmentDataUrl(TINY_PNG, 'probe');
    assert.ok(saved);
    const file = path.basename(saved.url);

    const ok = await fetch(`${baseUrl}/api/attachments/${file}`, { headers: { 'x-forward-token': 'test-token' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/png');

    // Local requests are allowed without a token by design; a request that
    // arrives through the proxy from an outside address must present it.
    const denied = await fetch(`${baseUrl}/api/attachments/${file}`, { headers: { 'X-Forwarded-For': '203.0.113.7' } });
    assert.equal(denied.status, 401);

    const traversal = await fetch(`${baseUrl}/api/attachments/..%2Fstate.json`, { headers: { 'x-forward-token': 'test-token' } });
    assert.equal(traversal.status, 404);
  } finally {
    appServer.kill('SIGTERM');
    await rm(directory, { recursive: true, force: true });
  }
});
