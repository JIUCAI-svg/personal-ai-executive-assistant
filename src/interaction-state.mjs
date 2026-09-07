// Pending keys are acquired synchronously, before a render or network await.
// Revisions order committed state, not request start/completion timestamps.
export function createInteractionStateGuard() {
  const pending = new Set();
  const revisions = new Map();
  return {
    begin(keys) {
      if (keys.some((key) => pending.has(key))) return false;
      keys.forEach((key) => pending.add(key));
      return true;
    },
    finish(keys) { keys.forEach((key) => pending.delete(key)); },
    accepts(state) {
      if (!state) return true;
      const scope = state.state_scope || 'local';
      const revision = Number(state.state_revision) || 0;
      if (revision < (revisions.get(scope) ?? -1)) return false;
      revisions.set(scope, revision);
      return true;
    }
  };
}
