export function resolveDraftOnThreadAssignment({ currentThreadId, nextThreadId, currentInput, pendingInput, targetDraft }) {
  const latest = String(pendingInput ?? currentInput ?? '');
  return {
    threadId: nextThreadId,
    draft: latest || String(targetDraft ?? ''),
    migrate: latest.length > 0
  };
}

export function acceptsActiveThreadResponse({ getCurrentThreadId, requestThreadId, responseThreadId }) {
  return acceptsThreadResponse({ currentThreadId: getCurrentThreadId(), requestThreadId, responseThreadId });
}

export function acceptsThreadResponse({ currentThreadId, requestThreadId, responseThreadId }) {
  if (requestThreadId !== currentThreadId) return false;
  if (requestThreadId === null) return Boolean(responseThreadId);
  return responseThreadId === requestThreadId;
}

export function stateMergeDecision(accepted) {
  return { mergeState: Boolean(accepted), keepReply: true };
}

export function switchDraftSnapshot({ fromThreadId, toThreadId, input, targetDraft }) {
  return { fromThreadId, toThreadId, savedDraft: String(input ?? ''), restoredDraft: String(targetDraft ?? '') };
}

export function lifecycleDraftSnapshot(threadId, input) {
  return { threadId: threadId || null, draft: String(input ?? '') };
}
