import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstreamFailurePattern = /upstream fixture failure/i;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(250) });
      if (response.ok) return;
    } catch {}
    await wait(100);
  }
  throw new Error(`test server did not start at ${baseUrl}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, wait(2_000)]);
}

function randomPort() {
  return 36_000 + Math.floor(Math.random() * 8_000);
}

async function createClaudeFailureFixture(directory) {
  const fixture = path.join(directory, 'claude-failure-fixture.mjs');
  await writeFile(fixture, "process.stderr.write('upstream fixture failure\\n'); process.exit(17);\n", 'utf8');
  return fixture;
}

async function startServer({ vaultPath, providersPath, claudeFixture, port }) {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: appRoot,
    env: {
      ...process.env,
      PORT: String(port),
      VAULT_PATH: vaultPath,
      AI_PROVIDERS_FILE: providersPath,
      AI_ACTIVE_PROFILE: 'test',
      AI_BASE_URL: '',
      AI_API_KEY: '',
      AI_MODEL: '',
      AI_GATEWAY_TOKEN: '',
      FORWARD_CLAUDE_EXECUTABLE: process.execPath,
      FORWARD_CLAUDE_EXECUTABLE_ARGS: JSON.stringify([claudeFixture])
    },
    stdio: 'ignore',
    windowsHide: true
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl);
  } catch (error) {
    await stopServer(child);
    throw error;
  }
  return { child, baseUrl };
}

async function jsonResponse(response) {
  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`expected JSON response (${response.status}): ${raw}`);
  }
}

test('Agent failure is persisted, recoverable after restart, and rendered as a failed run', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forward-agent-failure-api-'));
  const binPath = path.join(root, 'bin');
  const providersPath = path.join(root, 'providers.json');
  await mkdir(binPath, { recursive: true });
  const claudeFixture = await createClaudeFailureFixture(binPath);
  await writeFile(providersPath, JSON.stringify({
    active_profile: 'test',
    profiles: {
      test: {
        name: '测试模型',
        base_url: 'http://127.0.0.1:9/v1',
        api_key: 'test-key',
        api_mode: 'chat_completions',
        models: ['test-model'],
        selected_model: 'test-model'
      }
    }
  }), 'utf8');

  let appServer = null;
  const requestId = 'agent-failure-001';
  try {
    let port = randomPort();
    appServer = await startServer({ vaultPath: root, providersPath, claudeFixture, port });
    const { baseUrl } = appServer;
    const createdResponse = await fetch(`${baseUrl}/api/assistant/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_mode: 'assistant',
        conversation_options: {
          memory_scope: true,
          save_full_conversation: true,
          allow_memory_distillation: false
        }
      })
    });
    assert.equal(createdResponse.status, 201);
    const created = await jsonResponse(createdResponse);
    const threadId = created.thread?.id;
    assert.ok(threadId);

    const failedResponse = await fetch(`${baseUrl}/api/assistant/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: requestId,
        message: '执行一个会失败的 Agent 请求。',
        thread_id: threadId,
        conversation_mode: 'assistant',
        agent_engine: 'claude_code'
      })
    });
    const failedPayload = await jsonResponse(failedResponse);
    assert.equal(failedResponse.status, 502);
    assert.equal(failedPayload.code, 'AGENT_ENGINE_FAILED');
    assert.match(failedPayload.error, upstreamFailurePattern);
    assert.equal(failedPayload.request_id, requestId);
    assert.equal(failedPayload.thread_id, threadId);
    assert.equal(failedPayload.run?.status, 'failed');
    assert.equal(failedPayload.run?.error_code, 'AGENT_ENGINE_FAILED');

    const immediateRunResponse = await fetch(`${baseUrl}/api/assistant/runs/${requestId}`);
    assert.equal(immediateRunResponse.status, 200);
    const immediateRunPayload = await jsonResponse(immediateRunResponse);
    assert.equal(immediateRunPayload.run.status, 'failed');
    assert.match(immediateRunPayload.run.error, upstreamFailurePattern);
    assert.equal(immediateRunPayload.run.error_code, 'AGENT_ENGINE_FAILED');
    assert.equal(immediateRunPayload.run.thread_id, threadId);
    assert.ok(immediateRunPayload.run.message_ids.user);
    assert.ok(immediateRunPayload.run.message_ids.error);

    const detailResponse = await fetch(`${baseUrl}/api/assistant/threads/${threadId}`);
    assert.equal(detailResponse.status, 200);
    const detail = await jsonResponse(detailResponse);
    const failureMessage = detail.thread.messages.find((message) => message.request_id === requestId && message.failure === true);
    assert.ok(failureMessage);
    assert.equal(failureMessage.role, 'assistant');
    assert.equal(failureMessage.is_error, true);
    assert.equal(failureMessage.error_code, 'AGENT_ENGINE_FAILED');
    assert.match(failureMessage.content, upstreamFailurePattern);

    await stopServer(appServer.child);
    // A new listener port proves recovery comes from the vault rather than
    // any stale socket or process-local run map.
    port = randomPort();
    appServer = await startServer({ vaultPath: root, providersPath, claudeFixture, port });

    const recoveredRunResponse = await fetch(`${appServer.baseUrl}/api/assistant/runs/${requestId}`);
    assert.equal(recoveredRunResponse.status, 200);
    const recoveredRunPayload = await jsonResponse(recoveredRunResponse);
    assert.equal(recoveredRunPayload.run.status, 'failed');
    assert.match(recoveredRunPayload.run.error, upstreamFailurePattern);
    assert.equal(recoveredRunPayload.run.error_code, 'AGENT_ENGINE_FAILED');
    assert.equal(recoveredRunPayload.run.thread_id, threadId);
    assert.ok(recoveredRunPayload.run.message_ids.error);

    const sseResponse = await fetch(`${appServer.baseUrl}/api/assistant/runs/${requestId}/events`);
    assert.equal(sseResponse.status, 200);
    assert.match(sseResponse.headers.get('content-type') || '', /text\/event-stream/);
    const sseText = await sseResponse.text();
    assert.match(sseText, /event: failed/);
    assert.match(sseText, upstreamFailurePattern);
    assert.doesNotMatch(sseText, /event: closed/);
  } finally {
    await stopServer(appServer?.child);
    await rm(root, { recursive: true, force: true });
  }
});
