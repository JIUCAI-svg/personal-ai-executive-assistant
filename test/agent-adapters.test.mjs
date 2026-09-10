import assert from 'node:assert/strict';
import test from 'node:test';
import { codexConfig, parseCodexOutput } from '../server/agent-adapters.mjs';

test('Codex parser keeps commentary out of the final reply', () => {
  const output = [
    JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: '我先读取当前时间。', phase: 'commentary' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '我先读取当前时间。', phase: 'commentary' } }),
    JSON.stringify({ type: 'function_call', name: 'get_now' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '闹钟已设置。', phase: 'final_answer' } })
  ].join('\n');
  assert.equal(parseCodexOutput(output).content, '闹钟已设置。');
});

test('Codex parser prefers the completed turn result', () => {
  const output = [
    JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: '准备执行。', phase: 'commentary' } }),
    JSON.stringify({ type: 'turn.completed', last_message: '已完成并返回结果。' })
  ].join('\n');
  assert.equal(parseCodexOutput(output).content, '已完成并返回结果。');
});

test('Codex parser does not invent a reply from JSON diagnostics', () => {
  const output = [
    JSON.stringify({ type: 'thread.started', thread_id: 'THREAD' }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: '正在处理。', phase: 'commentary' } })
  ].join('\n');
  assert.deepEqual(parseCodexOutput(output), { content: '', sessionId: 'THREAD' });
});

test('Codex parser preserves long completed replies', () => {
  const reply = '长回复'.repeat(6000);
  const output = JSON.stringify({ type: 'turn.completed', last_message: reply });
  assert.equal(parseCodexOutput(output).content, reply);
});

test('Codex config keeps responses wire protocol (codex dropped chat wire)', () => {
  const chatProvider = {
    base_url: 'https://metapi.example/v1', api_key: 'sk-test',
    model: 'glm-5.3-flash-group', api_mode: 'chat_completions'
  };
  // Current codex CLI builds refuse `wire_api = "chat"` at config-load time,
  // so the generated config must stay responses-only; protocol conversion
  // belongs to the gateway, not to the generated config.
  const chatConfig = codexConfig(chatProvider, 'https://gateway.example/mcp', 'token');
  assert.ok(!chatConfig.includes('wire_api'));
  assert.match(chatConfig, /base_url = "https:\/\/metapi\.example\/v1"/);

  const responsesProvider = { ...chatProvider, api_mode: 'responses' };
  const responsesConfig = codexConfig(responsesProvider, 'https://gateway.example/mcp', 'token');
  assert.ok(!responsesConfig.includes('wire_api'));
});
