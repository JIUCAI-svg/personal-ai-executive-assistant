import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function shanghaiDate(offset = 0) {
  const pieces = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (type) => pieces.find((part) => part.type === type)?.value || '';
  const date = new Date(Date.UTC(Number(value('year')), Number(value('month')) - 1, Number(value('day')) + offset));
  return date.toISOString().slice(0, 10);
}

async function waitForHealth(baseUrl) {
  let lastError;
  for (let index = 0; index < 40; index += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error('test server did not start');
}

test('usage endpoint persists a sleep/wake candidate into assistant state', async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), 'forward-api-test-'));
  const port = 19000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: path.resolve('.'), env: { ...process.env, PORT: String(port), VAULT_PATH: vault, AI_BASE_URL: '', AI_API_KEY: '', AI_MODEL: '' },
    stdio: 'ignore'
  });
  try {
    await waitForHealth(baseUrl);
    const yesterday = shanghaiDate(-1);
    const today = shanghaiDate();
    const response = await fetch(`${baseUrl}/api/assistant/usage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        device_activity: { date: yesterday, last_active_at: `${yesterday}T23:20:00`, last_foreground_app: '浏览器', source: 'test' }
      })
    });
    assert.equal(response.status, 200);
    const second = await fetch(`${baseUrl}/api/assistant/usage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        device_activity: { date: today, first_active_at: `${today}T07:40:00`, first_foreground_app: '微信', source: 'test' }
      })
    });
    assert.equal(second.status, 200);
    const stateResponse = await fetch(`${baseUrl}/api/assistant/state`);
    const payload = await stateResponse.json();
    assert.equal(stateResponse.status, 200);
    assert.equal(payload.state.sleep_wake_summary.latest.status, 'candidate');
    assert.equal(payload.state.sleep_wake_summary.latest.wake_time, '07:40');
  } finally {
    server.kill('SIGTERM');
    await rm(vault, { recursive: true, force: true });
  }
});
