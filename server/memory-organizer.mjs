import crypto from 'node:crypto';

const MEMORY_KINDS = new Set(['fact', 'preference', 'decision', 'project_update', 'life_event']);

function text(value, limit = 800) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function dateFromTimestamp(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || '';
}

function tokens(value) {
  const normalized = text(value, 2400).toLocaleLowerCase('zh-CN');
  const words = normalized.match(/[\p{Script=Han}]{1,}|[a-z0-9_]{2,}/giu) || [];
  const characters = [...normalized.replace(/[^\p{Script=Han}a-z0-9]/giu, '')];
  return [...new Set([...words, ...characters])].slice(0, 240);
}

export function rawMessagesForDay(state, date) {
  const threads = new Map((Array.isArray(state?.threads) ? state.threads : []).map((thread) => [thread.id, thread]));
  return (Array.isArray(state?.messages) ? state.messages : [])
    .filter((message) => dateFromTimestamp(message.created_at) === date)
    .filter((message) => {
      const thread = threads.get(message.thread_id);
      return thread && thread.mode !== 'temporary' && thread.save_full_conversation !== false;
    })
    .map((message, index) => {
      const thread = threads.get(message.thread_id);
      return {
        index,
        id: text(message.id, 100),
        thread_id: text(message.thread_id, 100),
        mode: thread?.mode || 'assistant',
        project_id: thread?.project_id || null,
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: text(message.content, 4000),
        created_at: text(message.created_at, 48)
      };
    })
    .filter((message) => message.content);
}

function projectNameMap(state) {
  return new Map((Array.isArray(state?.projects) ? state.projects : []).map((project) => [text(project.id, 100), text(project.name, 120)]));
}

function projectIdFor(project, state) {
  const raw = text(project, 160);
  if (!raw) return null;
  const projects = Array.isArray(state?.projects) ? state.projects : [];
  const exact = projects.find((item) => item.id === raw || text(item.name, 160) === raw);
  if (exact) return exact.id;
  const lower = raw.toLocaleLowerCase('zh-CN');
  return projects.find((item) => text(item.name, 160).toLocaleLowerCase('zh-CN').includes(lower) || lower.includes(text(item.name, 160).toLocaleLowerCase('zh-CN')))?.id || null;
}

export function memoryOrganizerPrompt({ date, messages, projects, existingMemories, actionLogs, usage, sleepWake }) {
  return `你是“向前”的每日记忆整理器。你的任务是把一天的原始对话整理成可检索的候选记忆；原始对话是不可修改、不可删除的来源记录。

只输出有效 JSON，不能输出 Markdown：
{
  "summary":"当天的客观摘要，150~500字",
  "memory_candidates":[{
    "kind":"fact|preference|decision|project_update|life_event",
    "content":"可独立理解的一条事实或决定",
    "project":"项目名称或空字符串",
    "importance":1,
    "tags":["标签"],
    "source_message_indexes":[0]
  }],
  "project_updates":[{"project":"项目名称","summary":"当天明确进展"}],
  "update_suggestions":[{"memory_id":"已有记忆 ID","suggestion":"新信息与旧记忆的关系，仅建议，不要替换"}]
}

硬规则：
- 只以给出的资料为依据，不能补写、猜测或改变历史。
- 普通寒暄、重复内容、模型自行建议不应成为记忆。
- 提取用户明确说出的稳定偏好、决定、任务/项目进度、重要生活事件；每条必须引用 source_message_indexes。
- 新旧信息冲突时写入 update_suggestions 或候选，不要删除、修改或覆盖已有记忆。
- 不要把应用使用记录的具体内容臆测为用户行为；只可以在确有计划影响时作客观摘要。
- 最多 12 条候选、6 个项目更新、6 条更新建议。

日期：${date}
项目：${JSON.stringify(projects)}
已有活跃记忆（用于去重与提示更新，不可直接改写）：${JSON.stringify(existingMemories)}
当天动作日志：${JSON.stringify(actionLogs)}
手机使用摘要：${JSON.stringify(usage)}
作息候选：${JSON.stringify(sleepWake)}
当天原始消息（索引用于追溯来源）：${JSON.stringify(messages)}`;
}

export function parseDailyMemoryResult(content, { state, messages }) {
  const raw = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(raw);
  const source = Array.isArray(messages) ? messages : [];
  const candidates = (Array.isArray(parsed.memory_candidates) ? parsed.memory_candidates : [])
    .slice(0, 12)
    .map((candidate) => {
      const sourceIndexes = [...new Set((Array.isArray(candidate?.source_message_indexes) ? candidate.source_message_indexes : [])
        .map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0 && value < source.length))];
      const kind = MEMORY_KINDS.has(text(candidate?.kind, 40)) ? text(candidate.kind, 40) : 'fact';
      const contentValue = text(candidate?.content, 500);
      if (!contentValue || !sourceIndexes.length) return null;
      return {
        kind,
        content: contentValue,
        project_id: projectIdFor(candidate?.project, state),
        importance: Math.max(1, Math.min(5, Math.round(Number(candidate?.importance) || 3))),
        tags: [...new Set((Array.isArray(candidate?.tags) ? candidate.tags : []).map((tag) => text(tag, 40)).filter(Boolean))].slice(0, 8),
        source_message_ids: sourceIndexes.map((index) => source[index].id),
        source_thread_ids: [...new Set(sourceIndexes.map((index) => source[index].thread_id))]
      };
    }).filter(Boolean);
  const projectNames = projectNameMap(state);
  const updates = (Array.isArray(parsed.project_updates) ? parsed.project_updates : []).slice(0, 6).map((item) => {
    const projectId = projectIdFor(item?.project, state);
    const summary = text(item?.summary, 360);
    return projectId && summary ? { project_id: projectId, project_name: projectNames.get(projectId) || '', summary } : null;
  }).filter(Boolean);
  const suggestions = (Array.isArray(parsed.update_suggestions) ? parsed.update_suggestions : []).slice(0, 6).map((item) => ({
    memory_id: text(item?.memory_id, 100),
    suggestion: text(item?.suggestion, 360)
  })).filter((item) => item.memory_id && item.suggestion);
  return { summary: text(parsed.summary, 1200), candidates, projectUpdates: updates, updateSuggestions: suggestions };
}

// A source-based key makes organization idempotent even when the model changes
// its wording on a later attempt.
export function memoryDedupeKey(memory) {
  const sourceIds = [...new Set((Array.isArray(memory?.source_message_ids) ? memory.source_message_ids : [])
    .map((value) => text(value, 120)).filter(Boolean))].sort();
  if (!sourceIds.length) return '';
  const identity = JSON.stringify({
    kind: text(memory?.kind, 40) || 'fact',
    project_id: text(memory?.project_id, 120) || null,
    source_message_ids: sourceIds
  });
  return crypto.createHash('sha256').update(identity).digest('hex');
}

function normalizeForMatch(value) {
  return text(value, 1200).toLocaleLowerCase('zh-CN').replace(/[\s，,。.!！?？：:；;、·“”"'‘’()（）\-+]/g, '');
}

function isNearDuplicate(left, right) {
  const leftText = normalizeForMatch(left);
  const rightText = normalizeForMatch(right);
  if (!leftText || !rightText) return false;
  if (leftText === rightText || leftText.includes(rightText) || rightText.includes(leftText)) return true;
  const leftTokens = new Set(tokens(leftText));
  const rightTokens = new Set(tokens(rightText));
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
  return shared / Math.max(1, Math.min(leftTokens.size, rightTokens.size)) >= 0.88;
}

export function applyDailyMemoryResult(state, result, metadata = {}) {
  const now = text(metadata.now, 48) || new Date().toISOString();
  const existing = Array.isArray(state.memory_items) ? state.memory_items : (state.memory_items = []);
  const created = [];
  const duplicates = [];
  for (const candidate of result.candidates || []) {
    const dedupeKey = memoryDedupeKey(candidate);
    const duplicate = existing.find((item) => (
      dedupeKey && memoryDedupeKey(item) === dedupeKey
    ) || isNearDuplicate(item.content, candidate.content));
    if (duplicate) {
      duplicates.push(duplicate.id);
      continue;
    }
    const memory = {
      id: crypto.randomUUID(),
      ...candidate,
      status: 'pending_review',
      created_at: now,
      updated_at: now,
      last_seen_at: now,
      organizer_run_id: metadata.run_id || null,
      memory_dedupe_key: dedupeKey || null
    };
    existing.push(memory);
    created.push(memory);
  }
  const summary = result.summary ? {
    id: crypto.randomUUID(),
    date: metadata.date,
    summary: result.summary,
    project_updates: result.projectUpdates || [],
    update_suggestions: result.updateSuggestions || [],
    source_message_ids: [...new Set((result.candidates || []).flatMap((item) => item.source_message_ids || []))],
    provider_id: text(metadata.provider_id, 120),
    model: text(metadata.model, 160),
    prompt_version: 'memory-organizer-v1',
    created_at: now
  } : null;
  state.daily_memory_summaries = Array.isArray(state.daily_memory_summaries) ? state.daily_memory_summaries : [];
  const existingSummary = state.daily_memory_summaries.findIndex((item) => item.date === metadata.date);
  if (summary && existingSummary >= 0) state.daily_memory_summaries.splice(existingSummary, 1, summary);
  else if (summary) state.daily_memory_summaries.push(summary);
  return { created, duplicate_ids: [...new Set(duplicates)], summary };
}

export function searchMemory(state, query, { projectId = '', limit = 12, includePending = true } = {}) {
  const terms = tokens(query);
  const project = text(projectId, 100);
  if (!terms.length) return [];
  const score = (value) => terms.reduce((total, term) => total + (text(value, 4000).toLocaleLowerCase('zh-CN').includes(term) ? (term.length > 1 ? 4 : 1) : 0), 0);
  const items = (Array.isArray(state?.memory_items) ? state.memory_items : [])
    .filter((item) => (includePending ? item.status !== 'archived' : item.status === 'active') && (!project || item.project_id === project))
    .map((item) => ({ type: 'memory', score: score(`${item.content} ${(item.tags || []).join(' ')}`) + (Number(item.importance) || 0) * 0.1, item }))
    .filter((item) => item.score > 0);
  const summaries = (Array.isArray(state?.daily_memory_summaries) ? state.daily_memory_summaries : [])
    .filter((item) => !project || (item.project_updates || []).some((update) => update.project_id === project))
    .map((item) => ({ type: 'daily_summary', score: score(`${item.summary} ${JSON.stringify(item.project_updates || [])}`), item }))
    .filter((item) => item.score > 0);
  return [...items, ...summaries].sort((left, right) => right.score - left.score || String(right.item.created_at || '').localeCompare(String(left.item.created_at || ''))).slice(0, Math.max(1, Math.min(30, Number(limit) || 12)));
}
