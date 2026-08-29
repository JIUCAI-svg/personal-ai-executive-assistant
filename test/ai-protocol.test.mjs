import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantEndpoint, buildAssistantModelRequest, extractAssistantText, extractAssistantToolCalls } from '../server/ai-protocol.mjs';

const messages = [
  { role: 'system', content: '系统指令' },
  { role: 'user', content: '安排任务' },
  { role: 'assistant', content: '好的' }
];

test('chat completions keeps the compatible envelope', () => {
  const provider = { base_url: 'https://example.test/v1/', api_mode: 'chat_completions', model: 'chat-model' };
  const body = buildAssistantModelRequest(provider, {
    model: 'chat-model', temperature: 0.45, reasoning_effort: 'medium', response_format: { type: 'json_object' }, messages
  });
  assert.equal(assistantEndpoint(provider), 'https://example.test/v1/chat/completions');
  assert.equal(body.model, 'chat-model');
  assert.equal(body.messages, messages);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(extractAssistantText(provider, { choices: [{ message: { content: '{"reply":"好"}' } }] }), '{"reply":"好"}');
});

test('responses uses input-text and extracts output_text', () => {
  const provider = { base_url: 'https://example.test/v1', api_mode: 'responses', model: 'gpt-test' };
  const body = buildAssistantModelRequest(provider, { model: 'gpt-test', reasoning_effort: 'low', messages });
  assert.equal(assistantEndpoint(provider), 'https://example.test/v1/responses');
  assert.deepEqual(body.text, { format: { type: 'json_object' } });
  assert.deepEqual(body.reasoning, { effort: 'low' });
  assert.deepEqual(body.input[0], { role: 'developer', content: [{ type: 'input_text', text: '系统指令' }] });
  assert.deepEqual(body.input[2], { role: 'assistant', content: [{ type: 'output_text', text: '好的' }] });
  assert.equal(extractAssistantText(provider, { output_text: '{"reply":"连接正常"}' }), '{"reply":"连接正常"}');
});

test('responses extracts text from output content when output_text is absent', () => {
  const provider = { api_mode: 'responses' };
  const response = {
    output: [{ type: 'message', content: [{ type: 'output_text', text: '{"reply":"完成"}' }] }]
  };
  assert.equal(extractAssistantText(provider, response), '{"reply":"完成"}');
});

test('chat completions carries optional tools and extracts calls', () => {
  const provider = { api_mode: 'chat_completions' };
  const tool = { type: 'function', function: { name: 'create_task', description: '创建任务', parameters: { type: 'object' } } };
  const body = buildAssistantModelRequest(provider, { model: 'm', messages, tools: [tool] });
  assert.equal(body.tool_choice, 'auto');
  assert.deepEqual(body.tools, [tool]);
  assert.deepEqual(extractAssistantToolCalls(provider, { choices: [{ message: { tool_calls: [{ id: '1', function: { name: 'create_task', arguments: '{"title":"测试"}' } }] } }] }), [{ id: '1', name: 'create_task', arguments: '{"title":"测试"}' }]);
});

test('natural text providers remain usable without JSON envelope', () => {
  const provider = { api_mode: 'chat_completions' };
  assert.equal(extractAssistantText(provider, { choices: [{ message: { content: '你好，今天继续推进。' } }] }), '你好，今天继续推进。');
});
