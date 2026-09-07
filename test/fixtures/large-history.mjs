import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AssistantStateStore } from '../../server/state-store.mjs';

export async function createLargeHistoryFixture({ imageBytes = 8_400_000 } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forward-latency-fixture-'));
  const store = new AssistantStateStore(directory);
  await store.bootstrap();
  const thread = await store.createThread({ mode: 'assistant', save_full_conversation: true });
  const image = `data:image/png;base64,${'A'.repeat(imageBytes)}`;
  await store.appendMessage(thread, 'user', 'Synthetic retained image', null, [{ name: 'fixture.png', type: 'image/png', data_url: image }]);
  await store.mutate((state) => {
    state.ai_preferences.memory_auto_daily = false;
    state.settings.show_sleep_plan = false;
    state.memory_items = [{ id: 'fixture-memory', content: 'Synthetic pending memory', status: 'pending_review', kind: 'fact' }];
    const imageMessage = state.messages.shift();
    for (let index = 0; index < 2000; index += 1) {
      state.messages.push({ id: `history-${index}`, thread_id: thread.id, role: 'assistant', content: `Historical text ${index}`, attachments: [], created_at: '2026-01-01T08:00:00+08:00' });
      state.action_logs.push({ id: `log-${index}`, type: 'fixture', reason: 'Retained historical log', created_at: '2026-01-01T08:00:00+08:00' });
    }
    state.messages.push(imageMessage);
  });
  const configPath = path.join(directory, 'providers.json');
  await writeFile(configPath, JSON.stringify({ profiles: {} }));
  return { directory, store, thread, image, configPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const fixture = await createLargeHistoryFixture();
  const state = await fixture.store.read();
  console.log(JSON.stringify({ directory: fixture.directory, providers: fixture.configPath, thread_id: fixture.thread.id,
    task_id: state.tasks[0].id, memory_id: 'fixture-memory', state_bytes: Buffer.byteLength(JSON.stringify(state)) }, null, 2));
}
