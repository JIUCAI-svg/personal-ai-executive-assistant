import test from 'node:test';
import assert from 'node:assert/strict';
import { createInteractionStateGuard } from '../src/interaction-state.mjs';

test('interaction guard rejects duplicate entities and timer switches until settled, then allows retry', () => {
  const guard = createInteractionStateGuard();
  assert.equal(guard.begin(['task:a', 'timer']), true);
  assert.equal(guard.begin(['task:a']), false);
  assert.equal(guard.begin(['task:b', 'timer']), false);
  assert.equal(guard.begin(['memory:m']), true);
  assert.equal(guard.begin(['memory:m']), false);
  guard.finish(['task:a', 'timer']);
  assert.equal(guard.begin(['task:b', 'timer']), true);
  guard.finish(['memory:m']);
  assert.equal(guard.begin(['memory:m']), true);
});

test('committed revisions reject late poll and mutation responses but keep independent user scopes', () => {
  const guard = createInteractionStateGuard();
  const state = (revision, scope = 'cloud:a') => ({ state_revision: revision, state_scope: scope });
  assert.equal(guard.accepts(state(7)), true);
  assert.equal(guard.accepts(state(9)), true);
  assert.equal(guard.accepts(state(8)), false);
  assert.equal(guard.accepts(state(7)), false);
  assert.equal(guard.accepts(state(9)), true);
  assert.equal(guard.accepts(state(1, 'cloud:b')), true);
  assert.equal(guard.accepts(state(0, 'cloud:b')), false);
});
