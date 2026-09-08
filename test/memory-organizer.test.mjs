import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDailyMemoryResult, memoryDedupeKey, parseDailyMemoryResult, rawMessagesForDay, searchMemory } from '../server/memory-organizer.mjs';

function stateFixture() {
  return {
    projects: [{ id: 'exam', name: '补考' }, { id: 'brain', name: '第二大脑' }],
    threads: [
      { id: 'normal', mode: 'assistant', save_full_conversation: true, project_id: 'brain' },
      { id: 'temp', mode: 'temporary', save_full_conversation: false, project_id: null }
    ],
    messages: [
      { id: 'm1', thread_id: 'normal', role: 'user', content: '我决定每天晚上十点半开始复盘。', created_at: '2026-08-26T10:00:00+08:00' },
      { id: 'm2', thread_id: 'normal', role: 'assistant', content: '已记录。', created_at: '2026-08-26T10:01:00+08:00' },
      { id: 'm3', thread_id: 'temp', role: 'user', content: '临时秘密内容', created_at: '2026-08-26T10:02:00+08:00' },
      { id: 'm4', thread_id: 'normal', role: 'assistant', content: 'upstream fixture failure', failure: true, is_error: true, created_at: '2026-08-26T10:03:00+08:00' }
    ],
    memory_items: [], daily_memory_summaries: []
  };
}

test('daily raw selection permanently excludes temporary conversations', () => {
  const messages = rawMessagesForDay(stateFixture(), '2026-08-26');
  assert.deepEqual(messages.map((item) => item.id), ['m1', 'm2']);
  assert.equal(messages[0].index, 0);
});

test('daily organizer candidates keep traceable sources and never overwrite existing memories', () => {
  const state = stateFixture();
  const messages = rawMessagesForDay(state, '2026-08-26');
  const parsed = parseDailyMemoryResult(JSON.stringify({
    summary: '用户确定了每日复盘时间。',
    memory_candidates: [{ kind: 'decision', content: '用户决定每天晚上 22:30 开始复盘。', project: '第二大脑', importance: 4, tags: ['复盘'], source_message_indexes: [0] }],
    project_updates: [{ project: '第二大脑', summary: '明确了每日复盘习惯。' }],
    update_suggestions: []
  }), { state, messages });
  const first = applyDailyMemoryResult(state, parsed, { date: '2026-08-26', provider_id: 'p', model: 'm', run_id: 'run', now: '2026-08-26T23:00:00+08:00' });
  assert.equal(first.created.length, 1);
  assert.deepEqual(first.created[0].source_message_ids, ['m1']);
  assert.equal(first.created[0].status, 'pending_review');
  const second = applyDailyMemoryResult(state, parsed, { date: '2026-08-26', provider_id: 'p', model: 'm', run_id: 'run2', now: '2026-08-26T23:10:00+08:00' });
  assert.equal(second.created.length, 0);
  assert.equal(state.memory_items.length, 1);
});

test('memory search returns derived memory with its source trace', () => {
  const state = stateFixture();
  state.memory_items = [{ id: 'memory-1', status: 'active', kind: 'decision', content: '用户决定每天晚上 22:30 开始复盘。', tags: ['复盘'], importance: 4, project_id: 'brain', source_message_ids: ['m1'], created_at: '2026-08-26T23:00:00+08:00' }];
  const results = searchMemory(state, '晚上复盘', { projectId: 'brain' });
  assert.equal(results.length, 1);
  assert.equal(results[0].type, 'memory');
  assert.deepEqual(results[0].item.source_message_ids, ['m1']);
});

test('source-based memory key is stable across candidate wording and source order', () => {
  const first = memoryDedupeKey({ kind: 'decision', project_id: 'brain', source_message_ids: ['m2', 'm1'] });
  const second = memoryDedupeKey({ kind: 'decision', project_id: 'brain', source_message_ids: ['m1', 'm2'] });
  assert.equal(first, second);
  assert.notEqual(first, memoryDedupeKey({ kind: 'fact', project_id: 'brain', source_message_ids: ['m1', 'm2'] }));
});

test('same source identity is rejected even when wording changes', () => {
  const state = stateFixture();
  const first = applyDailyMemoryResult(state, {
    summary: '', projectUpdates: [], updateSuggestions: [],
    candidates: [{ kind: 'decision', content: '每天晚上十点半复盘。', project_id: 'brain', importance: 4, tags: [], source_message_ids: ['m1'], source_thread_ids: ['normal'] }]
  }, { date: '2026-08-26', run_id: 'run-1', now: '2026-08-26T23:00:00+08:00' });
  const second = applyDailyMemoryResult(state, {
    summary: '', projectUpdates: [], updateSuggestions: [],
    candidates: [{ kind: 'decision', content: '每日 22:30 进行复盘。', project_id: 'brain', importance: 4, tags: [], source_message_ids: ['m1'], source_thread_ids: ['normal'] }]
  }, { date: '2026-08-26', run_id: 'run-2', now: '2026-08-26T23:10:00+08:00' });
  assert.equal(first.created.length, 1);
  assert.equal(second.created.length, 0);
  assert.deepEqual(second.duplicate_ids, [first.created[0].id]);
});
