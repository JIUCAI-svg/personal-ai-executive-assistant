import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyDailyMemoryResult } from './memory-organizer.mjs';

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
const DEFAULT_SETTINGS = {
  timezone: SHANGHAI_TIME_ZONE,
  sleep_time: '01:00',
  wake_time: '08:00',
  focus_minutes: 50,
  break_minutes: 10,
  buffer_minutes: 60
};

function id() {
  return crypto.randomUUID();
}

function nowParts(date = new Date()) {
  const entries = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const value = (type) => entries.find((part) => part.type === type)?.value || '';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour')}:${value('minute')}`
  };
}

function minutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function clock(value) {
  const total = minutes(value);
  if (total === null) return null;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function timeLabel(total) {
  const normalized = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function plusDays(date, offset) {
  const [year, month, day] = date.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + offset));
  return result.toISOString().slice(0, 10);
}

function isoAt(date, time) {
  return `${date}T${time}:00+08:00`;
}

function normalizeText(value, limit = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function memoryKey(value) {
  return normalizeText(value, 220)
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s，,。.!！?？：:；;、·“”"'‘’()（）\-+]/g, '')
    .replace(/[的了我你他她它在与和及对为是一个这那请记住用户时]/g, '');
}

function sameMemory(left, right) {
  const leftKey = memoryKey(left);
  const rightKey = memoryKey(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey || leftKey.includes(rightKey) || rightKey.includes(leftKey)) return true;
  const leftNumbers = leftKey.match(/\d+/g) || [];
  const rightNumbers = rightKey.match(/\d+/g) || [];
  if (leftNumbers.length && rightNumbers.length && leftNumbers.join(',') !== rightNumbers.join(',')) return false;
  const available = new Map();
  for (const character of leftKey) available.set(character, (available.get(character) || 0) + 1);
  let shared = 0;
  for (const character of rightKey) {
    const count = available.get(character) || 0;
    if (count > 0) {
      shared += 1;
      available.set(character, count - 1);
    }
  }
  return shared / Math.max(leftKey.length, rightKey.length) >= 0.8;
}

export function createDefaultAssistantState() {
  const now = nowParts();
  const createdAt = `${now.date}T${now.time}:00+08:00`;
  const examProject = id();
  const revenueProject = id();
  const dramaProject = id();
  const liveProject = id();
  const brainProject = id();
  return {
    version: 1,
    updated_at: createdAt,
    settings: { ...DEFAULT_SETTINGS },
    projects: [
      { id: examProject, name: '9 月 5 日补考', description: '两门补考，当前最高优先级。', status: 'active', priority: 5, created_at: createdAt },
      { id: revenueProject, name: '多手机收益实验', description: '持续记录和复盘收益数据。', status: 'active', priority: 3, created_at: createdAt },
      { id: dramaProject, name: 'AI 恐怖灵异漫剧', description: '抖音号内容计划。', status: 'active', priority: 3, created_at: createdAt },
      { id: liveProject, name: '和平精英特色直播', description: '特色玩法与直播计划。', status: 'active', priority: 2, created_at: createdAt },
      { id: brainProject, name: '第二大脑', description: '个人 AI 执行助手长期项目。', status: 'active', priority: 4, created_at: createdAt }
    ],
    tasks: [
      { id: id(), project_id: examProject, title: '高等数学错题回顾', notes: '第 2 章极限与连续', status: 'open', priority: 5, estimated_minutes: 50, actual_minutes: 0, sort_order: 10, due_at: '2026-09-05T23:59:00+08:00', created_at: createdAt, updated_at: createdAt },
      { id: id(), project_id: examProject, title: '英语阅读一篇并订正', notes: '计时完成后订正', status: 'open', priority: 5, estimated_minutes: 45, actual_minutes: 0, sort_order: 20, due_at: '2026-09-05T23:59:00+08:00', created_at: createdAt, updated_at: createdAt },
      { id: id(), project_id: revenueProject, title: '汇总今天的收益实验数据', notes: '记录关键数据和异常', status: 'open', priority: 3, estimated_minutes: 40, actual_minutes: 0, sort_order: 30, due_at: null, created_at: createdAt, updated_at: createdAt },
      { id: id(), project_id: dramaProject, title: '拆解一个热门开场', notes: '可顺延', status: 'open', priority: 2, estimated_minutes: 45, actual_minutes: 0, sort_order: 40, due_at: null, created_at: createdAt, updated_at: createdAt },
      { id: id(), project_id: liveProject, title: '设计一段特色玩法', notes: '可顺延', status: 'open', priority: 2, estimated_minutes: 45, actual_minutes: 0, sort_order: 50, due_at: null, created_at: createdAt, updated_at: createdAt }
    ],
    time_sessions: [],
    unavailable_blocks: [],
    threads: [],
    messages: [],
    memory_items: [],
    daily_memory_summaries: [],
    memory_organizer_runs: [],
    daily_reviews: [],
    action_logs: [],
    app_usage_daily: [],
    device_activity_daily: [],
    alarms: [],
    ai_preferences: {
      provider_id: '', model: '', reasoning_effort: '',
      memory_provider_id: '', memory_model: '', memory_reasoning_effort: '',
      memory_auto_daily: true, memory_daily_time: '22:00'
    },
    // These are inferred bounds from Android UsageStats, never an automatic
    // replacement for the user's planned sleep/wake schedule.
    sleep_wake_events: []
  };
}

export function repairAssistantState(source) {
  const base = createDefaultAssistantState();
  const state = source && typeof source === 'object' ? source : {};
  const aiPreferences = {
    provider_id: '', model: '', reasoning_effort: '',
    memory_provider_id: '', memory_model: '', memory_reasoning_effort: '',
    memory_auto_daily: true, memory_daily_time: '22:00',
    ...(state.ai_preferences || {})
  };
  if (typeof aiPreferences.memory_auto_daily !== 'boolean') aiPreferences.memory_auto_daily = true;
  if (!/^\d{2}:\d{2}$/.test(String(aiPreferences.memory_daily_time || '')) ||
      Number(aiPreferences.memory_daily_time.slice(0, 2)) > 23 || Number(aiPreferences.memory_daily_time.slice(3, 5)) > 59) {
    aiPreferences.memory_daily_time = '22:00';
  }
  return {
    ...base,
    ...state,
    settings: { ...DEFAULT_SETTINGS, ...(state.settings || {}) },
    projects: Array.isArray(state.projects) ? state.projects : base.projects,
    tasks: (Array.isArray(state.tasks) ? state.tasks : base.tasks).map((task, index) => ({
      ...task,
      priority: taskPriority(task.priority),
      status: ['open', 'in_progress', 'done', 'cancelled', 'deferred'].includes(task.status) ? task.status : 'open',
      actual_minutes: Math.max(0, Number(task.actual_minutes) || 0),
      estimated_minutes: Math.max(5, Math.min(720, Number(task.estimated_minutes) || 45)),
      sort_order: Number.isFinite(Number(task.sort_order)) ? Number(task.sort_order) : (index + 1) * 10
    })),
    time_sessions: Array.isArray(state.time_sessions) ? state.time_sessions : [],
    unavailable_blocks: Array.isArray(state.unavailable_blocks) ? state.unavailable_blocks : [],
    threads: Array.isArray(state.threads) ? state.threads : [],
    messages: Array.isArray(state.messages) ? state.messages : [],
    memory_items: Array.isArray(state.memory_items) ? state.memory_items : [],
    daily_memory_summaries: Array.isArray(state.daily_memory_summaries) ? state.daily_memory_summaries : [],
    memory_organizer_runs: Array.isArray(state.memory_organizer_runs) ? state.memory_organizer_runs : [],
    daily_reviews: Array.isArray(state.daily_reviews) ? state.daily_reviews : [],
    action_logs: Array.isArray(state.action_logs) ? state.action_logs : [],
    app_usage_daily: Array.isArray(state.app_usage_daily) ? state.app_usage_daily : [],
    device_activity_daily: Array.isArray(state.device_activity_daily) ? state.device_activity_daily : [],
    alarms: Array.isArray(state.alarms) ? state.alarms : [],
    ai_preferences: aiPreferences,
    sleep_wake_events: Array.isArray(state.sleep_wake_events) ? state.sleep_wake_events : []
  };
}

function taskProject(task, projects) {
  return projects.find((project) => project.id === task.project_id) || null;
}

function taskPriority(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 3;
  if (numeric >= 4) return 5;
  if (numeric >= 3) return 3;
  return 1;
}

function taskMatches(task, query) {
  const normalized = normalizeText(query, 160).toLocaleLowerCase('zh-CN').replace(/\s+/g, '');
  if (!normalized) return false;
  const title = normalizeText(task.title, 160).toLocaleLowerCase('zh-CN').replace(/\s+/g, '');
  if (title.includes(normalized) || normalized.includes(title)) return true;
  return title.split(/[·•:：、\s]+/).some((part) => part.length >= 2 && normalized.includes(part));
}

function todayPlanningWindow(settings, current = nowParts()) {
  const currentMinutes = minutes(current.time) ?? 0;
  const sleepMinutes = minutes(settings.sleep_time) ?? minutes(DEFAULT_SETTINGS.sleep_time);
  const isAfterMidnightBedtime = sleepMinutes < 8 * 60;
  let endDate = current.date;
  let endMinutes = sleepMinutes;
  // A bedtime after midnight belongs to the upcoming overnight window. When
  // the current time has already passed it (for example 03:39 with 00:00),
  // use the next day's bedtime instead of collapsing availability to zero.
  if (isAfterMidnightBedtime && currentMinutes >= sleepMinutes) endDate = plusDays(current.date, 1);
  if (!isAfterMidnightBedtime && currentMinutes >= sleepMinutes) endMinutes = currentMinutes;
  const dayOffset = endDate === current.date ? 0 : 1;
  const totalUntilEnd = Math.max(0, dayOffset * 1440 + endMinutes - currentMinutes);
  return {
    start_date: current.date,
    start_time: current.time,
    end_date: endDate,
    end_time: timeLabel(endMinutes),
    available_minutes: totalUntilEnd,
    current_minutes: currentMinutes,
    end_absolute_minutes: currentMinutes + totalUntilEnd
  };
}

function dueWeight(task) {
  if (!task.due_at) return Number.MAX_SAFE_INTEGER;
  const result = Date.parse(task.due_at);
  return Number.isNaN(result) ? Number.MAX_SAFE_INTEGER : result;
}

function mergeIntervals(intervals) {
  const merged = [];
  for (const interval of intervals.sort((left, right) => left.start - right.start)) {
    const previous = merged.at(-1);
    if (!previous || interval.start > previous.end) {
      merged.push({ ...interval });
    } else {
      previous.end = Math.max(previous.end, interval.end);
    }
  }
  return merged;
}

function buildPlan(state, current = nowParts()) {
  const window = todayPlanningWindow(state.settings, current);
  const taskItems = state.tasks
    .filter((task) => ['open', 'in_progress'].includes(task.status))
    .sort((left, right) => (right.priority - left.priority) || (dueWeight(left) - dueWeight(right)) || ((Number(left.sort_order) || 0) - (Number(right.sort_order) || 0)) || left.created_at.localeCompare(right.created_at));
  const blocks = state.unavailable_blocks
    .filter((block) => block.date === current.date || block.date === window.end_date)
    .map((block) => ({
      ...block,
      start_absolute: (block.date === current.date ? 0 : 1440) + (minutes(block.start) ?? 0),
      end_absolute: (block.date === current.date ? 0 : 1440) + (minutes(block.end) ?? 0)
    }))
    .map((block) => ({
      ...block,
      start_absolute: Math.max(window.current_minutes, block.start_absolute),
      end_absolute: Math.min(window.end_absolute_minutes, block.end_absolute)
    }))
    .filter((block) => block.end_absolute > block.start_absolute)
    .sort((left, right) => left.start_absolute - right.start_absolute);
  const totalUnavailable = mergeIntervals(blocks.map((block) => ({ start: block.start_absolute, end: block.end_absolute })))
    .reduce((total, block) => total + block.end - block.start, 0);
  const usableMinutes = Math.max(0, window.available_minutes - totalUnavailable);
  const configuredBufferMinutes = Number.isFinite(Number(state.settings.buffer_minutes))
    ? Math.max(0, Math.min(1440, Number(state.settings.buffer_minutes)))
    : DEFAULT_SETTINGS.buffer_minutes;
  const bufferMinutes = Math.min(configuredBufferMinutes, usableMinutes);
  const planningLimit = window.end_absolute_minutes - bufferMinutes;
  let cursor = Math.min(window.end_absolute_minutes, window.current_minutes + 5);
  const scheduled = [];
  const runningSession = (state.time_sessions || []).find((session) => session.status === 'running');
  const activeTimer = runningSession ? {
    task_id: runningSession.task_id,
    mode: runningSession.mode || 'stopwatch',
    target_minutes: Number(runningSession.target_minutes) || 0,
    started_at: runningSession.started_at,
    elapsed_seconds: Math.max(0, (runningSession.elapsed_seconds || 0) + Math.floor((Date.parse(isoAt(current.date, current.time)) - Date.parse(runningSession.started_at)) / 1000))
  } : null;
  const elapsedSecondsForTask = (taskId) => {
    const sessions = (state.time_sessions || []).filter((session) => session.task_id === taskId);
    const stored = sessions.reduce((total, session) => total + (Number(session.elapsed_seconds) || 0), 0);
    if (runningSession?.task_id === taskId && activeTimer) return Math.max(stored, activeTimer.elapsed_seconds);
    return stored;
  };
  const deferred = state.tasks
    .filter((task) => task.status === 'deferred')
    .map((task) => ({ ...task, reason: '已按你的要求顺延，等待下次安排' }));

  function nextAvailableStart(start, duration) {
    let candidate = start;
    while (true) {
      const conflict = blocks.find((block) => candidate < block.end_absolute && candidate + duration > block.start_absolute);
      if (!conflict) return candidate;
      candidate = conflict.end_absolute;
    }
  }

  for (const task of taskItems) {
    const estimated = Math.max(5, Math.min(720, Number(task.estimated_minutes) || 45));
    const start = nextAvailableStart(cursor, estimated);
    const end = start + estimated;
    if (end > planningLimit) {
      deferred.push({ ...task, reason: '保留睡眠与缓冲时间' });
      continue;
    }
    const dateOffset = Math.floor(start / 1440);
    const startMinute = start % 1440;
    const endMinute = end % 1440;
    scheduled.push({
      id: task.id,
      title: task.title,
      project: taskProject(task, state.projects)?.name || '未归类',
      priority: task.priority,
      estimated_minutes: estimated,
      start: timeLabel(startMinute),
      end: timeLabel(endMinute),
      date: plusDays(current.date, dateOffset),
      status: task.status,
      due_at: task.due_at,
      notes: task.notes || '',
      actual_minutes: task.actual_minutes || 0,
      actual_seconds: elapsedSecondsForTask(task.id)
    });
    cursor = end;
  }

  return {
    now: `${current.date} ${current.time}`,
    sleep_time: state.settings.sleep_time,
    wake_time: state.settings.wake_time,
    available_minutes: usableMinutes,
    total_remaining_minutes: window.available_minutes,
    scheduled_minutes: scheduled.reduce((total, item) => total + item.estimated_minutes, 0),
    buffer_minutes: bufferMinutes,
    configured_buffer_minutes: configuredBufferMinutes,
    free_minutes: Math.max(0, usableMinutes - bufferMinutes - scheduled.reduce((total, item) => total + item.estimated_minutes, 0)),
    unavailable_minutes: totalUnavailable,
    current_task: scheduled[0] || null,
    next_task: scheduled[1] || null,
    active_timer: activeTimer,
    scheduled,
    completed: state.tasks.filter((task) => task.status === 'done').slice().sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || ''))).map((task) => ({
      id: task.id, title: task.title, project: taskProject(task, state.projects)?.name || '未归类', priority: task.priority,
      estimated_minutes: task.estimated_minutes, actual_minutes: task.actual_minutes || 0, status: task.status, completed_at: task.completed_at || '', notes: task.notes || ''
    })),
    deferred,
    adjustment_reason: deferred.length
      ? '优先安排截止更近、优先级更高的事项，并为睡眠、不可用时段和缓冲时间留出空间。'
      : '当前任务均可在今天的可用时间内完成，已保留缓冲时间。'
  };
}

function timestampMillis(value) {
  const normalized = normalizeText(value, 48);
  if (!normalized) return Number.NaN;
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}+08:00`;
  return Date.parse(zoned);
}

function clockFromTimestamp(value) {
  const match = normalizeText(value, 48).match(/T(\d{2}:\d{2})/);
  return match?.[1] || '';
}

function inferSleepWakeCandidate(previousDay, currentDay, timestamp) {
  if (!previousDay?.last_active_at || !currentDay?.first_active_at) return null;
  const lastMillis = timestampMillis(previousDay.last_active_at);
  const firstMillis = timestampMillis(currentDay.first_active_at);
  const gapMinutes = Math.round((firstMillis - lastMillis) / 60_000);
  if (!Number.isFinite(gapMinutes) || gapMinutes < 150 || gapMinutes > 16 * 60) return null;
  const sleepTime = clockFromTimestamp(previousDay.last_active_at);
  const wakeTime = clockFromTimestamp(currentDay.first_active_at);
  if (!sleepTime || !wakeTime) return null;
  const firstHour = Number(wakeTime.slice(0, 2));
  const lastHour = Number(sleepTime.slice(0, 2));
  const confidence = gapMinutes >= 270 && gapMinutes <= 13 * 60 && firstHour >= 4 && firstHour <= 13 && (lastHour >= 18 || lastHour <= 4)
    ? 'medium'
    : 'low';
  return {
    id: id(),
    date: currentDay.date,
    kind: 'usage_inference',
    status: 'candidate',
    sleep_at: previousDay.last_active_at,
    wake_at: currentDay.first_active_at,
    sleep_time: sleepTime,
    wake_time: wakeTime,
    gap_minutes: gapMinutes,
    confidence,
    evidence: {
      last_foreground_app: previousDay.last_foreground_app || '',
      first_foreground_app: currentDay.first_foreground_app || '',
      source: 'android-usage-monitor'
    },
    created_at: timestamp,
    updated_at: timestamp
  };
}

function sleepWakeSummary(state) {
  const events = (state.sleep_wake_events || [])
    .filter((item) => item.kind === 'usage_inference' && item.status === 'candidate')
    .slice(0, 7);
  return {
    latest: events[0] || null,
    recent: events,
    note: events.length
      ? '这是根据手机前台应用最后/首次活动推断的候选作息，需要用户确认；不会自动改写计划作息。'
      : '尚未收集到足够的手机应用活动记录来推断作息。'
  };
}

export class AssistantStateStore {
  constructor(vaultPath) {
    this.rootPath = path.join(vaultPath, '.forward-assistant');
    this.filePath = path.join(this.rootPath, 'state.json');
    this.pending = Promise.resolve();
  }

  async read() {
    if (!existsSync(this.filePath)) return createDefaultAssistantState();
    try {
      return repairAssistantState(JSON.parse(await readFile(this.filePath, 'utf8')));
    } catch {
      return createDefaultAssistantState();
    }
  }

  async mutate(operation) {
    const work = this.pending.then(async () => {
      const state = await this.read();
      const result = await operation(state);
      state.updated_at = isoAt(nowParts().date, nowParts().time);
      await mkdir(this.rootPath, { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      await rename(temporaryPath, this.filePath);
      return result;
    });
    this.pending = work.catch(() => undefined);
    return work;
  }

  async bootstrap() {
    // Keep generated default project IDs stable across the first state read and the
    // first conversation creation. Without this initialization, a fresh vault could
    // generate a different default project list for each request.
    const state = existsSync(this.filePath)
      ? await this.read()
      : await this.mutate((draft) => draft);
    return { ...state, plan: buildPlan(state), sleep_wake_summary: sleepWakeSummary(state) };
  }

  async createThread(options = {}) {
    return this.mutate((state) => {
      const current = nowParts();
      const thread = {
        id: id(),
        mode: ['temporary', 'assistant', 'project', 'daily_planning'].includes(options.mode) ? options.mode : 'assistant',
        project_id: options.project_id || null,
        memory_scope: Boolean(options.memory_scope),
        save_full_conversation: options.save_full_conversation !== false,
        allow_memory_distillation: options.allow_memory_distillation !== false,
        created_at: isoAt(current.date, current.time),
        updated_at: isoAt(current.date, current.time)
      };
      if (thread.mode !== 'temporary' || thread.save_full_conversation) state.threads.push(thread);
      return thread;
    });
  }

  async appendMessage(thread, role, content, actionResult = null) {
    if (!thread?.id || !thread.save_full_conversation) return null;
    return this.mutate((state) => {
      const current = nowParts();
      const message = {
        id: id(),
        thread_id: thread.id,
        role: role === 'assistant' ? 'assistant' : 'user',
        content: normalizeText(content, 12000),
        action_result: actionResult,
        created_at: isoAt(current.date, current.time)
      };
      state.messages.push(message);
      const storedThread = state.threads.find((item) => item.id === thread.id);
      if (storedThread) storedThread.updated_at = message.created_at;
      return message;
    });
  }

  async recentMessages(threadId, limit = 16) {
    const state = await this.read();
    return state.messages.filter((item) => item.thread_id === threadId).slice(-limit);
  }

  async getThread(threadId) {
    if (!threadId) return null;
    const state = await this.read();
    return state.threads.find((item) => item.id === threadId) || null;
  }

  async listThreads(limit = 60) {
    const state = await this.read();
    return state.threads
      .slice()
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, Math.max(1, Math.min(200, Number(limit) || 60)))
      .map((thread) => {
        const messages = state.messages.filter((message) => message.thread_id === thread.id);
        const lastMessage = messages.at(-1);
        return {
          ...thread,
          project_name: taskProject({ project_id: thread.project_id }, state.projects)?.name || '',
          message_count: messages.length,
          preview: normalizeText(lastMessage?.content, 100)
        };
      });
  }

  async getThreadMessages(threadId, limit = 200) {
    const state = await this.read();
    const thread = state.threads.find((item) => item.id === threadId);
    if (!thread) return null;
    return {
      ...thread,
      project_name: taskProject({ project_id: thread.project_id }, state.projects)?.name || '',
      messages: state.messages
        .filter((item) => item.thread_id === threadId)
        .slice(-Math.max(1, Math.min(500, Number(limit) || 200)))
    };
  }

  async updateThreadOptions(threadId, options = {}) {
    return this.mutate((state) => {
      const thread = state.threads.find((item) => item.id === threadId);
      if (!thread) return null;
      for (const key of ['memory_scope', 'save_full_conversation', 'allow_memory_distillation']) {
        if (typeof options[key] === 'boolean') thread[key] = options[key];
      }
      thread.updated_at = isoAt(nowParts().date, nowParts().time);
      return thread;
    });
  }

  async updateAiPreferences(preferences = {}) {
    return this.mutate((state) => {
      for (const key of [
        'provider_id', 'model', 'reasoning_effort',
        'memory_provider_id', 'memory_model', 'memory_reasoning_effort', 'memory_daily_time'
      ]) {
        if (typeof preferences[key] === 'string') {
          const value = normalizeText(preferences[key], 160);
          if (key !== 'memory_daily_time' || (/^\d{2}:\d{2}$/.test(value) && Number(value.slice(0, 2)) <= 23 && Number(value.slice(3, 5)) <= 59)) {
            state.ai_preferences[key] = value;
          }
        }
      }
      if (typeof preferences.memory_auto_daily === 'boolean') state.ai_preferences.memory_auto_daily = preferences.memory_auto_daily;
      return state.ai_preferences;
    });
  }

  async startMemoryOrganizerRun({ date, provider_id, model, source_message_count = 0, source_message_ids = [] } = {}) {
    return this.mutate((state) => {
      const current = isoAt(nowParts().date, nowParts().time);
      state.memory_organizer_runs = Array.isArray(state.memory_organizer_runs) ? state.memory_organizer_runs : [];
      const run = {
        id: id(),
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : nowParts().date,
        status: 'running',
        provider_id: normalizeText(provider_id, 120),
        model: normalizeText(model, 160),
        source_message_count: Math.max(0, Math.min(1000, Number(source_message_count) || 0)),
        source_message_ids: [...new Set((Array.isArray(source_message_ids) ? source_message_ids : [])
          .map((value) => normalizeText(value, 120)).filter(Boolean))].slice(0, 1000),
        created_memory_ids: [],
        updated_memory_ids: [],
        duplicate_memory_ids: [],
        error: '',
        started_at: current,
        finished_at: null
      };
      state.memory_organizer_runs.push(run);
      state.memory_organizer_runs = state.memory_organizer_runs.slice(-120);
      return run;
    });
  }

  async finishMemoryOrganizerRun(runId, { date, result, provider_id, model, error = '' } = {}) {
    return this.mutate((state) => {
      const current = isoAt(nowParts().date, nowParts().time);
      state.memory_organizer_runs = Array.isArray(state.memory_organizer_runs) ? state.memory_organizer_runs : [];
      const run = state.memory_organizer_runs.find((item) => item.id === runId);
      if (!run) return null;
      if (error) {
        run.status = 'failed';
        run.error = normalizeText(error, 500);
        run.finished_at = current;
        return { run, created: [], summary: null };
      }
      const applied = applyDailyMemoryResult(state, result || { candidates: [] }, {
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : run.date,
        run_id: run.id,
        provider_id: provider_id || run.provider_id,
        model: model || run.model,
        now: current
      });
      run.status = 'completed';
      run.provider_id = normalizeText(provider_id || run.provider_id, 120);
      run.model = normalizeText(model || run.model, 160);
      run.created_memory_ids = applied.created.map((item) => item.id);
      run.duplicate_memory_ids = applied.duplicate_ids;
      run.updated_memory_ids = [];
      run.error = '';
      run.finished_at = current;
      return { run, ...applied };
    });
  }

  async latestMemoryOrganizerRun() {
    const state = await this.read();
    return (Array.isArray(state.memory_organizer_runs) ? state.memory_organizer_runs : [])
      .slice().sort((left, right) => String(right.started_at || '').localeCompare(String(left.started_at || '')))[0] || null;
  }

  async updateMemoryStatus(memoryId, status, content) {
    if (!['pending_review', 'active', 'archived'].includes(status)) throw new Error('无效的记忆状态。');
    return this.mutate((state) => {
      const memory = state.memory_items.find((item) => item.id === memoryId);
      if (!memory) return null;
      memory.status = status;
      if (content !== undefined) memory.content = normalizeText(content, 220);
      memory.updated_at = isoAt(nowParts().date, nowParts().time);
      return memory;
    });
  }

  async listTasks(options = {}) {
    const state = await this.read();
    const includeCompleted = options.includeCompleted !== false;
    return state.tasks
      .filter((task) => includeCompleted || !['done', 'cancelled'].includes(task.status))
      .slice().sort((a, b) => (Number(b.priority) - Number(a.priority)) || (Number(a.sort_order) - Number(b.sort_order)) || String(a.created_at).localeCompare(String(b.created_at)));
  }

  async updateTask(taskId, values = {}) {
    return this.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) return null;
      const textFields = ['title', 'notes', 'due_at'];
      for (const key of textFields) if (values[key] !== undefined) task[key] = normalizeText(values[key], key === 'notes' ? 500 : 240);
      if (values.estimated_minutes !== undefined) task.estimated_minutes = Math.max(5, Math.min(720, Number(values.estimated_minutes) || task.estimated_minutes || 45));
      if (values.priority !== undefined) task.priority = taskPriority(values.priority);
      if (['open', 'in_progress', 'done', 'cancelled', 'deferred'].includes(values.status)) {
        task.status = values.status;
        if (values.status === 'done') task.completed_at ||= isoAt(nowParts().date, nowParts().time);
        if (values.status !== 'done') delete task.completed_at;
      }
      task.updated_at = isoAt(nowParts().date, nowParts().time);
      return task;
    });
  }

  async reorderTasks(taskIds = []) {
    return this.mutate((state) => {
      const ids = Array.isArray(taskIds) ? taskIds.map((value) => String(value)) : [];
      const seen = new Set();
      ids.forEach((taskId, index) => {
        const task = state.tasks.find((item) => item.id === taskId);
        if (task && !seen.has(taskId)) { task.sort_order = (index + 1) * 10; task.updated_at = isoAt(nowParts().date, nowParts().time); seen.add(taskId); }
      });
      return state.tasks.slice().sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    });
  }

  async taskTimer(taskId, operation, values = {}) {
    return this.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) return null;
      // Timer actions need second precision; minute-only timestamps drop
      // sub-minute progress when pausing or resuming from the mobile client.
      const timestamp = new Date().toISOString();
      state.time_sessions = Array.isArray(state.time_sessions) ? state.time_sessions : [];
      const active = state.time_sessions.find((session) => session.status === 'running');
      const nowMs = Date.now();
      const close = (session, status = 'paused') => {
        if (!session || session.status !== 'running') return;
        const elapsed = Math.max(0, Math.floor((nowMs - Date.parse(session.started_at)) / 1000));
        session.elapsed_seconds = (session.elapsed_seconds || 0) + elapsed;
        session.ended_at = timestamp; session.status = status;
        const target = state.tasks.find((item) => item.id === session.task_id);
        if (target) target.actual_minutes = Math.round(state.time_sessions.filter((s) => s.task_id === target.id).reduce((sum, s) => sum + (s.elapsed_seconds || 0), 0) / 60);
      };
      if (operation === 'start') {
        if (active && active.task_id !== taskId) close(active, 'paused');
        const existing = state.time_sessions
          .filter((session) => session.task_id === taskId && session.status === 'paused' && values.resume !== false)
          .sort((left, right) => Date.parse(String(right.ended_at || '')) - Date.parse(String(left.ended_at || '')))[0];
        if (existing) { existing.status = 'running'; existing.started_at = timestamp; existing.ended_at = null; }
        else state.time_sessions.push({ id: id(), task_id: taskId, mode: values.mode === 'countdown' ? 'countdown' : 'stopwatch', target_minutes: Math.max(1, Number(values.target_minutes) || Number(task.estimated_minutes) || 45), started_at: timestamp, ended_at: null, elapsed_seconds: 0, status: 'running', created_at: timestamp });
        task.status = 'in_progress'; task.updated_at = timestamp;
      } else if (operation === 'pause' || operation === 'stop') {
        const session = state.time_sessions.find((item) => item.task_id === taskId && item.status === 'running');
        if (session) close(session, operation === 'stop' ? 'completed' : 'paused');
        if (operation === 'stop' && task.status === 'in_progress') task.status = 'open';
        task.updated_at = timestamp;
      } else if (operation === 'complete') {
        const session = state.time_sessions.find((item) => item.task_id === taskId && item.status === 'running');
        if (session) close(session, 'completed');
        task.status = 'done'; task.completed_at = timestamp; task.updated_at = timestamp;
      } else if (operation === 'reopen') {
        task.status = 'open'; delete task.completed_at; task.updated_at = timestamp;
      }
      return { task, sessions: state.time_sessions.filter((item) => item.task_id === taskId), active: state.time_sessions.find((item) => item.task_id === taskId && item.status === 'running') || null };
    });
  }

  async addMemoryCandidates(candidates, thread) {
    if (!thread?.allow_memory_distillation || !Array.isArray(candidates) || candidates.length === 0) return [];
    return this.mutate((state) => {
      const current = isoAt(nowParts().date, nowParts().time);
      const existing = state.memory_items.map((item) => item.content);
      const created = candidates
        .map((content) => normalizeText(content, 220))
        .filter(Boolean)
        .slice(0, 5)
        .filter((content) => !existing.some((item) => sameMemory(item, content)))
        .filter((content, index, items) => !items.slice(0, index).some((item) => sameMemory(item, content)))
        .map((content) => ({
          id: id(),
          project_id: thread.project_id || null,
          kind: 'fact',
          content,
          status: 'pending_review',
          thread_id: thread.id,
          created_at: current,
          updated_at: current
        }));
      state.memory_items.push(...created);
      return created;
    });
  }

  async recordAppUsage(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.app) return null;
    return this.mutate((state) => {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(snapshot.date || ''))
        ? String(snapshot.date)
        : nowParts().date;
      const packageName = normalizeText(snapshot.package_name, 160);
      const app = normalizeText(snapshot.app, 120);
      const usage = {
        date,
        app,
        package_name: packageName,
        today_minutes: Math.max(0, Math.min(1440, Number(snapshot.today_minutes) || 0)),
        current_session_minutes: Math.max(0, Math.min(1440, Number(snapshot.current_session_minutes) || 0)),
        max_session_minutes: Math.max(0, Math.min(1440, Number(snapshot.current_session_minutes) || 0)),
        daily_limit_minutes: Math.max(0, Math.min(1440, Number(snapshot.daily_limit_minutes) || 0)),
        session_limit_minutes: Math.max(0, Math.min(1440, Number(snapshot.session_limit_minutes) || 0)),
        in_foreground: Boolean(snapshot.in_foreground),
        last_event: normalizeText(snapshot.last_event, 240),
        updated_at: normalizeText(snapshot.updated_at, 40) || isoAt(nowParts().date, nowParts().time),
        source: normalizeText(snapshot.source, 40) || 'android-usage-monitor'
      };
      usage.over_daily_limit = usage.daily_limit_minutes > 0 && usage.today_minutes >= usage.daily_limit_minutes;
      usage.over_session_limit = usage.session_limit_minutes > 0 && usage.max_session_minutes >= usage.session_limit_minutes;
      const index = state.app_usage_daily.findIndex((item) => item.date === date && item.package_name === packageName);
      if (index >= 0) {
        const previous = state.app_usage_daily[index];
        const preserveTargetMonitor = previous.source === 'android-usage-monitor' && usage.source === 'android-auto-top-ten';
        const merged = {
          ...previous,
          ...usage,
          today_minutes: Math.max(previous.today_minutes || 0, usage.today_minutes),
          max_session_minutes: Math.max(previous.max_session_minutes || 0, usage.max_session_minutes),
          ...(preserveTargetMonitor ? {
            source: previous.source,
            current_session_minutes: previous.current_session_minutes,
            daily_limit_minutes: previous.daily_limit_minutes,
            session_limit_minutes: previous.session_limit_minutes,
            in_foreground: previous.in_foreground,
            last_event: previous.last_event,
            over_daily_limit: previous.over_daily_limit,
            over_session_limit: previous.over_session_limit
          } : {})
        };
        merged.over_daily_limit = merged.daily_limit_minutes > 0 && merged.today_minutes >= merged.daily_limit_minutes;
        merged.over_session_limit = merged.session_limit_minutes > 0 && merged.max_session_minutes >= merged.session_limit_minutes;
        state.app_usage_daily[index] = merged;
      }
      else state.app_usage_daily.push(usage);
      const retentionStart = new Date(`${nowParts().date}T00:00:00.000Z`);
      retentionStart.setUTCDate(retentionStart.getUTCDate() - 364);
      const retentionDate = retentionStart.toISOString().slice(0, 10);
      state.app_usage_daily = state.app_usage_daily
        .filter((item) => item.date >= retentionDate)
        .sort((left, right) => `${right.date} ${right.updated_at}`.localeCompare(`${left.date} ${left.updated_at}`))
        .slice(0, 8_000);
      return state.app_usage_daily.find((item) => item.date === date && item.package_name === packageName) || usage;
    });
  }

  async appUsageHistory(limit = 30) {
    const state = await this.read();
    return state.app_usage_daily.slice(0, Math.max(1, Math.min(365, Number(limit) || 30)));
  }

  async recordDeviceActivity(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(snapshot.date || '')) ? String(snapshot.date) : nowParts().date;
    const firstActiveAt = normalizeText(snapshot.first_active_at, 48);
    const lastActiveAt = normalizeText(snapshot.last_active_at, 48);
    if (!firstActiveAt && !lastActiveAt) return null;
    return this.mutate((state) => {
      const current = isoAt(nowParts().date, nowParts().time);
      const previous = state.device_activity_daily?.find((item) => item.date === date) || {};
      const entries = Array.isArray(state.device_activity_daily) ? state.device_activity_daily : [];
      const activity = {
        date,
        first_active_at: firstActiveAt || previous.first_active_at || '',
        last_active_at: lastActiveAt || previous.last_active_at || '',
        first_foreground_app: normalizeText(snapshot.first_foreground_app, 120) || previous.first_foreground_app || '',
        last_foreground_app: normalizeText(snapshot.last_foreground_app, 120) || previous.last_foreground_app || '',
        updated_at: normalizeText(snapshot.updated_at, 48) || current,
        source: normalizeText(snapshot.source, 48) || 'android-usage-monitor'
      };
      if (previous.first_active_at && (!activity.first_active_at || previous.first_active_at < activity.first_active_at)) {
        activity.first_active_at = previous.first_active_at;
        activity.first_foreground_app = previous.first_foreground_app;
      }
      if (previous.last_active_at && (!activity.last_active_at || previous.last_active_at > activity.last_active_at)) {
        activity.last_active_at = previous.last_active_at;
        activity.last_foreground_app = previous.last_foreground_app;
      }
      const index = entries.findIndex((item) => item.date === date);
      if (index >= 0) entries[index] = activity;
      else entries.push(activity);
      entries.sort((left, right) => right.date.localeCompare(left.date));
      state.device_activity_daily = entries.filter((item) => item.date >= plusDays(nowParts().date, -365)).slice(0, 366);

      const prior = state.device_activity_daily.find((item) => item.date === plusDays(date, -1));
      const candidate = inferSleepWakeCandidate(prior, activity, current);
      if (candidate) {
        const eventIndex = state.sleep_wake_events.findIndex((item) => item.date === date && item.kind === 'usage_inference' && item.status === 'candidate');
        if (eventIndex >= 0) state.sleep_wake_events[eventIndex] = { ...state.sleep_wake_events[eventIndex], ...candidate, updated_at: current };
        else state.sleep_wake_events.push(candidate);
      }
      state.sleep_wake_events = state.sleep_wake_events
        .filter((item) => item.date >= plusDays(nowParts().date, -365))
        .sort((left, right) => `${right.date} ${right.updated_at || right.created_at || ''}`.localeCompare(`${left.date} ${left.updated_at || left.created_at || ''}`))
        .slice(0, 730);
      return candidate || activity;
    });
  }

  async sleepWakeHistory(limit = 14) {
    const state = await this.read();
    return (state.sleep_wake_events || []).slice(0, Math.max(1, Math.min(365, Number(limit) || 14)));
  }

  async updateSleepWakeEvent(eventId, status, values = {}) {
    if (!['candidate', 'confirmed', 'dismissed'].includes(status)) throw new Error('无效的作息候选状态。');
    return this.mutate((state) => {
      const event = state.sleep_wake_events.find((item) => item.id === eventId);
      if (!event) return null;
      event.status = status;
      if (status === 'confirmed') {
        const sleepAt = normalizeText(values.sleep_at, 48);
        const wakeAt = normalizeText(values.wake_at, 48);
        if (sleepAt) event.sleep_at = sleepAt;
        if (wakeAt) event.wake_at = wakeAt;
        event.confirmed_at = isoAt(nowParts().date, nowParts().time);
      }
      event.updated_at = isoAt(nowParts().date, nowParts().time);
      return event;
    });
  }

  async executeActions(actions, context = {}) {
    return this.mutate((state) => {
      const current = nowParts();
      // Keep action timestamps precise so the mobile timer retains seconds.
      const timestamp = new Date().toISOString();
      const results = [];
      const findTask = (query) => state.tasks.find((task) => ['open', 'in_progress', 'deferred'].includes(task.status) && taskMatches(task, query));
      const findAnyTask = (query) => state.tasks.find((task) => taskMatches(task, query));
      const currentTask = () => buildPlan(state, current).current_task && state.tasks.find((task) => task.id === buildPlan(state, current).current_task.id);

      for (const action of Array.isArray(actions) ? actions : []) {
        const type = action?.type;
        let result = { type, ok: false, reason: '未识别的操作。' };
        if (type === 'set_sleep_time') {
          const value = clock(action.time);
          if (value) {
            state.settings.sleep_time = value;
            result = { type, ok: true, value, reason: action.reason || '已更新今晚睡觉时间。' };
          }
        } else if (type === 'set_wake_time') {
          const value = clock(action.time);
          if (value) {
            state.settings.wake_time = value;
            result = { type, ok: true, value, reason: action.reason || '已更新明天起床时间。' };
          }
        } else if (type === 'set_buffer_minutes') {
          const numeric = Number(action.minutes);
          if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 1440) {
            state.settings.buffer_minutes = Math.round(numeric);
            result = { type, ok: true, value: state.settings.buffer_minutes, reason: action.reason || '已更新每日缓冲时间。' };
          } else {
            result = { type, ok: false, reason: '缓冲时间必须是 0 到 1440 分钟之间的数字。' };
          }
        } else if (type === 'set_alarm') {
          const value = clock(action.time);
          const date = /^\d{4}-\d{2}-\d{2}$/.test(String(action.date || '')) ? String(action.date) : null;
          if (value) {
            const alarm = {
              id: id(), time: value, date,
              label: normalizeText(action.label, 120) || '向前提醒',
              repeat: action.repeat === 'daily' ? 'daily' : 'none',
              status: 'pending_device', device_id: null,
              created_at: timestamp, updated_at: timestamp
            };
            state.alarms.push(alarm);
            state.alarms = state.alarms.slice(-200);
            result = { type, ok: true, device_required: true, alarm, reason: action.reason || '已生成手机闹钟请求。' };
          }
        } else if (type === 'cancel_alarm') {
          const requestedId = normalizeText(action.alarm_id, 80);
          const requestedLabel = normalizeText(action.label, 120);
          const requestedTime = clock(action.time);
          const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(action.date || '')) ? String(action.date) : null;
          const alarm = state.alarms
            .filter((item) => ['pending_device', 'active'].includes(item.status))
            .reverse()
            .find((item) => requestedId
              ? item.id === requestedId
              : (!requestedLabel || item.label === requestedLabel)
                && (!requestedTime || item.time === requestedTime)
                && (!requestedDate || item.date === requestedDate));
          if (alarm) {
            alarm.status = 'cancelled'; alarm.updated_at = timestamp;
            result = { type, ok: true, device_required: true, alarm, reason: action.reason || '手机闹钟已标记为取消。' };
          } else {
            result = { type, ok: false, device_required: true, alarm: {
              id: requestedId || '', time: requestedTime || '', date: requestedDate, label: requestedLabel || ''
            }, reason: '没有找到匹配的待处理闹钟。' };
          }
        } else if (type === 'create_task') {
          const title = normalizeText(action.title, 120);
          if (title) {
            const projectName = normalizeText(action.project, 80);
            let project = state.projects.find((item) => item.name === projectName);
            if (!project && projectName) {
              project = { id: id(), name: projectName, description: '', status: 'active', priority: 3, created_at: timestamp };
              state.projects.push(project);
            }
            const task = {
              id: id(), project_id: project?.id || context.project_id || null, title,
              notes: normalizeText(action.reason, 500), status: 'open', priority: taskPriority(action.priority),
              estimated_minutes: Math.max(5, Math.min(720, Number(action.estimated_minutes) || 45)),
              actual_minutes: 0, sort_order: (state.tasks.length + 1) * 10, due_at: action.due_at || null, created_at: timestamp, updated_at: timestamp
            };
            state.tasks.push(task);
            result = { type, ok: true, task, reason: '任务已加入真实任务库。' };
          }
        } else if (['start_task_timer', 'pause_task_timer', 'stop_task_timer', 'complete_task', 'reopen_task', 'update_task', 'reorder_tasks'].includes(type)) {
          if (type === 'reorder_tasks') {
            const ids = Array.isArray(action.task_ids) ? action.task_ids : [];
            ids.forEach((taskId, index) => { const item = state.tasks.find((entry) => entry.id === taskId); if (item) { item.sort_order = (index + 1) * 10; item.updated_at = timestamp; } });
            result = { type, ok: true, reason: '任务顺序已更新。' };
          } else {
            const task = action.task_id ? state.tasks.find((item) => item.id === action.task_id) : (type === 'reopen_task' || type === 'update_task' ? findAnyTask(action.task || action.title) : findTask(action.task || action.title));
            if (task) {
              if (type === 'update_task') {
                if (action.title) task.title = normalizeText(action.title, 120);
                if (action.notes !== undefined) task.notes = normalizeText(action.notes, 500);
                if (action.estimated_minutes !== undefined) task.estimated_minutes = Math.max(5, Math.min(720, Number(action.estimated_minutes) || task.estimated_minutes));
                if (action.priority !== undefined) task.priority = taskPriority(action.priority);
                task.updated_at = timestamp; result = { type, ok: true, task, reason: '任务内容已更新。' };
              } else if (type === 'reopen_task') {
                task.status = 'open'; delete task.completed_at; task.updated_at = timestamp; result = { type, ok: true, task, reason: '任务已重新打开。' };
              } else {
                state.time_sessions ||= [];
                const active = state.time_sessions.find((session) => session.status === 'running');
                const closeSession = (session, status = 'paused') => {
                  if (!session) return;
                  const elapsed = Math.max(0, Math.floor((Date.parse(timestamp) - Date.parse(session.started_at)) / 1000));
                  session.elapsed_seconds = (session.elapsed_seconds || 0) + elapsed; session.ended_at = timestamp; session.status = status;
                  const target = state.tasks.find((item) => item.id === session.task_id);
                  if (target) target.actual_minutes = Math.round(state.time_sessions.filter((s) => s.task_id === target.id).reduce((sum, s) => sum + (s.elapsed_seconds || 0), 0) / 60);
                };
                if (type === 'start_task_timer') {
                  if (active && active.task_id !== task.id) closeSession(active);
                  const existing = state.time_sessions
                    .filter((session) => session.task_id === task.id && session.status === 'paused')
                    .sort((left, right) => Date.parse(String(right.ended_at || '')) - Date.parse(String(left.ended_at || '')))[0];
                  if (existing) { existing.status = 'running'; existing.started_at = timestamp; existing.ended_at = null; }
                  else state.time_sessions.push({ id: id(), task_id: task.id, mode: action.mode === 'countdown' ? 'countdown' : 'stopwatch', target_minutes: Math.max(1, Number(action.target_minutes) || Number(task.estimated_minutes) || 45), started_at: timestamp, ended_at: null, elapsed_seconds: 0, status: 'running', created_at: timestamp });
                  task.status = 'in_progress'; result = { type, ok: true, task, reason: '已开始计时。' };
                } else {
                  const session = state.time_sessions.find((entry) => entry.task_id === task.id && entry.status === 'running');
                  if (session) closeSession(session, type === 'stop_task_timer' || type === 'complete_task' ? 'completed' : 'paused');
                  if (type === 'complete_task') { task.status = 'done'; task.completed_at = timestamp; }
                  else if (type === 'stop_task_timer' && task.status === 'in_progress') task.status = 'open';
                  task.updated_at = timestamp; result = { type, ok: true, task, sessions: state.time_sessions.filter((entry) => entry.task_id === task.id), reason: type === 'pause_task_timer' ? '已暂停计时。' : type === 'complete_task' ? '任务已完成并保留在历史中。' : '计时已停止。' };
                }
              }
            } else result = { type, ok: false, reason: '没有找到匹配的任务。' };
          }
        } else if (type === 'complete_current_task') {
          const task = context.task_id ? state.tasks.find((item) => item.id === context.task_id) : currentTask();
          if (task) {
            const session = (state.time_sessions || []).find((entry) => entry.task_id === task.id && entry.status === 'running');
            if (session) {
              const elapsed = Math.max(0, Math.floor((Date.parse(timestamp) - Date.parse(session.started_at)) / 1000));
              session.elapsed_seconds = (session.elapsed_seconds || 0) + elapsed;
              session.ended_at = timestamp;
              session.status = 'completed';
              task.actual_minutes = Math.round((state.time_sessions || []).filter((entry) => entry.task_id === task.id).reduce((sum, entry) => sum + (entry.elapsed_seconds || 0), 0) / 60);
            }
            task.status = 'done'; task.completed_at = timestamp; task.updated_at = timestamp;
            result = { type, ok: true, task_id: task.id, title: task.title, reason: '任务已完成。' };
          }
        } else if (type === 'cancel_task' || type === 'defer_task') {
          const task = action.task_id
            ? state.tasks.find((item) => item.id === action.task_id)
            : findTask(action.task);
          if (task) {
            task.status = type === 'cancel_task' ? 'cancelled' : 'deferred'; task.updated_at = timestamp;
            result = { type, ok: true, task_id: task.id, title: task.title, reason: type === 'cancel_task' ? '任务已取消。' : '任务已顺延。' };
          }
        } else if (type === 'cancel_all_tasks') {
          const changed = state.tasks.filter((task) => ['open', 'in_progress', 'deferred'].includes(task.status));
          changed.forEach((task) => { task.status = 'cancelled'; task.updated_at = timestamp; });
          result = { type, ok: true, count: changed.length, reason: '未完成任务已全部取消。' };
        } else if (type === 'set_unavailable_period') {
          const start = clock(action.start); const end = clock(action.end);
          if (start && end && minutes(end) > minutes(start)) {
            const block = { id: id(), date: action.date || current.date, start, end, reason: normalizeText(action.reason, 240), created_at: timestamp };
            state.unavailable_blocks.push(block);
            result = { type, ok: true, block, reason: '不可用时段已加入计划。' };
          }
        } else if (type === 'capture_memory') {
          const content = normalizeText(action.title || action.reason, 220);
          if (content && context.allow_memory_distillation !== false) {
            const memory = state.memory_items.find((item) => sameMemory(item.content, content));
            if (memory) {
              result = { type, ok: true, memory, reason: '相同的待确认记忆已经存在。' };
            } else {
              const created = { id: id(), project_id: context.project_id || null, kind: 'fact', content, status: 'pending_review', created_at: timestamp, updated_at: timestamp };
              state.memory_items.push(created);
              result = { type, ok: true, memory: created, reason: '已加入待确认记忆。' };
            }
          } else if (content) {
            result = { type, ok: false, reason: '本次对话未开启长期记忆沉淀。' };
          }
        } else if (type === 'replan_today') {
          result = { type, ok: true, reason: action.reason || '已按最新信息重新规划。' };
        }
        results.push(result);
      }
      if (context.persist_action_log !== false) {
        state.action_logs.push({ id: id(), actions, results, thread_id: context.thread_id || null, created_at: timestamp });
      }
      return { results, plan: buildPlan(state, current) };
    });
  }
}

export function buildDynamicPlan(state, current) {
  return buildPlan(state, current);
}
