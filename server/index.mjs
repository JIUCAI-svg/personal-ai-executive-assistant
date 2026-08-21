import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';
import express from 'express';
import matter from 'gray-matter';
import { AssistantStateStore } from './state-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');

function loadLocalEnvironment() {
  const envPath = path.join(appRoot, '.env.local');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

loadLocalEnvironment();
const defaultVault = path.resolve(appRoot, '..', 'personal-knowledge-base');
const vaultPath = path.resolve(process.env.VAULT_PATH || defaultVault);
const port = Number(process.env.PORT || 8787);
const aiBaseUrl = String(process.env.AI_BASE_URL || '').replace(/\/$/, '');
const aiApiKey = String(process.env.AI_API_KEY || '');
const aiModel = String(process.env.AI_MODEL || '');
const aiReasoningEffort = ['low', 'medium', 'high'].includes(process.env.AI_REASONING_EFFORT)
  ? process.env.AI_REASONING_EFFORT
  : '';
const aiGatewayToken = String(process.env.AI_GATEWAY_TOKEN || '');
const app = express();
const clients = new Set();
const stateStore = new AssistantStateStore(vaultPath);
let revision = Date.now();

app.use(express.json({ limit: '200kb' }));

function documentId(relativePath) {
  return crypto.createHash('sha1').update(relativePath).digest('hex').slice(0, 16);
}

function dateStamp() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

function cleanFilePart(value, fallback = 'untitled') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 72)
    .replace(/^[.-]+|[.-]+$/g, '');
  return cleaned || fallback;
}

function normalizeText(value, maxLength = 12000) {
  return String(value || '').replace(/\r\n/g, '\n').trim().slice(0, maxLength);
}

function relativeFolder(relativePath) {
  const folder = path.dirname(relativePath).replaceAll('\\', '/');
  return folder === '.' ? '根目录' : folder;
}

function noteTitle(parsed, relativePath) {
  const firstHeading = parsed.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return firstHeading || parsed.data.title || path.basename(relativePath, '.md');
}

function notePreview(content) {
  return content
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

async function listMarkdownFiles(directory = vaultPath, parent = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.obsidian' || entry.name.startsWith('.')) continue;
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.join(parent, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(absolutePath, relativePath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push({ absolutePath, relativePath: relativePath.replaceAll('\\', '/') });
    }
  }
  return files;
}

async function readVaultDocuments() {
  if (!existsSync(vaultPath)) return [];
  const files = await listMarkdownFiles();
  const documents = await Promise.all(files.map(async ({ absolutePath, relativePath }) => {
    const [raw, fileStats] = await Promise.all([readFile(absolutePath, 'utf8'), stat(absolutePath)]);
    const parsed = matter(raw);
    return {
      id: documentId(relativePath),
      relativePath,
      folder: relativeFolder(relativePath),
      title: noteTitle(parsed, relativePath),
      preview: notePreview(parsed.content),
      frontmatter: parsed.data,
      updatedAt: fileStats.mtime.toISOString(),
      createdAt: fileStats.birthtime.toISOString(),
      content: parsed.content.trim()
    };
  }));
  return documents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function sendEvent(payload) {
  const message = `event: vault-change\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) client.write(message);
}

async function statusPayload() {
  const documents = await readVaultDocuments();
  return {
    connected: existsSync(vaultPath),
    vaultPath,
    revision,
    documentCount: documents.length,
    folders: [...new Set(documents.map((document) => document.folder))].sort(),
    recentDocuments: documents.slice(0, 4).map(({ content, ...document }) => document)
  };
}

function ensureVaultAvailable(response) {
  if (existsSync(vaultPath)) return true;
  response.status(503).json({
    error: '本地知识库目录不存在',
    vaultPath,
    hint: '在 .env 中设置 VAULT_PATH 后重启本地桥接服务。'
  });
  return false;
}

function selectDestination(kind, project) {
  if (kind === 'raw-context') return '00-Inbox';
  if (kind === 'project-progress') return path.join('20-Projects', cleanFilePart(project, '未归类项目'));
  if (kind === 'daily-review') return path.join('10-Notes', '每日复盘');
  return '10-Notes';
}

function buildFrontmatter(kind, project, source) {
  return {
    created: dateStamp(),
    type: kind,
    status: kind === 'raw-context' ? 'inbox' : 'reviewed',
    source: source || 'personal-ai-executive-assistant',
    ...(project ? { project } : {})
  };
}

async function createKnowledgeNote({ title, body, kind = 'note', project = '', source = '' }) {
  const destination = selectDestination(kind, project);
  const folder = path.join(vaultPath, destination);
  await mkdir(folder, { recursive: true });
  const baseName = `${dateStamp()}-${cleanFilePart(title)}`;
  let index = 1;
  let filename = `${baseName}.md`;
  while (existsSync(path.join(folder, filename))) {
    index += 1;
    filename = `${baseName}-${index}.md`;
  }
  const relativePath = path.join(destination, filename).replaceAll('\\', '/');
  const markdown = matter.stringify(`# ${normalizeText(title, 120)}\n\n${normalizeText(body) || '待补充。'}\n`, buildFrontmatter(kind, project, source));
  await writeFile(path.join(folder, filename), markdown, 'utf8');
  revision = Date.now();
  sendEvent({ revision, change: 'created', relativePath });
  return relativePath;
}

async function appendConversationTranscript(thread, entries) {
  if (!thread?.save_full_conversation || !Array.isArray(entries) || entries.length === 0) return null;
  const folder = path.join(vaultPath, '10-Notes', '对话记录');
  const filename = `${dateStamp()}-向前对话记录.md`;
  const absolutePath = path.join(folder, filename);
  await mkdir(folder, { recursive: true });
  const time = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date());
  const project = thread.project_name ? ` · ${thread.project_name}` : '';
  const header = matter.stringify('# 向前对话记录\n', {
    created: dateStamp(), type: 'conversation-log', mode: thread.mode, source: 'personal-ai-executive-assistant',
    ...(thread.project_name ? { project: thread.project_name } : {})
  });
  const existing = existsSync(absolutePath) ? await readFile(absolutePath, 'utf8') : header;
  const transcript = entries.map((entry) => `### ${entry.role === 'assistant' ? '向前' : '我'} · ${time}\n\n${normalizeText(entry.content, 12000)}`).join('\n\n');
  await writeFile(absolutePath, `${existing.trimEnd()}\n\n## 本次对话${project}\n\n${transcript}\n`, 'utf8');
  revision = Date.now();
  const relativePath = path.relative(vaultPath, absolutePath).replaceAll('\\', '/');
  sendEvent({ revision, change: 'updated', relativePath });
  return relativePath;
}

function isLoopbackRequest(request) {
  const address = String(request.ip || request.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return address === '::1' || address === 'localhost' || address.startsWith('127.');
}

function assistantAuthorized(request, response) {
  if (!aiBaseUrl || !aiApiKey || !aiModel) {
    response.status(503).json({ error: 'AI 网关尚未配置。' });
    return false;
  }
  if (aiGatewayToken && !isLoopbackRequest(request) && request.get('x-forward-token') !== aiGatewayToken) {
    response.status(401).json({ error: 'AI 网关访问令牌不匹配。' });
    return false;
  }
  return true;
}

function stringValue(value, maxLength = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function compactProjectName(value) {
  return stringValue(value, 120).toLocaleLowerCase('zh-CN').replace(/[\s·•，,。.:：-]/g, '');
}

function findProjectByReference(projects, reference) {
  const query = compactProjectName(reference);
  if (!query) return null;
  const exact = projects.find((item) => compactProjectName(item.name) === query);
  if (exact) return exact;
  return projects.find((item) => {
    const name = compactProjectName(item.name);
    return name.includes(query) || query.includes(name);
  }) || null;
}

function chineseNumber(value) {
  if (/^\d{1,2}$/.test(value)) return Number(value);
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value === '十') return 10;
  if (value.includes('十')) {
    const [tensText, unitsText] = value.split('十');
    const tens = tensText ? digits[tensText] : 1;
    const units = unitsText ? digits[unitsText] : 0;
    return tens * 10 + units;
  }
  return digits[value];
}

function explicitTimeActions(message) {
  const text = String(message || '');
  const expression = /(?:(凌晨|早上|上午|中午|下午|傍晚|晚上|今晚)\s*)?(\d{1,2}|[零一二三四五六七八九十两]{1,3})\s*(?::\s*(\d{1,2})|点\s*(?:(\d{1,2})\s*分?|半)?)/g;
  const actions = [];
  for (const match of text.matchAll(expression)) {
    let hour = chineseNumber(match[2]);
    const minute = match[3] !== undefined ? Number(match[3]) : match[4] !== undefined ? Number(match[4]) : match[0].includes('半') ? 30 : 0;
    if (!Number.isInteger(hour) || hour > 23 || minute > 59) continue;
    if (['下午', '傍晚', '晚上', '今晚'].includes(match[1]) && hour < 12) hour += 12;
    const index = match.index || 0;
    const before = text.slice(Math.max(0, index - 4), index);
    const after = text.slice(index + match[0].length, index + match[0].length + 4);
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (/(睡觉|睡下|上床|入睡|睡)/.test(after) || /(睡觉|睡下|上床|入睡|睡)[^，。；;]{0,3}$/.test(before)) {
      actions.push({ type: 'set_sleep_time', time, reason: '根据你刚刚说明的作息时间更新。' });
    }
    if (/(起床|起(?:来|身)?)/.test(after) || /(起床|起(?:来|身)?)[^，。；;]{0,3}$/.test(before)) {
      actions.push({ type: 'set_wake_time', time, reason: '根据你刚刚说明的作息时间更新。' });
    }
  }
  return actions.filter((action, index) => actions.findIndex((item) => item.type === action.type) === index);
}

function explicitTaskCreationActions(message, context = {}) {
  const text = stringValue(message, 800);
  if (!text || /(取消|删除|删掉|移除|不再安排|跳过|顺延|推迟)/.test(text)) return [];
  if (!/(安排|新增|添加|加上|加入|创建|建立|我想做|我要做|今天做|今天想做|打算做|准备做)/.test(text)) return [];

  const markedTitle = text.match(/(?:任务|事项|事情)\s*[：:]\s*([^，,。；;]+?)(?=\s*(?:，|,|。|；|;|$))/);
  const actionTitle = text.match(/(?:安排|新增|添加|加上|加入|创建|建立)\s*(?:一个|一项|个)?(?:任务|事项|事情)?\s*[：:]?\s*([^，,。；;]+?)(?=\s*(?:，|,|。|；|;|$))/);
  const naturalTitle = text.match(/(?:今天|明天)?\s*(?:我)?\s*(?:打算|准备|想要|要|想)做\s*([^，,。；;]+?)(?=\s*(?:，|,|。|；|;|$))/);
  let title = stringValue(markedTitle?.[1] || actionTitle?.[1] || naturalTitle?.[1], 120)
    .replace(/^(?:今天|明天|现在|请|帮我|我要|我想|做一个|一个|一项)\s*/, '')
    .trim();
  if (!title || title.length < 2) return [];

  const durationMatch = text.match(/(?:预计|大约|时长|用时|需要|花)\s*(\d{1,3})\s*(?:分钟|min)/i);
  const projectMatch = text.match(/(?:放到|加入|归到|关联到|放进)\s*([^，,。；;]{1,60}?)(?:项目(?:里|中)?|之中)/);
  const requestedProject = stringValue(projectMatch?.[1] || context.project_name, 80);
  const project = findProjectByReference(context.projects || [], requestedProject);
  return [{
    type: 'create_task',
    title,
    estimated_minutes: durationMatch ? Number(durationMatch[1]) : 45,
    priority: /(最高优先|最重要|紧急|优先完成)/.test(text) ? 5 : 3,
    ...(project ? { project: project.name } : {}),
    reason: '根据你明确说明的事项加入今日计划。'
  }];
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  const allowedTypes = new Set([
    'set_sleep_time',
    'set_wake_time',
    'complete_current_task',
    'cancel_task',
    'cancel_all_tasks',
    'defer_task',
    'create_task',
    'set_unavailable_period',
    'capture_memory',
    'replan_today'
  ]);
  return actions
    .filter((action) => action && allowedTypes.has(action.type))
    .slice(0, 8)
    .map((action) => ({
      type: action.type,
      ...(stringValue(action.time, 5) ? { time: stringValue(action.time, 5) } : {}),
      ...(stringValue(action.start, 5) ? { start: stringValue(action.start, 5) } : {}),
      ...(stringValue(action.end, 5) ? { end: stringValue(action.end, 5) } : {}),
      ...(stringValue(action.task, 120) ? { task: stringValue(action.task, 120) } : {}),
      ...(stringValue(action.title, 120) ? { title: stringValue(action.title, 120) } : {}),
      ...(Number.isFinite(Number(action.estimated_minutes)) ? { estimated_minutes: Math.max(5, Math.min(480, Number(action.estimated_minutes))) } : {}),
      ...(Number.isFinite(Number(action.priority)) ? { priority: Math.max(1, Math.min(5, Number(action.priority))) } : {}),
      ...(stringValue(action.project, 80) ? { project: stringValue(action.project, 80) } : {}),
      ...(stringValue(action.due_at, 40) ? { due_at: stringValue(action.due_at, 40) } : {}),
      ...(stringValue(action.date, 10) ? { date: stringValue(action.date, 10) } : {}),
      ...(stringValue(action.reason, 240) ? { reason: stringValue(action.reason, 240) } : {})
    }));
}

function mentionedTaskFromContext(message, context) {
  const normalized = String(message || '').replace(/\s+/g, '').toLowerCase();
  const plans = Array.isArray(context?.today_plan) ? context.today_plan : [];
  for (const item of plans) {
    const title = stringValue(item?.title, 120);
    if (!title) continue;
    const compactTitle = title.replace(/\s+/g, '').toLowerCase();
    const keywords = title.split(/[·•:：、\s]+/).map((part) => part.trim()).filter((part) => part.length >= 2);
    if (normalized.includes(compactTitle) || keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))) return title;
  }
  return '';
}

function enforceUserIntent(result, message, context) {
  const normalized = String(message || '').replace(/\s+/g, '').toLowerCase();
  const explicitlyComplete = /(完成|做完|搞定|结束了|已经做了|已完成)/.test(normalized)
    && !/(不做|不想做|取消|删除|删掉|移除|跳过|先不|别安排|顺延|推迟)/.test(normalized);
  const cancelIntent = /(取消|删除|删掉|移除|不再安排)/.test(normalized);
  const deferIntent = /(今天不做|不想做|跳过|先不|别安排|顺延|推迟)/.test(normalized);
  const cancelAllIntent = /(所有|全部|整个).{0,8}(任务|安排|计划)|(清空|清除).{0,8}(任务|安排|计划)/.test(normalized);
  if ((cancelIntent || deferIntent) && !explicitlyComplete) {
    const currentReference = /(?:这个|当前|正在).{0,5}(?:任务|安排|计划)|(?:取消|删除|删掉|移除).{0,6}(?:它|这个)/.test(normalized);
    const mentionedTask = mentionedTaskFromContext(message, context) || (currentReference ? stringValue(context?.current_task?.title, 120) : '');
    result.actions = result.actions.filter((action) => !['complete_current_task', 'cancel_task', 'cancel_all_tasks', 'defer_task'].includes(action.type));
    if (cancelAllIntent && cancelIntent) {
      result.actions.push({ type: 'cancel_all_tasks', reason: '用户明确要求取消全部任务和安排' });
    } else if (mentionedTask) {
      result.actions.push({
        type: cancelIntent ? 'cancel_task' : 'defer_task',
        task: mentionedTask,
        reason: cancelIntent ? '用户明确要求从计划中取消该任务' : '用户明确表示今天不安排该任务'
      });
    }
  }
  if (!explicitlyComplete) result.actions = result.actions.filter((action) => action.type !== 'complete_current_task');
  for (const action of explicitTimeActions(message)) {
    result.actions = result.actions.filter((item) => item.type !== action.type);
    result.actions.push(action);
  }
  return result;
}

function localFallbackResult(message, context) {
  return enforceUserIntent({
    reply: 'AI 服务暂时没有回复。我已先执行这条可以明确判断的计划调整，稍后可以继续对话。',
    actions: explicitTaskCreationActions(message, context),
    memoryCandidates: []
  }, message, context);
}

function parseAssistantContent(content) {
  const raw = String(content || '').trim();
  const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(jsonText);
  return {
    reply: stringValue(parsed.reply, 1200) || '我已经处理好了。',
    actions: normalizeActions(parsed.actions),
    memoryCandidates: Array.isArray(parsed.memory_candidates)
      ? parsed.memory_candidates.map((item) => stringValue(item, 220)).filter(Boolean).slice(0, 5)
      : []
  };
}

async function assistantKnowledgeContext({ enabled = true, projectName = '' } = {}) {
  if (!enabled) return [];
  if (!existsSync(vaultPath)) return [];
  const normalizedProject = normalizeText(projectName, 120).toLocaleLowerCase('zh-CN');
  const documents = await readVaultDocuments();
  const scoped = normalizedProject
    ? documents.filter((document) => `${document.folder}\n${document.title}\n${JSON.stringify(document.frontmatter)}`.toLocaleLowerCase('zh-CN').includes(normalizedProject))
    : documents;
  return scoped
    .slice(0, 5)
    .map((document) => ({ title: document.title, folder: document.folder, preview: document.preview }));
}

function assistantSystemPrompt() {
  return `你是“向前”，一个中文个人 AI 执行助手，不是普通聊天机器人。

职责：理解用户自然语言，协助其管理作息、今日计划、任务、项目进度和每日记录。回答自然、简洁、具体。先回应用户真正关心的事，再说明你做了哪些调整及原因。不要假装已经完成未在 actions 中表达的操作。

你必须只输出有效 JSON，不要 Markdown，不要额外文字：
{
  "reply": "给用户看的自然中文回复",
  "actions": [
    {"type":"set_sleep_time","time":"HH:mm","reason":"..."},
    {"type":"set_wake_time","time":"HH:mm","reason":"..."},
    {"type":"complete_current_task","reason":"..."},
    {"type":"cancel_task","task":"任务名","reason":"..."},
    {"type":"cancel_all_tasks","reason":"..."},
    {"type":"defer_task","task":"任务名","reason":"..."},
    {"type":"create_task","title":"任务名","estimated_minutes":45,"priority":3,"project":"项目名","due_at":"可选 ISO 时间","reason":"..."},
    {"type":"set_unavailable_period","start":"HH:mm","end":"HH:mm","reason":"..."},
    {"type":"capture_memory","title":"要沉淀的信息","project":"可选项目","reason":"..."},
    {"type":"replan_today","reason":"..."}
  ],
  "memory_candidates": ["需要用户确认后写入长期记忆的候选"]
}

规则：
- 只在用户明确表达或对计划有直接影响时返回 actions；普通聊天可返回空数组。
- 时间必须 24 小时制 HH:mm。用户说“今晚一点睡”就设为 01:00；说“明天八点起”就设为 08:00。
- 只有用户明确说“当前任务完成/做完”时才可使用 complete_current_task。
- 用户说“取消、删除、移除”某项任务时，使用 cancel_task，该任务从今天的计划中移除；不要声称只是顺延。
- 用户说“取消所有任务、全部清空计划”时，使用 cancel_all_tasks，清空今天和已顺延的安排。
- 用户说“今天不做、跳过、顺延、明天再做”时，使用 defer_task，该任务保留但移到之后；取消和顺延不能混用。
- 用户说外出或某段时间不可用时，使用 set_unavailable_period；用户说疲惫时，使用 defer_task 推迟高消耗任务，并使用 replan_today。
- 用户新增一件事时，使用 create_task；不要直接声称它已经加入计划而没有 action。若未给预计时长，按合理的最小可执行时长估计，并在回复中说明。
- 长期记忆只提取稳定偏好、明确决定、项目里程碑或重要事实；不要把普通闲聊自动写入。
- 不要编造任务、进度、日期或知识库内容。`;
}

app.get('/api/assistant/status', (request, response) => {
  if (!assistantAuthorized(request, response)) return;
  response.json({ ok: true, model: aiModel, provider: 'OpenAI-compatible relay', configured: true });
});

async function resolveConversationThread(body = {}) {
  const existing = await stateStore.getThread(stringValue(body.thread_id, 80));
  if (existing) return existing;
  const requestedMode = stringValue(body.conversation_mode || body.mode, 40);
  const mode = ['temporary', 'assistant', 'project', 'daily_planning'].includes(requestedMode) ? requestedMode : 'assistant';
  const options = body.conversation_options || {};
  const state = await stateStore.bootstrap();
  const projectId = stringValue(options.project_id || body.project_id, 80);
  const projectName = stringValue(options.project || body.project, 120);
  const project = state.projects.find((item) => item.id === projectId) || findProjectByReference(state.projects, projectName);
  const thread = await stateStore.createThread({
    mode,
    project_id: project?.id || null,
    memory_scope: options.memory_scope ?? (mode !== 'temporary'),
    save_full_conversation: options.save_full_conversation ?? (mode !== 'temporary'),
    allow_memory_distillation: options.allow_memory_distillation ?? (mode !== 'temporary')
  });
  return { ...thread, project_name: project?.name || '' };
}

function threadProjectName(thread, state) {
  return state.projects.find((item) => item.id === thread?.project_id)?.name || '';
}

app.get('/api/assistant/state', async (_request, response, next) => {
  try {
    response.json({ ok: true, state: await stateStore.bootstrap() });
  } catch (error) { next(error); }
});

app.get('/api/assistant/threads', async (request, response, next) => {
  try {
    response.json({ ok: true, threads: await stateStore.listThreads(request.query.limit) });
  } catch (error) { next(error); }
});

app.get('/api/assistant/threads/:id', async (request, response, next) => {
  try {
    const thread = await stateStore.getThreadMessages(stringValue(request.params.id, 80), request.query.limit);
    if (!thread) return response.status(404).json({ error: '未找到这段对话。' });
    response.json({ ok: true, thread });
  } catch (error) { next(error); }
});

app.patch('/api/assistant/threads/:id', async (request, response, next) => {
  try {
    const options = request.body?.conversation_options || request.body || {};
    const thread = await stateStore.updateThreadOptions(stringValue(request.params.id, 80), options);
    if (!thread) return response.status(404).json({ error: '这段对话没有保存，因此没有可更新的对话设置。' });
    response.json({ ok: true, thread, state: await stateStore.bootstrap() });
  } catch (error) { next(error); }
});

app.post('/api/assistant/threads', async (request, response, next) => {
  try {
    const thread = await resolveConversationThread(request.body || {});
    response.status(201).json({ ok: true, thread });
  } catch (error) { next(error); }
});

app.post('/api/assistant/actions', async (request, response, next) => {
  try {
    const body = request.body || {};
    const thread = await resolveConversationThread(body);
    const execution = await stateStore.executeActions(normalizeActions(body.actions), {
      thread_id: thread.id,
      project_id: thread.project_id,
      task_id: stringValue(body.task_id, 80),
      allow_memory_distillation: thread.allow_memory_distillation,
      persist_action_log: thread.mode !== 'temporary' || thread.save_full_conversation
    });
    response.json({ ok: true, thread, ...execution, state: await stateStore.bootstrap() });
  } catch (error) { next(error); }
});

app.patch('/api/assistant/memories/:id', async (request, response, next) => {
  try {
    const status = stringValue(request.body?.status, 40);
    const memory = await stateStore.updateMemoryStatus(request.params.id, status, request.body?.content);
    if (!memory) return response.status(404).json({ error: '未找到这条记忆。' });
    let relativePath = null;
    if (memory.status === 'active') {
      relativePath = await createKnowledgeNote({
        title: '已确认记忆', body: memory.content, kind: 'note', source: 'personal-ai-executive-assistant'
      });
    }
    response.json({ ok: true, memory, relativePath, state: await stateStore.bootstrap() });
  } catch (error) { next(error); }
});

app.post('/api/assistant/respond', async (request, response, next) => {
  try {
    if (!assistantAuthorized(request, response)) return;
    const body = request.body || {};
    const message = stringValue(body.message, 4000);
    if (!message) return response.status(400).json({ error: '需要一条消息。' });

    const thread = await resolveConversationThread(body);
    const stateBefore = await stateStore.bootstrap();
    const projectName = threadProjectName(thread, stateBefore);
    const hydratedThread = { ...thread, project_name: projectName };
    const userMessage = await stateStore.appendMessage(hydratedThread, 'user', message);
    const storedConversation = userMessage
      ? (await stateStore.recentMessages(hydratedThread.id, 16)).filter((entry) => entry.id !== userMessage.id)
      : [];
    const suppliedConversation = Array.isArray(body.conversation)
      ? body.conversation.slice(-12).map((entry) => ({
          role: entry?.role === 'assistant' ? 'assistant' : 'user', content: stringValue(entry?.content, 1800)
        })).filter((entry) => entry.content)
      : [];
    const conversation = storedConversation.length ? storedConversation : suppliedConversation;
    const context = body.context || {};
    const knowledge = await assistantKnowledgeContext({
      enabled: hydratedThread.memory_scope && hydratedThread.mode !== 'temporary',
      projectName: hydratedThread.mode === 'project' ? projectName : ''
    });
    const planBefore = stateBefore.plan;
    const contextText = JSON.stringify({
      now: planBefore.now,
      conversation_mode: hydratedThread.mode,
      project: projectName || null,
      sleep_time: planBefore.sleep_time,
      wake_time: planBefore.wake_time,
      today_plan: planBefore.scheduled.slice(0, 12),
      current_task: planBefore.current_task,
      deferred_tasks: planBefore.deferred.slice(0, 8),
      recent_client_context: {
        now: stringValue(context.now, 40),
        note: stringValue(context.note, 500)
      },
      knowledge: hydratedThread.memory_scope ? knowledge : []
    });
    const intentContext = {
      today_plan: planBefore.scheduled,
      current_task: planBefore.current_task,
      projects: stateBefore.projects,
      project_name: projectName
    };
    async function finishAssistantResponse(result, degraded = false) {
      const execution = await stateStore.executeActions(result.actions, {
        thread_id: hydratedThread.id, project_id: hydratedThread.project_id,
        task_id: stringValue(context.current_task_id, 80),
        allow_memory_distillation: hydratedThread.allow_memory_distillation,
        persist_action_log: hydratedThread.mode !== 'temporary' || hydratedThread.save_full_conversation
      });
      if (degraded) {
        const completed = execution.results.filter((item) => item.ok);
        const created = completed.find((item) => item.type === 'create_task');
        const cancelled = completed.find((item) => item.type === 'cancel_task');
        const deferred = completed.find((item) => item.type === 'defer_task');
        const sleep = completed.find((item) => item.type === 'set_sleep_time');
        const wake = completed.find((item) => item.type === 'set_wake_time');
        if (created) result.reply = `已把「${created.task.title}」加入真实任务库，预计 ${created.task.estimated_minutes} 分钟，并按今天的剩余时间重新安排。`;
        else if (cancelled) result.reply = `已取消「${cancelled.title}」，它已从今天的计划中移除。`;
        else if (deferred) result.reply = `已把「${deferred.title}」顺延，今天不再安排它。`;
        else if (sleep || wake) result.reply = `作息已更新：${sleep ? `今晚 ${sleep.value} 睡觉` : ''}${sleep && wake ? '，' : ''}${wake ? `明天 ${wake.value} 起床` : ''}。我已按新的可用时间重排计划。`;
      }
      const pendingMemories = await stateStore.addMemoryCandidates(result.memoryCandidates, hydratedThread);
      const assistantMessage = await stateStore.appendMessage(hydratedThread, 'assistant', result.reply, execution.results);
      const transcriptPath = await appendConversationTranscript(hydratedThread, [
        { role: 'user', content: message }, { role: 'assistant', content: result.reply }
      ]);
      return response.json({
        ok: true, degraded, model: aiModel, thread: hydratedThread, reply: result.reply, actions: result.actions,
        actionResults: execution.results, memoryCandidates: result.memoryCandidates, pendingMemories, memoryRead: knowledge,
        plan: execution.plan, transcriptPath, messageIds: { user: userMessage?.id || null, assistant: assistantMessage?.id || null },
        state: await stateStore.bootstrap()
      });
    }

    let upstream;
    try {
      upstream = await fetch(`${aiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${aiApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: aiModel,
          temperature: 0.45,
          ...(aiReasoningEffort ? { reasoning_effort: aiReasoningEffort } : {}),
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: assistantSystemPrompt() },
            { role: 'system', content: `当前可用上下文（只使用其中真实内容）：${contextText}` },
            ...conversation,
            { role: 'user', content: message }
          ]
        }),
        signal: AbortSignal.timeout(45_000)
      });
    } catch (error) {
      console.error('AI relay connection error', error?.cause?.code || error?.name || 'unknown');
      const fallback = localFallbackResult(message, intentContext);
      return finishAssistantResponse(fallback, true);
    }
    const upstreamBody = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      console.error('AI relay error', upstream.status, upstreamBody);
      const fallback = localFallbackResult(message, intentContext);
      return finishAssistantResponse(fallback, true);
    }
    const content = upstreamBody?.choices?.[0]?.message?.content;
    const result = enforceUserIntent(parseAssistantContent(content), message, intentContext);
    return finishAssistantResponse(result);
  } catch (error) {
    if (error instanceof SyntaxError) return response.status(502).json({ error: 'AI 返回格式异常，请重试。' });
    next(error);
  }
});

app.get('/api/health', (_request, response) => response.json({ ok: true, vaultPath, revision }));

app.get('/api/vault/status', async (_request, response, next) => {
  try {
    if (!ensureVaultAvailable(response)) return;
    response.json(await statusPayload());
  } catch (error) { next(error); }
});

app.get('/api/vault/documents', async (request, response, next) => {
  try {
    if (!ensureVaultAvailable(response)) return;
    const query = normalizeText(request.query.query, 200).toLocaleLowerCase('zh-CN');
    const folder = normalizeText(request.query.folder, 120);
    const documents = await readVaultDocuments();
    const filtered = documents.filter((document) => {
      const matchesFolder = !folder || document.folder === folder;
      const haystack = `${document.title}\n${document.preview}\n${JSON.stringify(document.frontmatter)}`.toLocaleLowerCase('zh-CN');
      return matchesFolder && (!query || haystack.includes(query));
    }).map(({ content, ...document }) => document);
    response.json({ documents: filtered, revision });
  } catch (error) { next(error); }
});

app.get('/api/vault/documents/:id', async (request, response, next) => {
  try {
    if (!ensureVaultAvailable(response)) return;
    const document = (await readVaultDocuments()).find((item) => item.id === request.params.id);
    if (!document) return response.status(404).json({ error: '未找到该知识库文档。' });
    response.json({ document });
  } catch (error) { next(error); }
});

app.post('/api/vault/write', async (request, response, next) => {
  try {
    if (!ensureVaultAvailable(response)) return;
    const { title, body, kind, project, source } = request.body || {};
    if (!normalizeText(title, 120)) return response.status(400).json({ error: '需要一条标题。' });
    if (!['note', 'project-progress', 'daily-review', 'raw-context'].includes(kind)) {
      return response.status(400).json({ error: '不支持的写入类型。' });
    }
    const relativePath = await createKnowledgeNote({ title, body, kind, project, source });
    response.status(201).json({ ok: true, relativePath, revision });
  } catch (error) { next(error); }
});

app.get('/api/vault/events', (request, response) => {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });
  response.write(`event: vault-change\ndata: ${JSON.stringify({ revision, change: 'ready' })}\n\n`);
  clients.add(response);
  request.on('close', () => clients.delete(response));
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: '本地知识库桥接服务遇到错误。' });
});

const androidApkPath = path.join(appRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
app.get('/download/forward.apk', (_request, response) => {
  if (!existsSync(androidApkPath)) return response.status(404).json({ error: 'Android 安装包尚未生成。' });
  response.download(androidApkPath, 'forward-0.1.0-debug.apk');
});

const distPath = path.join(appRoot, 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((_request, response) => response.sendFile(path.join(distPath, 'index.html')));
}

const watcher = chokidar.watch(vaultPath, {
  ignoreInitial: true,
  ignored: /(^|[\\/])\../,
  awaitWriteFinish: { stabilityThreshold: 450, pollInterval: 100 }
});
watcher.on('all', (_event, changedPath) => {
  revision = Date.now();
  sendEvent({ revision, change: 'updated', relativePath: path.relative(vaultPath, changedPath).replaceAll('\\', '/') });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Knowledge bridge listening on http://0.0.0.0:${port}`);
  console.log(`Vault: ${vaultPath}`);
});
