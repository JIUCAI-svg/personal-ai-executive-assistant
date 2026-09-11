import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function waitForHealth(baseUrl) {
  for (let index = 0; index < 50; index += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('test server did not start');
}

test('expense ingest masks codes, dedupes by key, and serves summaries', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forward-expenses-'));
  const configPath = path.join(directory, 'providers.json');
  await writeFile(configPath, JSON.stringify({ active_profile: 'test', profiles: { test: {
    name: '测试模型', base_url: 'http://127.0.0.1:9/v1', api_key: 'test-key',
    api_mode: 'chat_completions', models: ['test-model'], selected_model: 'test-model'
  } } }));
  const port = 24200 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const appServer = spawn(process.execPath, ['server/index.mjs'], {
    cwd: path.resolve('.'),
    env: { ...process.env, PORT: String(port), VAULT_PATH: directory, AI_PROVIDERS_FILE: configPath, AI_BASE_URL: '', AI_API_KEY: '', AI_MODEL: '', AI_GATEWAY_TOKEN: 'test-token' },
    stdio: 'ignore'
  });
  try {
    await waitForHealth(baseUrl);
    const headers = { 'Content-Type': 'application/json', 'x-forward-token': 'test-token' };

    const ingest = await (await fetch(`${baseUrl}/api/assistant/expenses`, {
      method: 'POST', headers,
      body: JSON.stringify({
        payments: [{ key: 'p1', amount: 25.0, direction: 'expense', source: '微信', occurred_at: '2026-09-11T12:00:00+08:00' }],
        observations: [
          { key: 'o1', package_name: 'com.tencent.mm', title: '支付宝', text: '【支付宝】验证码 482913，请勿泄露', posted_at: '2026-09-11T12:00:00+08:00' },
          { key: 'o1', package_name: 'com.tencent.mm', title: '支付宝', text: 'duplicate should be dropped', posted_at: '2026-09-11T12:01:00+08:00' }
        ]
      })
    })).json();
    assert.equal(ingest.ok, true);
    assert.equal(ingest.accepted.payments, 1);
    assert.equal(ingest.accepted.observations, 1, 'duplicate keys must be dropped');

    const stored = JSON.parse(await readFile(path.join(directory, '.forward-assistant', 'expenses.json'), 'utf8'));
    assert.ok(!JSON.stringify(stored).includes('482913'), 'verification codes must be masked at ingest');

    const query = await (await fetch(`${baseUrl}/api/assistant/expenses?limit=10`, { headers })).json();
    assert.equal(query.payments.length, 1);
    assert.equal(query.payments[0].amount, 25.0);
    assert.ok(query.summary.total_expense >= 25.0);

    // MCP query_expenses surfaces the same data to the Agent.
    const mcp = await (await fetch(`${baseUrl}/api/mcp`, {
      method: 'POST', headers,
      body: JSON.stringify({ id: 1, method: 'tools/call', params: { name: 'query_expenses', arguments: { limit: 5 } } })
    })).json();
    const content = mcp.result?.structuredContent || JSON.parse(mcp.result?.content?.[0]?.text || '{}');
    assert.equal(content.results.length, 1);

    const summary = await (await fetch(`${baseUrl}/api/mcp`, {
      method: 'POST', headers,
      body: JSON.stringify({ id: 2, method: 'tools/call', params: { name: 'expense_summary', arguments: { month: '2026-09' } } })
    })).json();
    const summaryContent = summary.result?.structuredContent || JSON.parse(summary.result?.content?.[0]?.text || '{}');
    assert.equal(summaryContent.results[0].payment_count, 1);
  } finally {
    appServer.kill('SIGTERM');
    await rm(directory, { recursive: true, force: true });
  }
});
