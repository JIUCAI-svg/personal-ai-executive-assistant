import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AssistantStateStore } from '../server/state-store.mjs';

test('task timer lifecycle keeps completed tasks and supports reopen', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forward-task-timer-'));
  const store = new AssistantStateStore(root);
  const state = await store.bootstrap();
  const task = state.tasks[0];
  let result = await store.executeActions([{ type: 'start_task_timer', task_id: task.id, mode: 'countdown', target_minutes: 25 }]);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[0].task.status, 'in_progress');
  result = await store.executeActions([{ type: 'pause_task_timer', task_id: task.id }]);
  assert.equal(result.results[0].sessions.at(-1).status, 'paused');
  result = await store.executeActions([{ type: 'complete_task', task_id: task.id }]);
  assert.equal(result.results[0].task.status, 'done');
  assert.ok(result.plan.completed.some((item) => item.id === task.id));
  result = await store.executeActions([{ type: 'reopen_task', task_id: task.id }]);
  assert.equal(result.results[0].task.status, 'open');
});

test('mobile action timer keeps sub-minute precision when paused', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forward-task-timer-precision-'));
  const store = new AssistantStateStore(root);
  const state = await store.bootstrap();
  const task = state.tasks[0];
  await store.executeActions([{ type: 'start_task_timer', task_id: task.id, mode: 'stopwatch' }]);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const result = await store.executeActions([{ type: 'pause_task_timer', task_id: task.id }]);
  assert.ok(result.results[0].sessions.at(-1).elapsed_seconds >= 1);
});

test('task update and reorder persist', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forward-task-edit-'));
  const store = new AssistantStateStore(root);
  const state = await store.bootstrap();
  const [first, second] = state.tasks;
  let result = await store.executeActions([{ type: 'update_task', task_id: first.id, title: '更新后的任务', estimated_minutes: 30, priority: 4 }]);
  assert.equal(result.results[0].task.title, '更新后的任务');
  result = await store.executeActions([{ type: 'update_task', task_id: first.id, estimated_minutes: 120 }]);
  const updatedPlanItem = [...result.plan.scheduled, ...result.plan.deferred].find((item) => item.id === first.id);
  assert.equal(updatedPlanItem.estimated_minutes, 120);
  result = await store.executeActions([{ type: 'reorder_tasks', task_ids: [second.id, first.id] }]);
  const tasks = await store.listTasks();
  assert.equal(tasks[0].id, second.id);
  assert.equal(tasks[1].id, first.id);
});

test('cancel task accepts an explicit task ID from the mobile editor', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forward-task-cancel-'));
  const store = new AssistantStateStore(root);
  const state = await store.bootstrap();
  const task = state.tasks[0];
  const result = await store.executeActions([{ type: 'cancel_task', task_id: task.id, reason: '手动从计划移除' }]);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[0].task_id, task.id);
  assert.equal((await store.bootstrap()).tasks.find((item) => item.id === task.id).status, 'cancelled');
});

test('buffer setting accepts zero and is reflected in the plan', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forward-buffer-setting-'));
  const store = new AssistantStateStore(root);
  await store.bootstrap();
  const result = await store.executeActions([{ type: 'set_buffer_minutes', minutes: 0 }]);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.plan.configured_buffer_minutes, 0);
  assert.equal(result.plan.buffer_minutes, 0);
});
