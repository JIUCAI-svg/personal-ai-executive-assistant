import test from 'node:test';
import assert from 'node:assert/strict';
import { clearThreadDraft, draftStorageKey, migrateThreadDraft, readThreadDraft, writeThreadDraft } from '../src/draft-persistence.mjs';
import { resolveDraftOnThreadAssignment, acceptsThreadResponse, acceptsActiveThreadResponse, stateMergeDecision } from '../src/thread-draft-transitions.mjs';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

test('drafts use independent per-thread keys and round-trip', () => {
  const store = storage();
  assert.equal(draftStorageKey('a'), 'forward.thread.draft.a');
  writeThreadDraft('a', 'first', store);
  writeThreadDraft('b', 'second', store);
  assert.equal(readThreadDraft('a', store), 'first');
  assert.equal(readThreadDraft('b', store), 'second');
  clearThreadDraft('a', store);
  assert.equal(readThreadDraft('a', store), '');
  assert.equal(readThreadDraft('b', store), 'second');
});

test('real thread assignment migrates the latest waiting draft without overwriting it', () => {
  const store = storage();
  writeThreadDraft(null, '下一条消息', store);
  assert.equal(migrateThreadDraft(null, 'server-1', readThreadDraft(null, store), store), true);
  assert.equal(readThreadDraft('server-1', store), '下一条消息');
  assert.equal(readThreadDraft(null, store), '');
});

test('thread switch preserves old draft and restores target draft', () => {
  const store = storage();
  writeThreadDraft('android-a', 'A 草稿', store);
  writeThreadDraft('android-b', 'B 草稿', store);
  const old = readThreadDraft('android-a', store);
  writeThreadDraft('android-a', 'A 后续输入', store);
  assert.equal(old, 'A 草稿');
  assert.equal(readThreadDraft('android-b', store), 'B 草稿');
});

test('pending input wins when null thread receives server id', () => {
  const result = resolveDraftOnThreadAssignment({ currentThreadId: null, nextThreadId: 'server-1', pendingInput: '下一条', targetDraft: '旧目标稿' });
  assert.equal(result.draft, '下一条');
  assert.equal(result.migrate, true);
});

test('target draft restores only when no pending input exists', () => {
  const result = resolveDraftOnThreadAssignment({ currentThreadId: null, nextThreadId: 'server-1', pendingInput: '', targetDraft: '目标稿' });
  assert.equal(result.draft, '目标稿');
  assert.equal(result.migrate, false);
});

test('late response from thread A is rejected after switching to B', () => {
  assert.equal(acceptsThreadResponse({ currentThreadId: 'B', requestThreadId: 'A', responseThreadId: 'A' }), false);
  assert.equal(acceptsThreadResponse({ currentThreadId: 'A', requestThreadId: 'A', responseThreadId: 'A' }), true);
});

test('response decision reads active thread at response time', () => {
  let active = 'A';
  const request = 'A';
  active = 'B';
  assert.equal(acceptsActiveThreadResponse({ getCurrentThreadId: () => active, requestThreadId: request, responseThreadId: 'A' }), false);
  active = null;
  assert.equal(acceptsActiveThreadResponse({ getCurrentThreadId: () => active, requestThreadId: null, responseThreadId: 'server-1' }), true);
});

test('state revision can be stale while reply remains accepted', () => {
  assert.deepEqual(stateMergeDecision(false), { mergeState: false, keepReply: true });
});

test('draft helpers tolerate unavailable storage and missing thread', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(readThreadDraft('a', broken), '');
  assert.equal(writeThreadDraft('a', 'x', broken), false);
  assert.equal(clearThreadDraft('a', broken), false);
  assert.equal(readThreadDraft('', broken), '');
});
