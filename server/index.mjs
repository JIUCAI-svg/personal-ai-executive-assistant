import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';
import express from 'express';
import matter from 'gray-matter';
import { AssistantStateStore } from './state-store.mjs';
import { SupabaseStateStore } from './supabase-state-store.mjs';
import { loadAiProviders, normalizeAiProviderDraft, providerCatalog, saveAiProviders, selectAiProvider } from './ai-providers.mjs';
import { assistantEndpoint, buildAssistantModelRequest, extractAssistantText, upstreamErrorMessage } from './ai-protocol.mjs';
import { memoryOrganizerPrompt, parseDailyMemoryResult, rawMessagesForDay, searchMemory } from './memory-organizer.mjs';
import {
  ASSISTANT_TOOL_NAMES,
  assistantMcpTools,
  assistantSkillCatalog,
  assistantSkillPrompt,
  assistantToolCatalog,
  assistantToolPrompt
} from './assistant-tools.mjs';

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
const aiMaxRetries = 6;
const aiGatewayToken = String(process.env.AI_GATEWAY_TOKEN || '');
const aiProvidersFile = path.resolve(process.env.AI_PROVIDERS_FILE || path.join(appRoot, '.ai-providers.json'));
let aiProviderRegistry = loadAiProviders(aiProvidersFile, {
  active_profile: process.env.AI_ACTIVE_PROFILE,
  base_url: aiBaseUrl,
  api_key: aiApiKey,
  model: aiModel,
  id: 'default',
  name: '默认 AI 网关'
});
const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabaseAnonKey = String(process.env.SUPABASE_ANON_KEY || '');
const app = express();
app.set('trust proxy', 'loopback');
const clients = new Set();
const stateStore = new AssistantStateStore(vaultPath);
let revision = Date.now();

app.use(express.json({ limit: '200kb' }));

function supabaseIsConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

function requestError(message, status = 500, code = '') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function accessTokenFromRequest(request) {
  const match = String(request.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function authenticatedSupabaseUser(request) {
  if (!supabaseIsConfigured()) throw requestError('Supabase 尚未配置。', 503, 'SUPABASE_NOT_CONFIGURED');
  const accessToken = accessTokenFromRequest(request);
  if (!accessToken) throw requestError('请先登录后再同步。', 401, 'AUTH_REQUIRED');
  let upstream;
  try {
    upstream = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw requestError('无法连接 Supabase，请检查网络和项目配置。', 503, 'SUPABASE_UNREACHABLE');
  }
  const user = await upstream.json().catch(() => null);
  if (!upstream.ok || !user?.id) throw requestError('登录已失效，请重新登录。', 401, 'SUPABASE_AUTH_EXPIRED');
  return { id: user.id, email: user.email || '', accessToken };
}

async function requestStateStore(request) {
  const accessToken = accessTokenFromRequest(request);
  if (!accessToken) return { store: stateStore, source: 'local', user: null };
  const user = await authenticatedSupabaseUser(request);
  return {
    store: new SupabaseStateStore({ url: supabaseUrl, anonKey: supabaseAnonKey, accessToken: user.accessToken, userId: user.id }),
    source: 'cloud',
    user
  };
}

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
  if (!Object.keys(aiProviderRegistry.profiles).length) {
    response.status(503).json({ error: 'AI 网关尚未配置。' });
    return false;
  }
  const origin = request.get('origin');
  const sameOrigin = origin && (() => {
    try { return new URL(origin).host === request.get('host'); } catch { return false; }
  })();
  const browserSameOrigin = sameOrigin || request.get('sec-fetch-site') === 'same-origin';
  if (aiGatewayToken && !isLoopbackRequest(request) && !browserSameOrigin && request.get('x-forward-token') !== aiGatewayToken) {
    response.status(401).json({ error: 'AI 网关访问令牌不匹配。' });
    return false;
  }
  return true;
}

function bridgeAuthorized(request, response) {
  if (aiGatewayToken && !isLoopbackRequest(request) && request.get('x-forward-token') !== aiGatewayToken) {
    response.status(401).json({ error: '桥接访问令牌不匹配。' });
    return false;
  }
  return true;
}

function stringValue(value, maxLength = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeAppUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const minutes = (input, fallback = 0) => {
    const parsed = Number(input);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(24 * 60, Math.round(parsed))) : fallback;
  };
  const app = stringValue(value.app, 120);
  const packageName = stringValue(value.package_name, 160);
  if (!app && !packageName && value.today_minutes === undefined && value.current_session_minutes === undefined) return null;
  return {
    enabled: Boolean(value.enabled),
    app: app || '未命名应用',
    package_name: packageName,
    today_minutes: minutes(value.today_minutes),
    current_session_minutes: minutes(value.current_session_minutes),
    daily_limit_minutes: minutes(value.daily_limit_minutes),
    session_limit_minutes: minutes(value.session_limit_minutes),
    in_foreground: Boolean(value.in_foreground),
    last_event: stringValue(value.last_event, 240),
    updated_at: stringValue(value.updated_at, 40),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(value.date || '')) ? String(value.date) : dateStamp(),
    source: stringValue(value.source, 40) || 'android-usage-monitor'
  };
}

function normalizeAppUsages(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .slice(0, 20)
    .map((item) => normalizeAppUsage(item))
    .filter(Boolean)
    .filter((item, index, all) => all.findIndex((candidate) => (
      candidate.date === item.date && candidate.package_name === item.package_name && candidate.source === item.source
    )) === index);
}

function normalizeDeviceActivity(value) {
  if (!value || typeof value !== 'object') return null;
  const isoValue = (input) => {
    const result = stringValue(input, 48);
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(result) ? result : '';
  };
  const firstActiveAt = isoValue(value.first_active_at);
  const lastActiveAt = isoValue(value.last_active_at);
  if (!firstActiveAt && !lastActiveAt) return null;
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(value.date || '')) ? String(value.date) : dateStamp(),
    first_active_at: firstActiveAt,
    last_active_at: lastActiveAt,
    first_foreground_app: stringValue(value.first_foreground_app, 120),
    last_foreground_app: stringValue(value.last_foreground_app, 120),
    updated_at: isoValue(value.updated_at) || new Date().toISOString(),
    source: stringValue(value.source, 48) || 'android-usage-monitor'
  };
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

function inferImplicitTimeType(text, context = {}) {
  if (!/(调整|改成|改到|设为|设置为|改为|换成|提前到|推迟到|延后到)/.test(text)) return '';
  const conversation = Array.isArray(context.conversation) ? context.conversation : [];
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const content = String(conversation[index]?.content || '');
    if (/(睡觉|睡下|上床|入睡|睡眠|睡)/.test(content)) return 'sleep';
    if (/(起床|起身|起来|醒来|睡醒)/.test(content)) return 'wake';
  }
  return '';
}

function explicitTimeActions(message, context = {}) {
  const text = String(message || '');
  const expression = /(?:(凌晨|早上|上午|中午|下午|傍晚|晚上|今晚)\s*)?(\d{1,2}|[零一二三四五六七八九十两]{1,3})\s*(?::\s*(\d{1,2})|点\s*(?:(\d{1,2})\s*分?|半)?)/g;
  const actions = [];
  const implicitType = inferImplicitTimeType(text, context);
  for (const match of text.matchAll(expression)) {
    let hour = chineseNumber(match[2]);
    const minute = match[3] !== undefined ? Number(match[3]) : match[4] !== undefined ? Number(match[4]) : match[0].includes('半') ? 30 : 0;
    if (!Number.isInteger(hour) || hour > 23 || minute > 59) continue;
    // "今晚 00:40" is already a midnight time; only shift 1-11 o'clock to PM.
    if (['下午', '傍晚', '晚上', '今晚'].includes(match[1]) && hour > 0 && hour < 12) hour += 12;
    if (!match[1] && implicitType === 'sleep' && hour >= 6 && hour < 12) hour += 12;
    const index = match.index || 0;
    const before = text.slice(Math.max(0, index - 4), index);
    const after = text.slice(index + match[0].length, index + match[0].length + 4);
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (/(睡觉|睡下|上床|入睡|睡)/.test(after) || /(睡觉|睡下|上床|入睡|睡)[^，。；;]{0,3}$/.test(before) || (implicitType === 'sleep' && !match[1])) {
      actions.push({ type: 'set_sleep_time', time, reason: '根据你刚刚说明的作息时间更新。' });
    }
    if (/(起床|起(?:来|身)?)/.test(after) || /(起床|起(?:来|身)?)[^，。；;]{0,3}$/.test(before) || (implicitType === 'wake' && !match[1])) {
      actions.push({ type: 'set_wake_time', time, reason: '根据你刚刚说明的作息时间更新。' });
    }
  }
  return actions.filter((action, index) => actions.findIndex((item) => item.type === action.type) === index);
}

function explicitUnavailableActions(message) {
  const text = String(message || '');
  if (!/(出门|外出|不可用|不在|有事|占用)/.test(text)) return [];
  const expression = /(?:(今天|今晚)\s*)?(\d{1,2})\s*(?::\s*(\d{1,2})|点\s*(?:(\d{1,2})\s*分?|半)?)\s*(?:到|至|[-~～])\s*(\d{1,2})\s*(?::\s*(\d{1,2})|点\s*(?:(\d{1,2})\s*分?|半)?)/g;
  const actions = [];
  for (const match of text.matchAll(expression)) {
    let startHour = Number(match[2]);
    let endHour = Number(match[5]);
    const startMinute = match[3] !== undefined ? Number(match[3]) : match[4] !== undefined ? Number(match[4]) : match[0].includes('半') ? 30 : 0;
    const endMinute = match[6] !== undefined ? Number(match[6]) : match[7] !== undefined ? Number(match[7]) : /(?:到|至|[-~～])\s*\d{1,2}\s*点\s*半/.test(match[0]) ? 30 : 0;
    if (![startHour, endHour, startMinute, endMinute].every(Number.isInteger) || startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) continue;
    if (match[1] === '今晚') {
      if (startHour > 0 && startHour < 12) startHour += 12;
      if (endHour > 0 && endHour < 12) endHour += 12;
    }
    const start = `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`;
    const end = `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;
    if (start < end) actions.push({ type: 'set_unavailable_period', start, end, reason: '用户明确说明该时段不可用。' });
  }
  return actions.slice(0, 2);
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
  return actions
    .filter((action) => action && ASSISTANT_TOOL_NAMES.has(action.type))
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
    && !/(不做|不想做|取消|删除|删掉|移除|跳过|先不|别安排|顺延|推迟|吗|[?？])/.test(normalized);
  const cancelIntent = /(取消|删除|删掉|移除|不再安排)/.test(normalized);
  const deferQuestion = /(?:可|能|是否|哪些|什么).{0,5}顺延|顺延.{0,5}(?:吗|哪些|什么)/.test(normalized);
  const deferIntent = /(今天不做|不想做|跳过|先不|别安排|顺延|推迟)/.test(normalized) && !deferQuestion;
  const cancelAllIntent = /(所有|全部|整个).{0,8}(任务|安排|计划)|(清空|清除).{0,8}(任务|安排|计划)/.test(normalized);

  // Task status changes require an explicit user command, never an AI inference from a question.
  result.actions = result.actions.filter((action) => !['complete_current_task', 'cancel_task', 'cancel_all_tasks', 'defer_task'].includes(action.type));
  if ((cancelIntent || deferIntent) && !explicitlyComplete) {
    const currentReference = /(?:这个|当前|正在).{0,5}(?:任务|安排|计划)|(?:取消|删除|删掉|移除).{0,6}(?:它|这个)/.test(normalized);
    const mentionedTask = mentionedTaskFromContext(message, context) || (currentReference ? stringValue(context?.current_task?.title, 120) : '');
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
  if (explicitlyComplete) {
    result.actions.push({ type: 'complete_current_task', reason: '用户明确说明当前任务已完成。' });
  }
  for (const action of explicitTimeActions(message, context)) {
    result.actions = result.actions.filter((item) => item.type !== action.type);
    result.actions.push(action);
  }
  for (const action of explicitUnavailableActions(message)) {
    result.actions = result.actions.filter((item) => item.type !== 'set_unavailable_period');
    result.actions.push(action);
    if (!result.actions.some((item) => item.type === 'replan_today')) {
      result.actions.push({ type: 'replan_today', reason: '已根据用户说明的不可用时段重新安排。' });
    }
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

async function assistantKnowledgeContext({ enabled = true, projectName = '', projectId = '', query = '', state = null } = {}) {
  if (!enabled) return [];
  const structured = state && query
    ? searchMemory(state, query, { projectId, limit: 8 }).map((entry) => {
        if (entry.type === 'memory') return {
          source: 'memory', title: entry.item.kind || '长期记忆', preview: entry.item.content,
          tags: entry.item.tags || [], source_message_ids: entry.item.source_message_ids || []
        };
        return {
          source: 'daily_summary', title: `${entry.item.date} 每日摘要`, preview: entry.item.summary,
          tags: ['每日整理'], source_message_ids: entry.item.source_message_ids || []
        };
      })
    : [];
  if (!existsSync(vaultPath)) return structured;
  const normalizedProject = normalizeText(projectName, 120).toLocaleLowerCase('zh-CN');
  const documents = await readVaultDocuments();
  const scoped = normalizedProject
    ? documents.filter((document) => `${document.folder}\n${document.title}\n${JSON.stringify(document.frontmatter)}`.toLocaleLowerCase('zh-CN').includes(normalizedProject))
    : documents;
  const vaultContext = scoped
    .slice(0, 5)
    .map((document) => ({ source: 'vault', title: document.title, folder: document.folder, preview: document.preview }));
  return [...structured, ...vaultContext].slice(0, 12);
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

可调用工具（actions.type 必须使用以下名称）：
${assistantToolPrompt()}

规则：
- 只在用户明确表达或对计划有直接影响时返回 actions；普通聊天可返回空数组。
- 时间必须 24 小时制 HH:mm。用户说“今晚一点睡”就设为 01:00；说“明天八点起”就设为 08:00。
- 只有用户明确说“当前任务完成/做完”时才可使用 complete_current_task。
- 用户说“取消、删除、移除”某项任务时，使用 cancel_task，该任务从今天的计划中移除；不要声称只是顺延。
- 用户说“取消所有任务、全部清空计划”时，使用 cancel_all_tasks，清空今天和已顺延的安排。
- 用户说“今天不做、跳过、顺延、明天再做”时，使用 defer_task，该任务保留但移到之后；取消和顺延不能混用。
- 用户说外出或某段时间不可用时，使用 set_unavailable_period；用户说疲惫时，使用 defer_task 推迟高消耗任务，并使用 replan_today。
- 用户新增一件事时，使用 create_task；不要直接声称它已经加入计划而没有 action。若未给预计时长，按合理的最小可执行时长估计，并在回复中说明。
- 上下文中的 app_usage 是手机本地监控提供的真实使用摘要和每日记录，不是可选工具。若 current 或 daily_history 存在，必须把它们视为当前事实；可以根据今日累计时长、连续时长、历史趋势和上限解释提醒或重排计划，但不要推断用户在应用中看了什么，也不要把每一次使用记录自动沉淀为长期记忆。
- sleep_wake_from_phone 是根据前一日最后一次、当日第一次前台应用活动计算出的“候选作息”，仅用于提醒、复盘和在用户追问时说明；它不是确认后的作息，绝对不要自动调用 set_sleep_time 或 set_wake_time 覆盖用户设置。要明确说明候选、证据边界和置信度。
- 长期记忆只提取稳定偏好、明确决定、项目里程碑或重要事实；不要把普通闲聊自动写入。
- 不要编造任务、进度、日期或知识库内容。`;
}

function waitForAiRetry(attempt) {
  return new Promise((resolve) => setTimeout(resolve, Math.min(2400, 400 * attempt)));
}

async function requestModelText(payload) {
  const provider = payload.provider;
  const requestPayload = { ...payload };
  delete requestPayload.provider;
  const maxRetries = Number.isInteger(requestPayload.max_retries)
    ? Math.max(0, Math.min(aiMaxRetries, requestPayload.max_retries))
    : aiMaxRetries;
  delete requestPayload.max_retries;
  let lastError = null;
  for (let retry = 0; retry <= maxRetries; retry += 1) {
    if (retry > 0) await waitForAiRetry(retry);
    try {
      const upstream = await fetch(assistantEndpoint(provider), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.api_key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(buildAssistantModelRequest(provider, requestPayload)),
        signal: AbortSignal.timeout(45_000)
      });
      const upstreamBody = await upstream.json().catch(() => null);
      if (!upstream.ok) {
        throw new Error(upstreamErrorMessage(upstreamBody, upstream.status));
      }
      const content = extractAssistantText(provider, upstreamBody);
      if (!String(content || '').trim()) {
        throw new Error('AI 返回正文为空。');
      }
      return { content, attempts: retry + 1 };
    } catch (error) {
      lastError = error;
      console.error(`AI attempt ${retry + 1}/${maxRetries + 1} failed`, error?.cause?.code || error?.message || error?.name || 'unknown');
    }
  }
  throw lastError || new Error('AI 请求失败。');
}

async function requestAssistantModel(payload) {
  const { content, attempts } = await requestModelText(payload);
  return { result: parseAssistantContent(content), attempts };
}

app.get('/api/assistant/status', (request, response) => {
  if (!assistantAuthorized(request, response)) return;
  response.json({
    ok: true,
    model: aiProviderRegistry.profiles[aiProviderRegistry.active]?.selected_model || aiModel,
    providers: providerCatalog(aiProviderRegistry),
    provider: 'OpenAI-compatible relay',
    configured: true,
    tools: assistantToolCatalog(),
    skills: assistantSkillCatalog()
  });
});

// Read-only catalog for diagnostics and future MCP/Skill clients.
app.get('/api/assistant/tools', (request, response) => {
  if (!assistantAuthorized(request, response)) return;
  response.json({ ok: true, tools: assistantToolCatalog(), skills: assistantSkillCatalog() });
});

app.get('/api/assistant/providers', (request, response) => {
  if (!assistantAuthorized(request, response)) return;
  response.json({ ok: true, active: aiProviderRegistry.active, providers: providerCatalog(aiProviderRegistry) });
});

function providerDraftFromRequest(body = {}) {
  const models = Array.isArray(body.models)
    ? body.models
    : String(body.models || '').split(/[\n,，]/g);
  const reasoningEfforts = Array.isArray(body.reasoning_efforts)
    ? body.reasoning_efforts
    : String(body.reasoning_efforts || '').split(/[\n,，]/g);
  return {
    id: stringValue(body.id, 120),
    name: stringValue(body.name, 120),
    base_url: stringValue(body.base_url, 500),
    api_key: String(body.api_key || '').trim().slice(0, 1000),
    api_mode: stringValue(body.api_mode, 40),
    models,
    selected_model: stringValue(body.selected_model, 160),
    reasoning_efforts: reasoningEfforts
  };
}

async function persistProviderRegistry(registry) {
  await saveAiProviders(aiProvidersFile, registry);
  aiProviderRegistry = registry;
  return aiProviderRegistry;
}

app.post('/api/assistant/providers', async (request, response, next) => {
  try {
    if (!assistantAuthorized(request, response)) return;
    const profile = normalizeAiProviderDraft(providerDraftFromRequest(request.body));
    if (aiProviderRegistry.profiles[profile.id]) {
      return response.status(409).json({ error: '这个中转站 ID 已存在，请换一个名称。', code: 'PROVIDER_ID_EXISTS' });
    }
    const nextRegistry = {
      active: aiProviderRegistry.active || profile.id,
      profiles: { ...aiProviderRegistry.profiles, [profile.id]: profile }
    };
    await persistProviderRegistry(nextRegistry);
    response.status(201).json({ ok: true, provider: providerCatalog(aiProviderRegistry).find((item) => item.id === profile.id), providers: providerCatalog(aiProviderRegistry) });
  } catch (error) { next(error); }
});

app.patch('/api/assistant/providers/:id', async (request, response, next) => {
  try {
    if (!assistantAuthorized(request, response)) return;
    const current = aiProviderRegistry.profiles[request.params.id];
    if (!current) return response.status(404).json({ error: '未找到这个中转站。' });
    const draft = providerDraftFromRequest(request.body);
    draft.id = current.id;
    const profile = normalizeAiProviderDraft(draft, current);
    const nextRegistry = { ...aiProviderRegistry, profiles: { ...aiProviderRegistry.profiles, [current.id]: profile } };
    await persistProviderRegistry(nextRegistry);
    response.json({ ok: true, provider: providerCatalog(aiProviderRegistry).find((item) => item.id === profile.id), providers: providerCatalog(aiProviderRegistry) });
  } catch (error) { next(error); }
});

// This endpoint deliberately uses an isolated JSON-only request. It verifies
// the selected provider/model/protocol without writing any tasks, memories or
// conversation records.
app.post('/api/assistant/providers/:id/test', async (request, response, next) => {
  try {
    if (!assistantAuthorized(request, response)) return;
    const provider = selectAiProvider(
      aiProviderRegistry,
      request.params.id,
      request.body?.model,
      aiModel,
      request.body?.reasoning_effort || aiReasoningEffort
    );
    const { result, attempts } = await requestAssistantModel({
      provider,
      model: provider.model,
      max_retries: 0,
      ...(provider.reasoning_effort ? { reasoning_effort: provider.reasoning_effort } : {}),
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '只输出有效 JSON：{"reply":"连接正常","actions":[],"memory_candidates":[]}' },
        { role: 'user', content: '请返回连接正常。' }
      ]
    });
    response.json({
      ok: true,
      provider: provider.id,
      provider_name: provider.name,
      model: provider.model,
      api_mode: provider.api_mode,
      reasoning_effort: provider.reasoning_effort || null,
      attempts,
      reply: result.reply
    });
  } catch (error) { next(error); }
});

function mcpResponse(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function mcpError(id, code, message, data = undefined) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function mcpArguments(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// Minimal MCP-compatible JSON-RPC bridge. It intentionally delegates every
// mutation to the same state store used by the chat runtime.
app.post('/api/mcp', async (request, response, next) => {
  if (!assistantAuthorized(request, response)) return;
  const body = request.body || {};
  const id = body.id;
  const method = stringValue(body.method, 80);
  try {
    if (method === 'initialize') {
      return response.json(mcpResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'personal-ai-executive-assistant', version: revision.toString() }
      }));
    }
    if (method === 'notifications/initialized') return response.status(204).end();
    if (method === 'tools/list') return response.json(mcpResponse(id, { tools: assistantMcpTools() }));
    if (method !== 'tools/call') return response.status(400).json(mcpError(id, -32601, `不支持 MCP 方法：${method || '空方法'}`));

    const params = body.params || {};
    const name = stringValue(params.name, 80);
    if (!ASSISTANT_TOOL_NAMES.has(name)) {
      return response.status(400).json(mcpError(id, -32602, `未注册的工具：${name || '空工具名'}`));
    }
    const action = normalizeActions([{ ...mcpArguments(params.arguments), type: name }])[0];
    if (!action) return response.status(400).json(mcpError(id, -32602, '工具参数格式不正确。'));
    const { store, source } = await requestStateStore(request);
    const thread = await resolveConversationThread(store, {
      thread_id: params.thread_id,
      conversation_mode: params.conversation_mode || 'assistant',
      project_id: params.project_id,
      conversation_options: params.conversation_options
    });
    const execution = await store.executeActions([action], {
      thread_id: thread.id,
      project_id: thread.project_id,
      task_id: stringValue(params.task_id, 80),
      allow_memory_distillation: thread.allow_memory_distillation,
      persist_action_log: thread.mode !== 'temporary' || thread.save_full_conversation
    });
    const result = execution.results[0] || { type: name, ok: false, reason: '工具没有返回执行结果。' };
    const payload = {
      source,
      thread_id: thread.id,
      requested: action,
      result,
      plan: execution.plan
    };
    return response.json(mcpResponse(id, {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      isError: !result.ok,
      structuredContent: payload
    }));
  } catch (error) {
    return next(error);
  }
});

async function resolveConversationThread(store, body = {}) {
  const existing = await store.getThread(stringValue(body.thread_id, 80));
  if (existing) return existing;
  const requestedMode = stringValue(body.conversation_mode || body.mode, 40);
  const mode = ['temporary', 'assistant', 'project', 'daily_planning'].includes(requestedMode) ? requestedMode : 'assistant';
  const options = body.conversation_options || {};
  const state = await store.bootstrap();
  const projectId = stringValue(options.project_id || body.project_id, 80);
  const projectName = stringValue(options.project || body.project, 120);
  const project = state.projects.find((item) => item.id === projectId) || findProjectByReference(state.projects, projectName);
  const thread = await store.createThread({
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

app.get('/api/auth/config', (_request, response) => {
  response.json({
    ok: true,
    configured: supabaseIsConfigured(),
    url: supabaseIsConfigured() ? supabaseUrl : '',
    anonKey: supabaseIsConfigured() ? supabaseAnonKey : ''
  });
});

app.get('/api/assistant/sync/status', async (request, response, next) => {
  try {
    const user = await authenticatedSupabaseUser(request);
    const store = new SupabaseStateStore({ url: supabaseUrl, anonKey: supabaseAnonKey, accessToken: user.accessToken, userId: user.id });
    const snapshot = await store.hasSnapshot();
    response.json({ ok: true, source: 'cloud', user: { email: user.email }, snapshot });
  } catch (error) { next(error); }
});

app.post('/api/assistant/sync/initialize', async (request, response, next) => {
  try {
    const user = await authenticatedSupabaseUser(request);
    const store = new SupabaseStateStore({ url: supabaseUrl, anonKey: supabaseAnonKey, accessToken: user.accessToken, userId: user.id });
    const snapshot = await store.hasSnapshot();
    if (snapshot.exists) return response.status(409).json({ error: '云端已经有数据，请刷新后继续使用云端版本。', code: 'CLOUD_STATE_EXISTS' });
    const localState = await stateStore.bootstrap();
    delete localState.plan;
    await store.mutate((state) => {
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, localState);
      return true;
    });
    response.status(201).json({ ok: true, source: 'cloud', state: await store.bootstrap(), snapshot: await store.hasSnapshot() });
  } catch (error) { next(error); }
});

app.get('/api/assistant/state', async (request, response, next) => {
  try {
    const { store, source } = await requestStateStore(request);
    response.json({ ok: true, source, state: await store.bootstrap() });
  } catch (error) { next(error); }
});

app.patch('/api/assistant/preferences', async (request, response, next) => {
  try {
    const { store, source } = await requestStateStore(request);
    const body = request.body || {};
    const preferencesInput = {};
    for (const [key, limit] of Object.entries({
      provider_id: 120, model: 160, reasoning_effort: 20,
      memory_provider_id: 120, memory_model: 160, memory_reasoning_effort: 20, memory_daily_time: 20
    })) {
      if (typeof body[key] === 'string') preferencesInput[key] = stringValue(body[key], limit);
    }
    if (typeof body.memory_auto_daily === 'boolean') preferencesInput.memory_auto_daily = body.memory_auto_daily;
    const preferences = await store.updateAiPreferences(preferencesInput);
    response.json({ ok: true, source, preferences, state: await store.bootstrap() });
  } catch (error) { next(error); }
});

app.get('/api/assistant/memory/status', async (request, response, next) => {
  try {
    const { store, source } = await requestStateStore(request);
    const state = await store.bootstrap();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(request.query.date || '')) ? String(request.query.date) : dateStamp();
    const latestRun = (state.memory_organizer_runs || []).slice()
      .sort((left, right) => String(right.started_at || '').localeCompare(String(left.started_at || '')))[0] || null;
    const summary = (state.daily_memory_summaries || []).find((item) => item.date === date) || null;
    response.json({
      ok: true,
      source,
      date,
      raw_message_count: rawMessagesForDay(state, date).length,
      latest_run: latestRun,
      summary,
      memory_counts: {
        active: (state.memory_items || []).filter((item) => item.status === 'active').length,
        pending_review: (state.memory_items || []).filter((item) => item.status === 'pending_review').length,
        archived: (state.memory_items || []).filter((item) => item.status === 'archived').length
      }
    });
  } catch (error) { next(error); }
});

app.get('/api/assistant/memory/search', async (request, response, next) => {
  try {
    const { store, source } = await requestStateStore(request);
    const query = stringValue(request.query.q, 400);
    if (!query) return response.status(400).json({ error: '请输入要检索的关键词。' });
    const state = await store.bootstrap();
    response.json({ ok: true, source, query, results: searchMemory(state, query, {
      projectId: stringValue(request.query.project_id, 100), limit: request.query.limit
    }) });
  } catch (error) { next(error); }
});

app.get('/api/assistant/memory/export', async (request, response, next) => {
  try {
    const { store, source } = await requestStateStore(request);
    const state = await store.bootstrap();
    const messagesByThread = new Map();
    for (const message of state.messages || []) {
      if (!messagesByThread.has(message.thread_id)) messagesByThread.set(message.thread_id, []);
      messagesByThread.get(message.thread_id).push(message);
    }
    const rawConversations = (state.threads || [])
      .filter((thread) => thread.mode !== 'temporary' && thread.save_full_conversation !== false)
      .map((thread) => ({
        thread: { ...thread },
        messages: (messagesByThread.get(thread.id) || []).slice().sort((left, right) => String(left.created_at || '').localeCompare(String(right.created_at || '')))
      }));
    response.json({
      schema_version: 1,
      exported_at: new Date().toISOString(),
      source,
      description: '原始对话不可变来源 + 可重新生成的派生记忆、每日摘要与整理记录。',
      raw_conversations: rawConversations,
      memory_items: state.memory_items || [],
      daily_memory_summaries: state.daily_memory_summaries || [],
      memory_organizer_runs: state.memory_organizer_runs || []
    });
  } catch (error) { next(error); }
});

app.post('/api/assistant/memory/daily-run', async (request, response, next) => {
  let store;
  let run;
  let source;
  try {
    if (!assistantAuthorized(request, response)) return;
    ({ store, source } = await requestStateStore(request));
    const state = await store.bootstrap();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(request.body?.date || '')) ? String(request.body.date) : dateStamp();
    const preferences = state.ai_preferences || {};
    const provider = selectAiProvider(
      aiProviderRegistry,
      request.body?.provider_id || preferences.memory_provider_id || preferences.provider_id,
      request.body?.model || preferences.memory_model || preferences.model,
      aiModel,
      request.body?.reasoning_effort || preferences.memory_reasoning_effort || preferences.reasoning_effort || aiReasoningEffort
    );
    if (!provider) return response.status(503).json({ error: '尚未配置可用的记忆整理模型。', code: 'MEMORY_PROVIDER_NOT_CONFIGURED' });
    const rawMessages = rawMessagesForDay(state, date);
    run = await store.startMemoryOrganizerRun({ date, provider_id: provider.id, model: provider.model, source_message_count: rawMessages.length });
    if (!rawMessages.length) {
      const finished = await store.finishMemoryOrganizerRun(run.id, { date, provider_id: provider.id, model: provider.model, result: { candidates: [], projectUpdates: [], updateSuggestions: [], summary: '' } });
      return response.json({ ok: true, source, empty: true, run: finished.run, created: [], summary: null, state: await store.bootstrap() });
    }
    const activeMemories = (state.memory_items || []).filter((item) => item.status === 'active').slice(-80).map((item) => ({
      id: item.id, kind: item.kind, content: item.content, project_id: item.project_id, tags: item.tags || []
    }));
    const prompt = memoryOrganizerPrompt({
      date,
      messages: rawMessages,
      projects: (state.projects || []).map((item) => ({ id: item.id, name: item.name, status: item.status })),
      existingMemories: activeMemories,
      actionLogs: (state.action_logs || []).filter((item) => String(item.created_at || '').startsWith(date)).slice(-60),
      usage: (state.app_usage_daily || []).filter((item) => item.date === date).slice(0, 20),
      sleepWake: state.sleep_wake_summary?.latest || null
    });
    const { content, attempts } = await requestModelText({
      provider,
      model: provider.model,
      temperature: 0.1,
      max_retries: 2,
      ...(provider.reasoning_effort ? { reasoning_effort: provider.reasoning_effort } : {}),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你负责每天整理个人记忆。必须遵守用户数据来源边界并输出 JSON。' },
        { role: 'user', content: prompt }
      ]
    });
    const parsed = parseDailyMemoryResult(content, { state, messages: rawMessages });
    const finished = await store.finishMemoryOrganizerRun(run.id, { date, provider_id: provider.id, model: provider.model, result: parsed });
    response.json({ ok: true, source, attempts, run: finished.run, created: finished.created, duplicate_ids: finished.duplicate_ids, summary: finished.summary, state: await store.bootstrap() });
  } catch (error) {
    if (store && run) {
      try { await store.finishMemoryOrganizerRun(run.id, { error: error?.message || '每日整理失败。' }); } catch { /* keep the original error */ }
    }
    next(error);
  }
});

app.get('/api/assistant/threads', async (request, response, next) => {
  try {
    const { store, source } = await requestStateStore(request);
    response.json({ ok: true, source, threads: await store.listThreads(request.query.limit) });
  } catch (error) { next(error); }
});

app.get('/api/assistant/threads/:id', async (request, response, next) => {
  try {
    const { store, source } = await requestStateStore(request);
    const thread = await store.getThreadMessages(stringValue(request.params.id, 80), request.query.limit);
    if (!thread) return response.status(404).json({ error: '未找到这段对话。' });
    response.json({ ok: true, source, thread });
  } catch (error) { next(error); }
});

app.patch('/api/assistant/threads/:id', async (request, response, next) => {
  try {
    const { store, source } = await requestStateStore(request);
    const options = request.body?.conversation_options || request.body || {};
    const thread = await store.updateThreadOptions(stringValue(request.params.id, 80), options);
    if (!thread) return response.status(404).json({ error: '这段对话没有保存，因此没有可更新的对话设置。' });
    response.json({ ok: true, source, thread, state: await store.bootstrap() });
  } catch (error) { next(error); }
});

app.post('/api/assistant/threads', async (request, response, next) => {
  try {
    const { store, source } = await requestStateStore(request);
    const thread = await resolveConversationThread(store, request.body || {});
    response.status(201).json({ ok: true, source, thread });
  } catch (error) { next(error); }
});

app.post('/api/assistant/actions', async (request, response, next) => {
  try {
    const { store, source } = await requestStateStore(request);
    const body = request.body || {};
    const thread = await resolveConversationThread(store, body);
    const execution = await store.executeActions(normalizeActions(body.actions), {
      thread_id: thread.id,
      project_id: thread.project_id,
      task_id: stringValue(body.task_id, 80),
      allow_memory_distillation: thread.allow_memory_distillation,
      persist_action_log: thread.mode !== 'temporary' || thread.save_full_conversation
    });
    response.json({ ok: true, source, thread, ...execution, state: await store.bootstrap() });
  } catch (error) { next(error); }
});

app.post('/api/assistant/usage', async (request, response, next) => {
  try {
    if (!bridgeAuthorized(request, response)) return;
    const { store, source } = await requestStateStore(request);
    const appUsages = normalizeAppUsages(request.body?.app_usage || request.body);
    const deviceActivity = normalizeDeviceActivity(request.body?.device_activity);
    if (!appUsages.length && !deviceActivity) return response.status(400).json({ error: '需要有效的应用使用摘要或设备活动摘要。' });
    const records = [];
    for (const appUsage of appUsages) records.push(await store.recordAppUsage(appUsage));
    const sleepWake = deviceActivity ? await store.recordDeviceActivity(deviceActivity) : null;
    response.json({ ok: true, source, record: records[0] || null, records, deviceActivity, sleepWake, history: await store.appUsageHistory(30), state: await store.bootstrap() });
  } catch (error) { next(error); }
});

app.get('/api/assistant/usage', async (request, response, next) => {
  try {
    if (!bridgeAuthorized(request, response)) return;
    const { store, source } = await requestStateStore(request);
    response.json({ ok: true, source, history: await store.appUsageHistory(request.query.limit), sleepWake: await store.sleepWakeHistory(request.query.limit) });
  } catch (error) { next(error); }
});

app.patch('/api/assistant/sleep-wake/:id', async (request, response, next) => {
  try {
    const { store, source } = await requestStateStore(request);
    const status = stringValue(request.body?.status, 20);
    const event = await store.updateSleepWakeEvent(stringValue(request.params.id, 80), status, {
      sleep_at: request.body?.sleep_at,
      wake_at: request.body?.wake_at
    });
    if (!event) return response.status(404).json({ error: '未找到这条作息候选。' });
    response.json({ ok: true, source, event, state: await store.bootstrap() });
  } catch (error) { next(error); }
});

app.patch('/api/assistant/memories/:id', async (request, response, next) => {
  try {
    const { store, source } = await requestStateStore(request);
    const status = stringValue(request.body?.status, 40);
    const memory = await store.updateMemoryStatus(request.params.id, status, request.body?.content);
    if (!memory) return response.status(404).json({ error: '未找到这条记忆。' });
    let relativePath = null;
    if (memory.status === 'active') {
      relativePath = await createKnowledgeNote({
        title: '已确认记忆', body: memory.content, kind: 'note', source: 'personal-ai-executive-assistant'
      });
    }
    response.json({ ok: true, source, memory, relativePath, state: await store.bootstrap() });
  } catch (error) { next(error); }
});

app.post('/api/assistant/respond', async (request, response, next) => {
  try {
    if (!assistantAuthorized(request, response)) return;
    const { store, source } = await requestStateStore(request);
    const body = request.body || {};
    const message = stringValue(body.message, 4000);
    if (!message) return response.status(400).json({ error: '需要一条消息。' });
    const provider = selectAiProvider(
      aiProviderRegistry,
      body.provider_id || body.provider,
      body.model,
      aiModel,
      body.reasoning_effort || aiReasoningEffort
    );
    if (!provider) return response.status(503).json({ error: '尚未配置可用的 AI 提供商或模型。', code: 'AI_PROVIDER_NOT_CONFIGURED' });
    if (body.provider_id || body.provider || body.model || body.reasoning_effort) {
      await store.updateAiPreferences({
        provider_id: provider.id,
        model: provider.model,
        reasoning_effort: provider.reasoning_effort || ''
      });
    }

    const thread = await resolveConversationThread(store, body);
    const stateBefore = await store.bootstrap();
    const projectName = threadProjectName(thread, stateBefore);
    const hydratedThread = { ...thread, project_name: projectName };
    const userMessage = await store.appendMessage(hydratedThread, 'user', message);
    const storedConversation = userMessage
      ? (await store.recentMessages(hydratedThread.id, 16)).filter((entry) => entry.id !== userMessage.id)
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
      projectName: hydratedThread.mode === 'project' ? projectName : '',
      projectId: hydratedThread.mode === 'project' ? hydratedThread.project_id : '',
      query: message,
      state: stateBefore
    });
    const planBefore = stateBefore.plan;
    const appUsages = normalizeAppUsages(context.app_usage);
    const deviceActivity = normalizeDeviceActivity(context.device_activity);
    for (const appUsage of appUsages) await store.recordAppUsage(appUsage);
    if (deviceActivity) await store.recordDeviceActivity(deviceActivity);
    const stateWithUsage = deviceActivity || appUsages.length ? await store.bootstrap() : stateBefore;
    const usageHistory = [
      ...appUsages,
      ...(Array.isArray(stateWithUsage.app_usage_daily) ? stateWithUsage.app_usage_daily : [])
    ].slice(0, 30);
    const contextText = JSON.stringify({
      now: planBefore.now,
      conversation_mode: hydratedThread.mode,
      project: projectName || null,
      sleep_time: planBefore.sleep_time,
      wake_time: planBefore.wake_time,
      today_plan: planBefore.scheduled.slice(0, 12),
      current_task: planBefore.current_task,
      deferred_tasks: planBefore.deferred.slice(0, 8),
      app_usage: { current: appUsages, daily_history: usageHistory },
      sleep_wake_from_phone: stateWithUsage.sleep_wake_summary || null,
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
      project_name: projectName,
      conversation
    };
    async function finishAssistantResponse(result, degraded = false) {
      const execution = await store.executeActions(result.actions, {
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
      const pendingMemories = await store.addMemoryCandidates(result.memoryCandidates, hydratedThread);
      const assistantMessage = await store.appendMessage(hydratedThread, 'assistant', result.reply, execution.results);
      const transcriptPath = await appendConversationTranscript(hydratedThread, [
        { role: 'user', content: message }, { role: 'assistant', content: result.reply }
      ]);
      return response.json({
        ok: true, source, degraded, provider: provider.id, provider_name: provider.name, model: provider.model, thread: hydratedThread, reply: result.reply, actions: result.actions,
        toolCalls: result.actions.map((action) => ({ name: action.type, arguments: { ...action } })),
        actionResults: execution.results,
        toolResults: execution.results,
        memoryCandidates: result.memoryCandidates, pendingMemories, memoryRead: knowledge,
        appUsage: appUsages,
        plan: execution.plan, transcriptPath, messageIds: { user: userMessage?.id || null, assistant: assistantMessage?.id || null },
        state: await store.bootstrap()
      });
    }

    try {
      const { result, attempts } = await requestAssistantModel({
        provider,
        model: provider.model,
        temperature: 0.45,
        ...(provider.reasoning_effort ? { reasoning_effort: provider.reasoning_effort } : {}),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: assistantSystemPrompt() },
          { role: 'system', content: `当前对话模式为 ${hydratedThread.mode}，可使用的 Skill：\n${assistantSkillPrompt(hydratedThread.mode)}` },
          { role: 'system', content: `当前可用上下文（只使用其中真实内容）：${contextText}` },
          ...conversation,
          { role: 'user', content: message }
        ]
      });
      const normalizedResult = enforceUserIntent(result, message, intentContext);
      normalizedResult.retryCount = attempts - 1;
      return finishAssistantResponse(normalizedResult);
    } catch (error) {
      console.error('AI failed after retries', error?.message || 'unknown');
      return finishAssistantResponse(localFallbackResult(message, intentContext), true);
    }
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
  response.status(Number(error?.status) || 500).json({
    error: error?.message || '本地知识库桥接服务遇到错误。',
    ...(error?.code ? { code: error.code } : {})
  });
});

const androidApkPath = path.join(appRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
app.get('/download/forward.apk', (_request, response) => {
  if (!existsSync(androidApkPath)) return response.status(404).json({ error: 'Android 安装包尚未生成。' });
  response.download(androidApkPath, 'forward-0.2.0-debug.apk');
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
