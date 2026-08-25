import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
      { id: id(), project_id: examProject, title: '高等数学错题回顾', notes: '第 2 章极限与连续', status: 'open', priority: 5, estimated_minutes: 50, actual_minutes: null, due_at: '2026-09-05T23:59:00+08:00', created_at: createdAt, updated_at: createdAt },
      { id: id(), project_id: examProject, title: '英语阅读一篇并订正', notes: '计时完成后订正', status: 'open', priority: 5, estimated_minutes: 45, actual_minutes: null, due_at: '2026-09-05T23:59:00+08:00', created_at: createdAt, updated_at: createdAt },
      { id: id(), project_id: revenueProject, title: '汇总今天的收益实验数据', notes: '记录关键数据和异常', status: 'open', priority: 3, estimated_minutes: 40, actual_minutes: null, due_at: null, created_at: createdAt, updated_at: createdAt },
      { id: id(), project_id: dramaProject, title: '拆解一个热门开场', notes: '可顺延', status: 'open', priority: 2, estimated_minutes: 45, actual_minutes: null, due_at: null, created_at: createdAt, updated_at: createdAt },
      { id: id(), project_id: liveProject, title: '设计一段特色玩法', notes: '可顺延', status: 'open', priority: 2, estimated_minutes: 45, actual_minutes: null, due_at: null, created_at: createdAt, updated_at: createdAt }
    ],
    unavailable_blocks: [],
    threads: [],
    messages: [],
    memory_items: [],
    daily_reviews: [],
    action_logs: [],
    app_usage_daily: []
  };
}

export function repairAssistantState(source) {
  const base = createDefaultAssistantState();
  const state = source && typeof source === 'object' ? source : {};
  return {
    ...base,
    ...state,
    settings: { ...DEFAULT_SETTINGS, ...(state.settings || {}) },
    projects: Array.isArray(state.projects) ? state.projects : base.projects,
    tasks: Array.isArray(state.tasks) ? state.tasks : base.tasks,
    unavailable_blocks: Array.isArray(state.unavailable_blocks) ? state.unavailable_blocks : [],
    threads: Array.isArray(state.threads) ? state.threads : [],
    messages: Array.isArray(state.messages) ? state.messages : [],
    memory_items: Array.isArray(state.memory_items) ? state.memory_items : [],
    daily_reviews: Array.isArray(state.daily_reviews) ? state.daily_reviews : [],
    action_logs: Array.isArray(state.action_logs) ? state.action_logs : [],
    app_usage_daily: Array.isArray(state.app_usage_daily) ? state.app_usage_daily : []
  };
}

function taskProject(task, projects) {
  return projects.find((project) => project.id === task.project_id) || null;
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
  if (isAfterMidnightBedtime && currentMinutes >= 8 * 60) endDate = plusDays(current.date, 1);
  if (!isAfterMidnightBedtime && currentMinutes >= sleepMinutes) endMinutes = currentMinutes;
  if (isAfterMidnightBedtime && currentMinutes < 8 * 60 && currentMinutes >= sleepMinutes) endMinutes = currentMinutes;
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
    .sort((left, right) => (right.priority - left.priority) || (dueWeight(left) - dueWeight(right)) || left.created_at.localeCompare(right.created_at));
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
  const bufferMinutes = Math.min(Number(state.settings.buffer_minutes) || 60, Math.floor(usableMinutes * 0.35));
  const planningLimit = window.end_absolute_minutes - bufferMinutes;
  let cursor = Math.min(window.end_absolute_minutes, window.current_minutes + 5);
  const scheduled = [];
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
      notes: task.notes || ''
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
    free_minutes: Math.max(0, usableMinutes - bufferMinutes - scheduled.reduce((total, item) => total + item.estimated_minutes, 0)),
    unavailable_minutes: totalUnavailable,
    current_task: scheduled[0] || null,
    next_task: scheduled[1] || null,
    scheduled,
    deferred,
    adjustment_reason: deferred.length
      ? '优先安排截止更近、优先级更高的事项，并为睡眠、不可用时段和缓冲时间留出空间。'
      : '当前任务均可在今天的可用时间内完成，已保留缓冲时间。'
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
    const state = await this.read();
    return { ...state, plan: buildPlan(state) };
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

  async executeActions(actions, context = {}) {
    return this.mutate((state) => {
      const current = nowParts();
      const timestamp = isoAt(current.date, current.time);
      const results = [];
      const findTask = (query) => state.tasks.find((task) => ['open', 'in_progress', 'deferred'].includes(task.status) && taskMatches(task, query));
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
              notes: normalizeText(action.reason, 500), status: 'open', priority: Number(action.priority) || 3,
              estimated_minutes: Math.max(5, Math.min(720, Number(action.estimated_minutes) || 45)),
              actual_minutes: null, due_at: action.due_at || null, created_at: timestamp, updated_at: timestamp
            };
            state.tasks.push(task);
            result = { type, ok: true, task, reason: '任务已加入真实任务库。' };
          }
        } else if (type === 'complete_current_task') {
          const task = context.task_id ? state.tasks.find((item) => item.id === context.task_id) : currentTask();
          if (task) {
            task.status = 'done'; task.completed_at = timestamp; task.updated_at = timestamp;
            result = { type, ok: true, task_id: task.id, title: task.title, reason: '任务已完成。' };
          }
        } else if (type === 'cancel_task' || type === 'defer_task') {
          const task = findTask(action.task);
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
