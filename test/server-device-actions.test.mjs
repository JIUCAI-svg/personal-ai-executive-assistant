import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AssistantStateStore } from '../server/state-store.mjs';

test('device reports move a requested alarm through active, cancel pending, and cancelled', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forward-device-action-'));
  const store = new AssistantStateStore(directory);
  try {
    const created = await store.executeActions([{ type: 'set_alarm', time: '08:00', label: '起床', repeat: 'none' }]);
    const alarm = created.results[0].alarm;
    assert.equal(alarm.status, 'pending_device');

    const scheduled = await store.recordDeviceAction({ action: 'set_alarm', alarm_id: alarm.id, device_id: 'android-test', status: 'scheduled' });
    assert.equal(scheduled.ok, true);
    assert.equal(scheduled.alarm.status, 'active');
    assert.equal(scheduled.alarm.device_id, 'android-test');

    const cancelled = await store.executeActions([{ type: 'cancel_alarm', alarm_id: alarm.id }]);
    assert.equal(cancelled.results[0].alarm.status, 'cancel_pending_device');

    const confirmed = await store.recordDeviceAction({ action: 'cancel_alarm', alarm_id: alarm.id, device_id: 'android-test', status: 'cancelled' });
    assert.equal(confirmed.alarm.status, 'cancelled');
    assert.equal(confirmed.alarm.status_before_cancel, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('device scheduling marks a follow-up while claiming it dispatches exactly once', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forward-followup-device-'));
  const store = new AssistantStateStore(directory);
  try {
    const created = await store.executeActions([{ type: 'schedule_followup', after_minutes: 1, instruction: '检查是否需要提醒' }]);
    const followup = created.results[0].followup;
    assert.equal(created.results[0].device_required, true);
    const scheduled = await store.recordDeviceAction({ action: 'schedule_followup', followup_id: followup.id, device_id: 'android-test', status: 'scheduled' });
    assert.equal(scheduled.followup.device_status, 'scheduled');

    await store.mutate((state) => {
      state.followups.find((item) => item.id === followup.id).due_at = new Date(Date.now() - 1_000).toISOString();
    });
    const first = await store.claimDueFollowups();
    const second = await store.claimDueFollowups();
    assert.equal(first.length, 1);
    assert.equal(second.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('follow-up keeps the native Agent instruction and delay for Android scheduling', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forward-followup-agent-'));
  const store = new AssistantStateStore(directory);
  try {
    const created = await store.executeActions([{
      type: 'schedule_followup',
      after_minutes: 2,
      instruction: '两分钟后检查是否需要主动提醒我继续复习。',
      reason: '用户请求延后唤醒'
    }]);
    const result = created.results[0];
    assert.equal(result.ok, true);
    assert.equal(result.device_required, true);
    assert.equal(result.followup.after_minutes, 2);
    assert.equal(result.followup.instruction, '两分钟后检查是否需要主动提醒我继续复习。');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('explicit direct follow-up remains a local notification and records delivery', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forward-followup-direct-'));
  const store = new AssistantStateStore(directory);
  try {
    const created = await store.executeActions([{
      type: 'schedule_followup',
      after_minutes: 2,
      instruction: '两分钟后提醒我回来复习。',
      notify_user: true,
      message: '两分钟到了，回来继续复习。'
    }]);
    const followup = created.results[0].followup;
    assert.equal(followup.notify_user, true);
    assert.equal(followup.message, '两分钟到了，回来继续复习。');

    await store.mutate((state) => {
      state.followups.find((item) => item.id === followup.id).due_at = new Date(Date.now() - 1_000).toISOString();
    });
    assert.equal((await store.claimDueFollowups()).length, 0);

    const delivered = await store.recordDeviceAction({
      action: 'schedule_followup', followup_id: followup.id, device_id: 'android-test', status: 'delivered'
    });
    assert.equal(delivered.followup.status, 'completed');
    assert.equal(delivered.followup.device_status, 'delivered');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed follow-up execution is re-queued with a retry time instead of being lost', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forward-followup-retry-'));
  const store = new AssistantStateStore(directory);
  try {
    const created = await store.executeActions([{
      type: 'schedule_followup', after_minutes: 1,
      instruction: '检查网络恢复后是否需要提醒。'
    }]);
    const followup = created.results[0].followup;
    const failed = await store.completeFollowup(followup.id, { failed: true, error: '模型暂时不可用' });
    assert.equal(failed.ok, true);
    assert.equal(failed.followup.status, 'scheduled');
    assert.equal(failed.followup.retry_count, 1);
    assert.ok(Date.parse(failed.followup.due_at) > Date.now());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('late device events do not revive a newer alarm state', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forward-device-order-'));
  const store = new AssistantStateStore(directory);
  try {
    const created = await store.executeActions([{ type: 'set_alarm', time: '08:00', label: '起床' }]);
    const alarm = created.results[0].alarm;
    const newer = await store.recordDeviceAction({
      action: 'set_alarm', alarm_id: alarm.id, status: 'scheduled',
      event_id: 'newer', event_at: '2026-09-03T08:00:02.000Z'
    });
    assert.equal(newer.alarm.status, 'active');
    const stale = await store.recordDeviceAction({
      action: 'set_alarm', alarm_id: alarm.id, status: 'failed',
      event_id: 'older', event_at: '2026-09-03T08:00:01.000Z', error: '迟到事件'
    });
    assert.equal(stale.duplicate, true);
    assert.equal(stale.alarm.status, 'active');
    const duplicate = await store.recordDeviceAction({
      action: 'set_alarm', alarm_id: alarm.id, status: 'scheduled',
      event_id: 'newer', event_at: '2026-09-03T08:00:03.000Z'
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.alarm.status, 'active');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
