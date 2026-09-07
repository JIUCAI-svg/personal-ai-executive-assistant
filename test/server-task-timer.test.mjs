import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AssistantStateStore, buildDynamicPlan } from '../server/state-store.mjs';

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

test('selecting a current task persists selection and switches the running timer', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forward-current-task-'));
  const store = new AssistantStateStore(root);
  const state = await store.bootstrap();
  const [first, second] = state.tasks;
  let result = await store.executeActions([{ type: 'set_current_task', task_id: second.id, start_timer: true }]);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.plan.current_task.id, second.id);
  assert.equal(result.plan.active_timer.task_id, second.id);
  result = await store.executeActions([{ type: 'set_current_task', task_id: first.id, start_timer: true }]);
  assert.equal(result.plan.current_task.id, first.id);
  const persisted = await store.bootstrap();
  assert.equal(persisted.plan.current_task.id, first.id);
  assert.equal(persisted.plan.active_timer.task_id, first.id);
  assert.equal((await store.read()).time_sessions.find((session) => session.task_id === second.id).status, 'paused');
});

test('parent containers cannot be selected as the current task', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forward-current-parent-'));
  const store = new AssistantStateStore(root);
  const parent = (await store.bootstrap()).tasks[0];
  await store.executeActions([{ type: 'create_subtask', title: '执行子任务', parent_task_id: parent.id }]);
  const result = await store.executeActions([{ type: 'set_current_task', task_id: parent.id }]);
  assert.equal(result.results[0].ok, false);
  assert.match(result.results[0].reason, /父任务/);
});

test('AI-created child tasks keep their parent relationship', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forward-task-subtask-'));
  const store = new AssistantStateStore(root);
  const state = await store.bootstrap();
  await store.mutate((draft) => { draft.settings.show_sleep_plan = true; });
  const parent = state.tasks[0];
  const result = await store.executeActions([{
    type: 'create_subtask',
    title: '完成第一组错题',
    estimated_minutes: 25,
    parent_task_id: parent.id
  }]);
  assert.equal(result.results[0].ok, true);
  const child = result.results[0].task;
  assert.equal(child.parent_task_id, parent.id);
  assert.equal(child.project_id, parent.project_id);
  assert.equal((await store.listTasks()).find((item) => item.id === child.id).parent_task_id, parent.id);
  const persisted = await store.read();
  const plan = buildDynamicPlan(persisted, { date: '2026-08-31', time: '20:00' });
  const displayed = [...(plan.scheduled_display || plan.scheduled), ...plan.sleeping_tasks];
  assert.equal(plan.scheduled.some((item) => item.id === parent.id), false);
  assert.equal(displayed.some((item) => item.id === parent.id && item.display_only === true), true);
  assert.equal(displayed.some((item) => item.id === child.id), true);
});

test('parent display row remains when every child is deferred or sleeping', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forward-task-parent-display-'));
  const store = new AssistantStateStore(root);
  const state = await store.bootstrap();
  const parent = state.tasks[0];
  await store.executeActions([{
    type: 'create_subtask',
    title: '需要顺延的子任务',
    estimated_minutes: 120,
    parent_task_id: parent.id
  }]);
  let persisted = await store.read();
  const deferredPlan = buildDynamicPlan(persisted, { date: '2026-08-31', time: '00:30' });
  assert.equal(deferredPlan.scheduled.length, 0);
  assert.equal(deferredPlan.scheduled_display.some((item) => item.id === parent.id && item.display_only), true);

  persisted.settings.show_sleep_plan = true;
  const sleepingPlan = buildDynamicPlan(persisted, { date: '2026-08-31', time: '02:00' });
  assert.equal(sleepingPlan.is_sleeping, true);
  assert.equal(sleepingPlan.sleeping_tasks.some((item) => item.id === parent.id && item.display_only), true);
});

test('subtasks cannot create another nested task', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forward-task-depth-'));
  const store = new AssistantStateStore(root);
  const parent = (await store.bootstrap()).tasks[0];
  const wrongAction = await store.executeActions([{ type: 'create_task', title: '伪装的子任务', parent_task_id: parent.id }]);
  assert.equal(wrongAction.results[0].ok, false);
  assert.match(wrongAction.results[0].reason, /新建子任务/);
  const missingParent = await store.executeActions([{ type: 'create_subtask', title: '没有父任务的子任务', parent_task_id: 'missing-parent' }]);
  assert.equal(missingParent.results[0].ok, false);
  assert.match(missingParent.results[0].reason, /没有找到要归属的父任务/);
  const childResult = await store.executeActions([{ type: 'create_subtask', title: '一级子任务', parent_task_id: parent.id }]);
  assert.equal(childResult.results[0].ok, true);
  const child = childResult.results[0].task;
  const nestedResult = await store.executeActions([{ type: 'create_subtask', title: '不应创建的子子任务', parent_task_id: child.id }]);
  assert.equal(nestedResult.results[0].ok, false);
  assert.match(nestedResult.results[0].reason, /子任务不能继续创建子任务/);
  assert.equal((await store.listTasks()).some((task) => task.title === '不应创建的子子任务'), false);
});

test('completed tasks auto-clear from the daily plan after the sleep boundary while history remains', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forward-task-completed-clear-'));
  const store = new AssistantStateStore(root);
  const state = await store.bootstrap();
  const task = state.tasks[0];
  await store.mutate((draft) => {
    const item = draft.tasks.find((entry) => entry.id === task.id);
    item.status = 'done';
    item.completed_at = '2020-01-01T01:05:00+08:00';
  });
  const refreshed = await store.bootstrap();
  assert.equal(refreshed.plan.completed.some((item) => item.id === task.id), false);
  assert.equal((await store.listTasks()).find((item) => item.id === task.id).status, 'done');
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
  // A real sleep window can make the current plan intentionally empty. The
  // task mutation itself must still persist regardless of the current clock.
  const updatedTask = (await store.listTasks()).find((item) => item.id === first.id);
  assert.equal(updatedTask.estimated_minutes, 120);
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

test('goals and projects support deadlines and task estimates', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forward-projects-'));
  const store = new AssistantStateStore(root);
  await store.bootstrap();
  const project = await store.createProject({ name: '本周发布计划', kind: 'goal', priority: 5, due_at: '2026-09-05T23:59:00+08:00' });
  assert.equal(project.kind, 'goal');
  assert.equal(project.due_at, '2026-09-05T23:59:00+08:00');
  const task = (await store.executeActions([{ type: 'create_task', title: '准备发布素材', project: project.name, estimated_minutes: 90, due_at: '2026-09-03T18:00:00+08:00' }])).results[0].task;
  assert.equal(task.project_id, project.id);
  assert.equal(task.due_at, '2026-09-03T18:00:00+08:00');
  const updated = await store.updateTask(task.id, { due_at: '2026-09-04T18:00:00+08:00' });
  assert.equal(updated.due_at, '2026-09-04T18:00:00+08:00');
});

test('AI project actions create and update projects', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forward-project-actions-'));
  const store = new AssistantStateStore(root);
  await store.bootstrap();
  let result = await store.executeActions([{ type: 'create_project', name: '人生支线：内容创作', kind: 'project', description: '持续推进短剧与直播', priority: 3 }]);
  assert.equal(result.results[0].ok, true);
  const project = result.results[0].project;
  result = await store.executeActions([{ type: 'update_project', project_id: project.id, status: 'paused', description: '本周暂缓，补考后恢复' }]);
  assert.equal(result.results[0].project.status, 'paused');
  assert.equal((await store.bootstrap()).projects.find((item) => item.id === project.id).description, '本周暂缓，补考后恢复');
});
