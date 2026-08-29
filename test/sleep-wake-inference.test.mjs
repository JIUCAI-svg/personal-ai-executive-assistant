import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AssistantStateStore } from '../server/state-store.mjs';

test('usage activity creates a candidate sleep/wake record without changing planned settings', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forward-sleep-test-'));
  try {
    const store = new AssistantStateStore(directory);
    await store.recordDeviceActivity({
      date: '2026-08-25', last_active_at: '2026-08-25T23:12:00', last_foreground_app: '浏览器', source: 'test'
    });
    await store.recordDeviceActivity({
      date: '2026-08-26', first_active_at: '2026-08-26T08:03:00', first_foreground_app: '微信', source: 'test'
    });
    const state = await store.bootstrap();
    const candidate = state.sleep_wake_summary.latest;
    assert.equal(candidate.status, 'candidate');
    assert.equal(candidate.sleep_time, '23:12');
    assert.equal(candidate.wake_time, '08:03');
    assert.equal(candidate.gap_minutes, 531);
    assert.equal(state.settings.sleep_time, '01:00');
    assert.equal(state.settings.wake_time, '09:00');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('short gaps do not become sleep candidates', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forward-sleep-test-'));
  try {
    const store = new AssistantStateStore(directory);
    await store.recordDeviceActivity({ date: '2026-08-25', last_active_at: '2026-08-25T22:00:00' });
    await store.recordDeviceActivity({ date: '2026-08-26', first_active_at: '2026-08-26T00:10:00' });
    assert.equal((await store.bootstrap()).sleep_wake_summary.latest, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
