export const draftStorageKey = (threadId) => {
  const id = String(threadId || '').trim();
  return `forward.thread.draft.${id || 'pending'}`;
}

export function readThreadDraft(threadId, storage = globalThis.localStorage) {
  const key = draftStorageKey(threadId);
  if (!key) return '';
  try {
    const value = storage?.getItem(key);
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

export function writeThreadDraft(threadId, draft, storage = globalThis.localStorage) {
  const key = draftStorageKey(threadId);
  if (!key) return false;
  try {
    storage?.setItem(key, String(draft ?? ''));
    return true;
  } catch {
    return false;
  }
}

export function clearThreadDraft(threadId, storage = globalThis.localStorage) {
  const key = draftStorageKey(threadId);
  try {
    storage?.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function migrateThreadDraft(fromThreadId, toThreadId, draft, storage = globalThis.localStorage) {
  const value = String(draft ?? '');
  if (!value) return false;
  return writeThreadDraft(toThreadId, value, storage) && clearThreadDraft(fromThreadId, storage);
}
