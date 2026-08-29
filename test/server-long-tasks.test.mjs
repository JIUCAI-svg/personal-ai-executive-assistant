import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AssistantStateStore } from '../server/state-store.mjs';

const RealDate = global.Date;

function useClock(iso) {
  class FrozenDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [iso]));
    }

    static now() {
      return new RealDate(iso).getTime();
    }
  }
  global.Date = FrozenDate;
}

test('long tasks create independent daily executions and preserve review history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forward-long-tasks-'));
  try {
    useClock('2026-08-30T10:00:00+08:00');
    const store = new AssistantStateStore(root);
    await store.bootstrap();
    const master = await store.createLongTask({ title: '补考复习', daily_minutes: 90, priority: 5, due_at: '2026-09-05T23:59:00+08:00' });
    let state = await store.bootstrap();
    const first = state.tasks.filter((item) => item.long_task_id === master.id);
    assert.equal(first.length, 1);
    assert.equal(first[0].occurrence_date, '2026-08-30');
    assert.equal(first[0].estimated_minutes, 90);

    await store.taskTimer(first[0].id, 'complete');
    useClock('2026-08-31T10:00:00+08:00');
    state = await store.bootstrap();
    const occurrences = state.tasks.filter((item) => item.long_task_id === master.id);
    assert.equal(occurrences.length, 2);
    assert.equal(occurrences.find((item) => item.occurrence_date === '2026-08-30')?.status, 'done');
    assert.equal(occurrences.find((item) => item.occurrence_date === '2026-08-31')?.status, 'open');
    const firstReview = state.daily_reviews.find((item) => item.date === '2026-08-30');
    assert.equal(firstReview?.completed_count, 1);
    assert.equal(firstReview?.planned_count, 1);

    useClock('2026-09-01T10:00:00+08:00');
    state = await store.bootstrap();
    assert.equal(state.tasks.find((item) => item.long_task_id === master.id && item.occurrence_date === '2026-08-31')?.status, 'missed');
    assert.equal(state.daily_reviews.find((item) => item.date === '2026-08-31')?.missed_count, 1);
    assert.equal(state.tasks.filter((item) => item.long_task_id === master.id && item.occurrence_date === '2026-09-01').length, 1);
  } finally {
    global.Date = RealDate;
  }
});

test('bedtime creates a fixed eight-hour no-schedule window and derives wake time', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forward-sleep-window-'));
  try {
    useClock('2026-08-30T00:30:00+08:00');
    const store = new AssistantStateStore(root);
    await store.bootstrap();
    let result = await store.executeActions([{ type: 'set_sleep_time', time: '01:00' }]);
    assert.equal(result.plan.sleep_time, '01:00');
    assert.equal(result.plan.wake_time, '09:00');
    assert.equal(result.plan.is_sleeping, false);
    assert.equal(result.plan.total_remaining_minutes, 30);

    useClock('2026-08-30T02:30:00+08:00');
    const sleeping = await store.bootstrap();
    assert.equal(sleeping.plan.is_sleeping, true);
    assert.equal(sleeping.plan.sleep_window.end.time, '09:00');
    assert.equal(sleeping.plan.scheduled.length, 0);
    assert.equal(sleeping.plan.available_minutes, 0);
  } finally {
    global.Date = RealDate;
  }
});
