import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseStateStore } from '../server/supabase-state-store.mjs';
import { createDefaultAssistantState } from '../server/state-store.mjs';

function cloud(initialState = createDefaultAssistantState()) {
  const remote = { state: structuredClone(initialState), revision: 10, reads: 0, writes: 0, conflict: null };
  const create = (requestScoped = true, userId = 'fixture-user') => {
    const store = new SupabaseStateStore({ url: 'http://fixture.invalid', anonKey: 'fixture', accessToken: 'fixture', userId, requestScoped });
    store.request = async (endpoint, options = {}) => {
      assert.equal(options.headers.Authorization, 'Bearer fixture');
      if (!options.method) {
        assert.match(endpoint, new RegExp(`user_id=eq.${userId}`));
        remote.reads += 1;
        return remote.state ? [{ state: structuredClone(remote.state), revision: remote.revision }] : [];
      }
      assert.equal(endpoint, '/rest/v1/rpc/save_assistant_state');
      remote.writes += 1;
      if (remote.conflict) { const conflict = remote.conflict; remote.conflict = null; conflict(remote); }
      const body = JSON.parse(options.body);
      if (body.p_expected_revision !== remote.revision) throw Object.assign(new Error('conflict'), { code: 'STATE_CONFLICT' });
      remote.state = body.p_state;
      remote.revision += 1;
      return [{ revision: remote.revision }];
    };
    return store;
  };
  return { remote, create };
}

test('existing cloud bootstrap and thread listing are read-only and reuse only request-local state', async () => {
  const { remote, create } = cloud();
  const store = create();
  const first = await store.bootstrap();
  assert.equal(first.state_revision, 10);
  await store.listThreads();
  await store.bootstrap();
  assert.equal(remote.reads, 1);
  assert.equal(remote.writes, 0);
  remote.state.tasks[0].title = 'A different request committed';
  assert.equal((await create().bootstrap()).tasks[0].title, 'A different request committed');
  assert.equal(remote.reads, 2);
});

test('request-local mutation uses one read and one write and keeps raw history', async () => {
  const initial = createDefaultAssistantState();
  initial.messages.push({ id: 'raw', thread_id: 'thread', content: 'retained', attachments: [{ data_url: 'data:image/png;base64,AAAA' }] });
  const { remote, create } = cloud(initial);
  const store = create();
  await store.getThread('thread');
  await store.executeActions([{ type: 'start_task_timer', task_id: initial.tasks[0].id }]);
  const response = await store.bootstrap();
  assert.equal(remote.reads, 1);
  assert.equal(remote.writes, 1);
  assert.equal(response.state_revision, 11);
  assert.equal(response.messages[0].attachments[0].data_url, initial.messages[0].attachments[0].data_url);
});

test('conflict retries reload the latest snapshot and merge without losing another device update', async () => {
  const { remote, create } = cloud();
  const store = create();
  const initial = await store.bootstrap();
  remote.conflict = (snapshot) => { snapshot.revision += 1; snapshot.state.tasks[1].title = 'other device'; };
  await store.executeActions([{ type: 'start_task_timer', task_id: initial.tasks[0].id }]);
  const result = await store.bootstrap();
  assert.equal(remote.reads, 2);
  assert.equal(remote.writes, 2);
  assert.equal(result.tasks[1].title, 'other device');
  assert.equal(result.time_sessions.filter((item) => item.status === 'running').length, 1);
  assert.equal(result.state_revision, 12);
});

test('cloud bootstrap initializes once and rolls daily tasks forward once without dropping reviews', async () => {
  const initial = createDefaultAssistantState();
  initial.long_tasks.push({ id: 'daily', title: 'Daily fixture', status: 'active', repeat_rule: 'daily', start_date: '2020-01-01', daily_minutes: 25, priority: 3 });
  initial.tasks.push({ id: 'yesterday', title: 'Prior occurrence', long_task_id: 'daily', occurrence_date: '2020-01-01', status: 'open' });
  const { remote, create } = cloud(initial);
  const state = await create().bootstrap();
  assert.equal(remote.writes, 1);
  assert.equal(state.tasks.find((item) => item.id === 'yesterday').status, 'missed');
  assert.equal(state.tasks.filter((item) => item.long_task_id === 'daily').length, 2);
  assert.ok(state.daily_reviews.some((item) => item.date === '2020-01-01'));
  await create().bootstrap();
  assert.equal(remote.writes, 1);
  remote.state = null; remote.revision = 0;
  const fresh = create();
  const bootstrap = await fresh.bootstrap();
  assert.ok(bootstrap.projects[0].id);
  await create().bootstrap();
  assert.equal(remote.writes, 2);
});

test('non-request-scoped stores read again after external mutations', async () => {
  const { remote, create } = cloud();
  const store = create(false);
  await store.bootstrap();
  remote.state.memory_items.push({ id: 'external', status: 'active', content: 'tool result' });
  assert.equal((await store.bootstrap()).memory_items[0].id, 'external');
  assert.equal(remote.reads, 2);
  assert.equal(remote.writes, 0);
});
