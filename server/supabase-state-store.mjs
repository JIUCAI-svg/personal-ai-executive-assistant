import { AssistantStateStore, createDefaultAssistantState, repairAssistantState, ensureDailyTaskInstances, stateWithPlan } from './state-store.mjs';

function shanghaiTimestamp() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}:00+08:00`;
}

function cloudError(message, code = 'SUPABASE_SYNC_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

export class SupabaseStateStore extends AssistantStateStore {
  constructor({ url, anonKey, accessToken, userId, requestScoped = false }) {
    super('');
    this.url = String(url || '').replace(/\/$/, '');
    this.anonKey = String(anonKey || '');
    this.accessToken = String(accessToken || '');
    this.userId = String(userId || '');
    this.revision = 0;
    this.snapshotExists = false;
    this.requestScoped = requestScoped;
    this.cachedState = null;
    this.pending = Promise.resolve();
  }

  headers(extra = {}) {
    return {
      apikey: this.anonKey,
      Authorization: `Bearer ${this.accessToken}`,
      ...extra
    };
  }

  async request(path, options = {}) {
    let response;
    try {
      response = await fetch(`${this.url}${path}`, options);
    } catch {
      throw cloudError('暂时无法连接 Supabase，同步未完成。', 'SUPABASE_UNREACHABLE');
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = String(body?.message || body?.error || body?.hint || '');
      if (detail.includes('STATE_CONFLICT')) throw cloudError('另一台设备刚刚更新了数据，正在重新合并。', 'STATE_CONFLICT');
      if (response.status === 401 || response.status === 403) throw cloudError('登录已失效，请重新登录。', 'SUPABASE_AUTH_EXPIRED');
      if (response.status === 404 || detail.includes('assistant_state_snapshots')) {
        throw cloudError('Supabase 尚未执行同步迁移。', 'SUPABASE_MIGRATION_REQUIRED');
      }
      throw cloudError('Supabase 同步请求失败。', 'SUPABASE_SYNC_ERROR');
    }
    return body;
  }

  async loadSnapshot() {
    const userId = encodeURIComponent(this.userId);
    const rows = await this.request(`/rest/v1/assistant_state_snapshots?user_id=eq.${userId}&select=state,revision,updated_at&limit=1`, {
      headers: this.headers()
    });
    const snapshot = Array.isArray(rows) ? rows[0] : null;
    this.snapshotExists = Boolean(snapshot);
    this.revision = Number(snapshot?.revision) || 0;
    return snapshot || null;
  }

  async hasSnapshot() {
    const snapshot = await this.loadSnapshot();
    return {
      exists: Boolean(snapshot),
      revision: this.revision,
      updatedAt: snapshot?.updated_at || null
    };
  }

  async read() {
    if (this.requestScoped && this.cachedState) return this.cachedState;
    const snapshot = await this.loadSnapshot();
    const state = snapshot ? repairAssistantState(snapshot.state) : createDefaultAssistantState();
    if (this.requestScoped) this.cachedState = state;
    return state;
  }

  async bootstrap() {
    let state = await this.read();
    // Cloud existence is determined by its snapshot, not the local vault path.
    // Only initialization and actual day-rollover maintenance need a write.
    if (!this.snapshotExists || ensureDailyTaskInstances(state)) {
      state = await this.mutate((draft) => draft);
    }
    return stateWithPlan(state, this.revision, `cloud:${this.userId}`);
  }

  async save(state, expectedRevision) {
    const result = await this.request('/rest/v1/rpc/save_assistant_state', {
      method: 'POST',
      headers: this.headers({
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      }),
      body: JSON.stringify({ p_state: state, p_expected_revision: expectedRevision })
    });
    const row = Array.isArray(result) ? result[0] : result;
    this.snapshotExists = true;
    this.revision = Number(row?.revision) || expectedRevision + 1;
  }

  async mutate(operation) {
    const work = this.pending.then(async () => {
      let lastError;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const state = structuredClone(await this.read());
        const expectedRevision = this.revision;
        ensureDailyTaskInstances(state);
        const result = await operation(state);
        state.updated_at = shanghaiTimestamp();
        state.state_revision = expectedRevision + 1;
        try {
          await this.save(state, expectedRevision);
          if (this.requestScoped) this.cachedState = state;
          return result;
        } catch (error) {
          this.cachedState = null;
          lastError = error;
          if (error?.code !== 'STATE_CONFLICT') throw error;
        }
      }
      throw lastError || cloudError('同步冲突，请刷新后再试。', 'STATE_CONFLICT');
    });
    this.pending = work.catch(() => undefined);
    return work;
  }
}
