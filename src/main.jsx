import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import {
  Bell, Bot, Brain, CalendarDays, Check, ChevronDown, ChevronRight, Circle,
  Clock3, Cloud, CloudOff, Command, FileText, Flame, FolderKanban, HeartPulse, ListChecks, LogIn, LogOut, Menu,
  MessageCircle, Image, Camera, MoreHorizontal, MoveRight, PenLine, Plus, RefreshCw, Send, Settings2,
  Sparkles, SunMedium, Target, X, Zap
} from 'lucide-react';
import './styles.css';

const appBasePath = String(import.meta.env.BASE_URL || '/').replace(/\/$/, '');
function appPath(path) {
  return `${appBasePath}${path}`;
}

const modes = [
  { id: 'daily_planning', icon: CalendarDays, label: '每日规划', description: '读取今日任务、时间、进度和复盘', defaultMemory: '今日计划、补考、近期复盘' },
  { id: 'assistant', icon: Sparkles, label: '普通助手', description: '了解你的长期目标和近期动态', defaultMemory: '长期目标与近期记录' },
  { id: 'project', icon: FolderKanban, label: '项目对话', description: '聚焦一个指定项目', defaultMemory: '补考项目' },
  { id: 'temporary', icon: MessageCircle, label: '临时聊天', description: '不读取知识库，也不沉淀长期内容', defaultMemory: '不读取长期记忆' }
];

function formatMinutes(value) {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  if (hour === 0) return `${minute} 分钟`;
  return minute ? `${hour} 小时 ${minute} 分钟` : `${hour} 小时`;
}

function timeNow() {
  const date = new Date();
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function messageTime(value) {
  if (!value) return timeNow();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? timeNow() : parsed.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function renderInlineMarkdown(value, keyPrefix) {
  const source = String(value || '');
  const tokens = /(`[^`\n]+`|\*\*[^*\n]+?\*\*|__[^_\n]+?__)/g;
  const children = [];
  let cursor = 0;
  let match;
  while ((match = tokens.exec(source))) {
    if (match.index > cursor) children.push(source.slice(cursor, match.index).replace(/\*\*|__/g, ''));
    const token = match[0];
    if (token.startsWith('`')) children.push(<code key={`${keyPrefix}-code-${match.index}`}>{token.slice(1, -1)}</code>);
    else children.push(<strong key={`${keyPrefix}-bold-${match.index}`}>{token.slice(2, -2)}</strong>);
    cursor = match.index + token.length;
  }
  if (cursor < source.length) children.push(source.slice(cursor).replace(/\*\*|__/g, ''));
  return children.length ? children : source.replace(/\*\*|__/g, '');
}

function renderAssistantMarkdown(value) {
  return String(value || '').split(/\r?\n/).map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return <div className="markdown-spacer" key={`blank-${index}`} />;
    const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (heading) return <div className="markdown-heading" key={`heading-${index}`}>{renderInlineMarkdown(heading[1], `heading-${index}`)}</div>;
    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bullet) return <div className="markdown-list-item" key={`bullet-${index}`}><span aria-hidden="true">•</span><span>{renderInlineMarkdown(bullet[1], `bullet-${index}`)}</span></div>;
    return <div className="markdown-line" key={`line-${index}`}>{renderInlineMarkdown(line, `line-${index}`)}</div>;
  });
}

function dateKicker() {
  return new Intl.DateTimeFormat('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
}

function isoToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function dynamicPlanToUi(dynamicPlan) {
  if (!dynamicPlan) return [];
  const normalizeParentId = (value) => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized && normalized.toLowerCase() !== 'null' && normalized.toLowerCase() !== 'undefined' ? normalized : null;
  };
  const executionIndex = new Map((dynamicPlan.scheduled || []).map((item, index) => [item.id, index]));
  const scheduled = (dynamicPlan.scheduled_display || dynamicPlan.scheduled || []).map((item) => {
    const parentTaskId = normalizeParentId(item.parent_task_id);
    return {
    id: item.id,
    start: item.start,
    end: item.end,
    title: item.title,
    project: item.project,
    parentTaskId,
    parentTitle: parentTaskId ? (item.parent_title || '') : '',
    isSubtask: Boolean(parentTaskId),
    tone: item.priority >= 5 ? 'urgent' : item.priority >= 3 ? 'work' : 'creative',
    displayOnly: item.display_only === true,
    state: item.display_only ? 'group' : item.id === dynamicPlan.current_task?.id ? 'current' : executionIndex.get(item.id) === 1 ? 'next' : 'planned',
    note: item.display_only
      ? `${item.child_count || 0} 项子任务 · ${item.notes || '父任务总览'}`
      : [item.long_task_id ? '长期' : '', item.due_at ? `截止 ${item.due_at.slice(5, 10)}` : '', item.notes || '按当前节奏推进'].filter(Boolean).join(' · '),
    duration: item.estimated_minutes
  }; });
  const deferred = (dynamicPlan.deferred || []).map((item) => {
    const parentTaskId = normalizeParentId(item.parent_task_id);
    return {
    id: item.id,
    start: '之后',
    end: '',
    title: item.title,
    project: item.project || '未归类',
    parentTaskId,
    parentTitle: parentTaskId ? (item.parent_title || '') : '',
    isSubtask: Boolean(parentTaskId),
    tone: 'creative',
    state: 'deferred',
    note: item.reason || '等待重新安排',
    duration: item.estimated_minutes || 45
  }; });
  const sleeping = (dynamicPlan.sleeping_tasks || []).map((item) => {
    const parentTaskId = normalizeParentId(item.parent_task_id);
    return {
      id: item.id,
      start: '睡眠',
      end: '',
      title: item.title,
      project: item.project || '未归类',
      parentTaskId,
      parentTitle: parentTaskId ? (item.parent_title || '') : '',
      isSubtask: Boolean(parentTaskId),
      tone: 'sleeping',
      displayOnly: item.display_only === true,
      state: item.display_only ? 'group' : 'sleeping',
      note: item.display_only
        ? `${item.child_count || 0} 项子任务 · ${item.notes || '父任务总览'}`
        : '睡眠时段不安排，起床后再继续',
      duration: item.estimated_minutes || 45
    };
  });
  return [...scheduled, ...sleeping, ...deferred];
}

function App() {
  const [plan, setPlan] = useState([]);
  const [planner, setPlanner] = useState(null);
  const [assistantState, setAssistantState] = useState(null);
  const [threadId, setThreadId] = useState(() => window.localStorage.getItem('forward.current.thread') || null);
  const [messages, setMessages] = useState([]);
  const [conversationMode, setConversationMode] = useState('daily_planning');
  const [projectId, setProjectId] = useState('');
  const [threads, setThreads] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [memoryRead, setMemoryRead] = useState([]);
  const [editingMemoryId, setEditingMemoryId] = useState(null);
  const [memoryDraft, setMemoryDraft] = useState('');
  const [showConversationOptions, setShowConversationOptions] = useState(false);
  const [showNewConversation, setShowNewConversation] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', type: 'one_off', estimated_minutes: '45', priority: '3', project_id: '', due_at: '', notes: '' });
  const [subtaskDraft, setSubtaskDraft] = useState(null);
  const [showLongTasks, setShowLongTasks] = useState(false);
  const [showNewLongTask, setShowNewLongTask] = useState(false);
  const [longTaskDraft, setLongTaskDraft] = useState({ title: '', daily_minutes: '45', priority: '3', project_id: '', due_at: '', notes: '' });
  const [showProjects, setShowProjects] = useState(false);
  const [showProjectDetail, setShowProjectDetail] = useState(false);
  const [projectDetailId, setProjectDetailId] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectDraft, setProjectDraft] = useState({ name: '', description: '', kind: 'project', priority: '3', due_at: '' });
  const [taskBusy, setTaskBusy] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [memoryScope, setMemoryScope] = useState(true);
  const [saveTranscript, setSaveTranscript] = useState(true);
  const [distillMemory, setDistillMemory] = useState(false);
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState([]);
  const [notice, setNotice] = useState('');
  const [notificationStatus, setNotificationStatus] = useState(
    'Notification' in window ? Notification.permission : 'unsupported'
  );
  const [now, setNow] = useState(timeNow());
  const [vault, setVault] = useState({ loading: true, connected: false, documentCount: 0, recentDocuments: [], folders: [] });
  const [vaultDocuments, setVaultDocuments] = useState([]);
  const [vaultError, setVaultError] = useState('');
  const [showVault, setShowVault] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [supabaseClient, setSupabaseClient] = useState(null);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState({ mode: 'checking', detail: '' });
  const [showAccount, setShowAccount] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [aiProviders, setAiProviders] = useState([]);
  const [selectedProviderId, setSelectedProviderId] = useState(() => window.localStorage.getItem('forward.ai.provider') || '');
  const [selectedModel, setSelectedModel] = useState(() => window.localStorage.getItem('forward.ai.model') || '');
  const [agentEngine, setAgentEngine] = useState(() => window.localStorage.getItem('forward.ai.agent') || 'legacy');
  const [memoryProviderId, setMemoryProviderId] = useState('');
  const [memoryModel, setMemoryModel] = useState('');
  const [memoryReasoningEffort, setMemoryReasoningEffort] = useState('');
  const [memoryAutoDaily, setMemoryAutoDaily] = useState(true);
  const [memoryDailyTime, setMemoryDailyTime] = useState('03:30');
  const [memoryStatus, setMemoryStatus] = useState(null);
  const [memoryRunBusy, setMemoryRunBusy] = useState(false);
  const [showSleepPlan, setShowSleepPlan] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerDraft, setProviderDraft] = useState({ name: '', base_url: '', api_key: '', api_mode: 'chat_completions', models: '', selected_model: '', reasoning_efforts: 'low, medium, high' });
  const [showAiSettings, setShowAiSettings] = useState(false);
  const endRef = useRef(null);
  const autoMemoryRunDateRef = useRef('');

  const mode = modes.find((item) => item.id === conversationMode) || modes[0];
  const projects = assistantState?.projects || [];
  const longTasks = assistantState?.long_tasks || [];
  const pendingMemories = (assistantState?.memory_items || []).filter((item) => item.status === 'pending_review');
  const project = projects.find((item) => item.id === projectId) || null;
  const projectDetail = projects.find((item) => item.id === projectDetailId) || null;
  const projectDetailTasks = useMemo(() => (assistantState?.tasks || [])
    .filter((task) => task.project_id === projectDetailId)
    .sort((a, b) => (Number(b.priority) - Number(a.priority)) || (Number(a.sort_order) - Number(b.sort_order))), [assistantState, projectDetailId]);
  const projectSummaries = useMemo(() => projects.map((item, index) => {
    const tasks = (assistantState?.tasks || []).filter((task) => task.project_id === item.id);
    const done = tasks.filter((task) => task.status === 'done').length;
    const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    const remainingMinutes = tasks.filter((task) => !['done', 'cancelled'].includes(task.status)).reduce((total, task) => total + (Number(task.estimated_minutes) || 0), 0);
    const dueDate = item.due_at ? new Date(item.due_at) : null;
    const daysLeft = dueDate && !Number.isNaN(dueDate.getTime()) ? Math.ceil((dueDate.getTime() - Date.now()) / 86400000) : null;
    return { ...item, color: ['coral', 'teal', 'violet', 'blue'][index % 4], progress, remainingMinutes, daysLeft, detail: `${tasks.filter((task) => ['open', 'in_progress', 'deferred'].includes(task.status)).length} 项待推进` };
  }), [assistantState, projects]);
  const leadProject = projectSummaries.filter((item) => item.status === 'active').sort((a, b) => (b.priority - a.priority) || ((a.daysLeft ?? 9999) - (b.daysLeft ?? 9999)))[0] || null;
  const current = plan.find((item) => item.state === 'current');
  const next = plan.find((item) => item.state === 'next' || item.state === 'planned');
  const planned = plan.filter((item) => !['done', 'deferred', 'cancelled'].includes(item.state));
  const scheduleMinutes = planned.reduce((total, item) => total + item.duration, 0);
  const flexible = plan.filter((item) => item.state === 'flex' || item.state === 'deferred');
  const selectedProvider = aiProviders.find((item) => item.id === selectedProviderId) || aiProviders[0] || null;
  const selectedMemoryProvider = aiProviders.find((item) => item.id === memoryProviderId) || selectedProvider || null;

  useEffect(() => {
    if (selectedProviderId) window.localStorage.setItem('forward.ai.provider', selectedProviderId);
    if (selectedModel) window.localStorage.setItem('forward.ai.model', selectedModel);
    if (agentEngine) window.localStorage.setItem('forward.ai.agent', agentEngine);
  }, [selectedProviderId, selectedModel, agentEngine]);

  async function apiFetch(path, options = {}, authentication = null) {
    const headers = new Headers(options.headers || {});
    const includeAuthentication = authentication === true || (authentication !== false && syncStatus.mode === 'cloud');
    if (session?.access_token && includeAuthentication) {
      headers.set('Authorization', `Bearer ${session.access_token}`);
    }
    return fetch(appPath(path), { ...options, headers });
  }

  async function loadAssistantState(forceAuthentication = false) {
    try {
      const response = await apiFetch('/api/assistant/state', {}, forceAuthentication);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '读取计划失败');
      applyAssistantData(payload);
      const preferences = payload.state?.ai_preferences;
      if (preferences?.provider_id) setSelectedProviderId(preferences.provider_id);
      if (preferences?.model) setSelectedModel(preferences.model);
      if (preferences?.agent_engine) setAgentEngine(preferences.agent_engine);
      if (preferences?.memory_provider_id) setMemoryProviderId(preferences.memory_provider_id);
      if (preferences?.memory_model) setMemoryModel(preferences.memory_model);
      if (preferences?.memory_reasoning_effort !== undefined) setMemoryReasoningEffort(preferences.memory_reasoning_effort || '');
      if (typeof preferences?.memory_auto_daily === 'boolean') setMemoryAutoDaily(preferences.memory_auto_daily);
      if (preferences?.memory_daily_time) setMemoryDailyTime(preferences.memory_daily_time);
      if (typeof payload.state?.settings?.show_sleep_plan === 'boolean') setShowSleepPlan(payload.state.settings.show_sleep_plan);
      const firstProject = payload.state?.projects?.[0];
      if (firstProject && !projectId) setProjectId(firstProject.id);
    } catch (error) {
      setNotice(error.message || '计划数据暂时没有连接');
    }
  }

  async function loadThreads(forceAuthentication = false, restoreLatest = false) {
    try {
      const response = await apiFetch('/api/assistant/threads', {}, forceAuthentication);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '读取对话历史失败');
      const nextThreads = payload.threads || [];
      setThreads(nextThreads);
      if (restoreLatest) {
        const savedThreadId = window.localStorage.getItem('forward.current.thread');
        const resumeId = savedThreadId && nextThreads.some((item) => item.id === savedThreadId)
          ? savedThreadId
          : (!threadId ? nextThreads[0]?.id : null);
        if (resumeId) await openThread(resumeId, forceAuthentication);
      }
    } catch (error) {
      setNotice(error.message || '读取对话历史失败');
    }
  }

  async function loadAiProviders() {
    try {
      const response = await apiFetch('/api/assistant/providers');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '读取 AI 提供商失败');
      const providers = payload.providers || [];
      setAiProviders(providers);
      const active = providers.find((item) => item.active) || providers[0];
      setSelectedProviderId((current) => current || active?.id || '');
      setSelectedModel((current) => current || active?.selected_model || active?.models?.[0] || '');
      setMemoryProviderId((current) => current || active?.id || '');
      setMemoryModel((current) => current || active?.selected_model || active?.models?.[0] || '');
    } catch (error) {
      setNotice(error.message || 'AI 提供商暂时不可用');
    }
  }

  async function loadMemoryStatus() {
    try {
      const response = await apiFetch('/api/assistant/memory/status');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '读取记忆整理状态失败');
      setMemoryStatus(payload);
      return payload;
    } catch (error) {
      setNotice(error.message || '读取记忆整理状态失败');
      return null;
    }
  }

  async function saveAiPreferences(close = false) {
    const response = await apiFetch('/api/assistant/preferences', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider_id: selectedProviderId, model: selectedModel,
        agent_engine: agentEngine,
        memory_provider_id: memoryProviderId || selectedProviderId,
        memory_model: memoryModel || selectedModel,
        memory_reasoning_effort: memoryReasoningEffort,
        memory_auto_daily: memoryAutoDaily,
        memory_daily_time: memoryDailyTime
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '保存失败');
    if (payload.state) setAssistantState(payload.state);
    if (typeof payload.state?.settings?.show_sleep_plan === 'boolean') setShowSleepPlan(payload.state.settings.show_sleep_plan);
    if (close) setShowAiSettings(false);
    return payload;
  }

  async function updateSleepPlanVisibility(visible) {
    setShowSleepPlan(visible);
    try {
      const response = await apiFetch('/api/assistant/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: threadId,
          conversation_mode: conversationMode,
          actions: [{ type: 'set_sleep_plan_visibility', visible, reason: '用户调整睡眠时段计划显示' }]
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '睡眠时段显示设置保存失败');
      applyAssistantData(payload);
    } catch (error) {
      setShowSleepPlan(!visible);
      setNotice(error.message || '睡眠时段显示设置保存失败');
    }
  }

  async function runDailyMemory({ silent = false } = {}) {
    if (memoryRunBusy) return null;
    setMemoryRunBusy(true);
    try {
      const response = await apiFetch('/api/assistant/memory/daily-run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_id: memoryProviderId || selectedProviderId,
          model: memoryModel || selectedModel,
          reasoning_effort: memoryReasoningEffort
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '每日整理失败');
      if (payload.state) setAssistantState(payload.state);
      setMemoryStatus((current) => ({ ...(current || {}), latest_run: payload.run, summary: payload.summary || current?.summary || null }));
      if (!silent) {
        setNotice(payload.empty ? '今天还没有可整理的已保存对话。' : `已完成今日整理：新增 ${payload.created?.length || 0} 条待确认记忆。`);
      }
      return payload;
    } catch (error) {
      if (!silent) setNotice(error.message || '每日整理失败');
      return null;
    } finally {
      setMemoryRunBusy(false);
    }
  }

  async function addProvider() {
    setProviderBusy(true);
    try {
      const response = await apiFetch('/api/assistant/providers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...providerDraft,
          models: providerDraft.models.split(/[\n,，]/g).map((value) => value.trim()).filter(Boolean),
          reasoning_efforts: providerDraft.reasoning_efforts.split(/[\n,，]/g).map((value) => value.trim()).filter(Boolean)
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '新增中转站失败');
      setAiProviders(payload.providers || []);
      const provider = payload.provider;
      if (provider) {
        setSelectedProviderId(provider.id);
        setSelectedModel(provider.selected_model || provider.models?.[0] || '');
        setMemoryProviderId(provider.id);
        setMemoryModel(provider.selected_model || provider.models?.[0] || '');
      }
      setProviderDraft({ name: '', base_url: '', api_key: '', api_mode: 'chat_completions', models: '', selected_model: '', reasoning_efforts: 'low, medium, high' });
      setNotice(`已加入中转站：${provider?.name || '新配置'}。`);
    } catch (error) {
      setNotice(error.message || '新增中转站失败');
    } finally {
      setProviderBusy(false);
    }
  }

  async function testProvider(providerId, model, reasoningEffort = '') {
    setProviderBusy(true);
    try {
      const response = await apiFetch(`/api/assistant/providers/${encodeURIComponent(providerId)}/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, reasoning_effort: reasoningEffort })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '连接测试失败');
      setNotice(`连接正常：${payload.provider_name} · ${payload.model}`);
    } catch (error) {
      setNotice(error.message || '连接测试失败');
    } finally {
      setProviderBusy(false);
    }
  }

  async function exportMemoryArchive() {
    try {
      const response = await apiFetch('/api/assistant/memory/export');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '导出记忆档案失败');
      const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = `forward-memory-archive-${isoToday()}.json`;
      link.click();
      URL.revokeObjectURL(href);
      setNotice('已导出原始对话与记忆档案，可保存到你的本地备份目录。');
    } catch (error) {
      setNotice(error.message || '导出记忆档案失败');
    }
  }

  async function refreshSync(nextSession = session) {
    if (!nextSession?.access_token) {
      setSyncStatus({ mode: 'local', detail: '未登录，本机数据仍可使用' });
      await Promise.all([loadAssistantState(false), loadThreads(false, true)]);
      return;
    }
    setSyncStatus({ mode: 'checking', detail: '正在检查云端数据' });
    try {
      const response = await apiFetch('/api/assistant/sync/status', {}, true);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '检查同步状态失败');
      if (payload.snapshot?.exists) {
        setSyncStatus({ mode: 'cloud', detail: payload.snapshot.updatedAt ? `上次同步 ${messageTime(payload.snapshot.updatedAt)}` : '云端数据已连接' });
        await Promise.all([loadAssistantState(true), loadThreads(true, true)]);
      } else {
        setSyncStatus({ mode: 'needs_import', detail: '云端尚无数据，等待你确认首次上传' });
        await Promise.all([loadAssistantState(false), loadThreads(false, true)]);
      }
    } catch (error) {
      setSyncStatus({ mode: 'error', detail: error.message || '同步服务未连接' });
      await Promise.all([loadAssistantState(false), loadThreads(false, true)]);
    }
  }

  useEffect(() => {
    const id = window.setInterval(() => setNow(timeNow()), 30000);
    return () => window.clearInterval(id);
  }, []);

  function applyAssistantData(payload) {
    const dynamicPlan = payload.plan || payload.state?.plan;
    if (dynamicPlan) {
      setPlanner(dynamicPlan);
      setPlan(dynamicPlanToUi(dynamicPlan));
    }
    if (payload.thread?.id) {
      setThreadId(payload.thread.id);
      window.localStorage.setItem('forward.current.thread', payload.thread.id);
    }
    if (payload.state) setAssistantState(payload.state);
    if (Array.isArray(payload.memoryRead)) setMemoryRead(payload.memoryRead);
  }

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    async function initializeAuthentication() {
      try {
        const response = await fetch(appPath('/api/auth/config'));
        const config = await response.json();
        if (!response.ok || !config.configured) {
          if (active) setSyncStatus({ mode: 'unavailable', detail: 'Supabase 尚未配置，本机模式可继续使用' });
          return;
        }
        const client = createClient(config.url, config.anonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
        if (!active) return;
        setSupabaseClient(client);
        const { data } = await client.auth.getSession();
        if (active) setSession(data.session || null);
        const listener = client.auth.onAuthStateChange((_event, nextSession) => {
          if (active) setSession(nextSession || null);
        });
        unsubscribe = () => listener.data.subscription.unsubscribe();
      } catch (error) {
        if (active) setSyncStatus({ mode: 'error', detail: 'Supabase 配置读取失败，本机模式可继续使用' });
      } finally {
        if (active) setAuthReady(true);
      }
    }
    initializeAuthentication();
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!authReady) return;
    refreshSync(session);
    loadAiProviders();
  }, [authReady, session]);

  useEffect(() => {
    if (!assistantState || !memoryAutoDaily || memoryRunBusy) return;
    const today = isoToday();
    if (autoMemoryRunDateRef.current === today || timeNow() < memoryDailyTime) return;
    let active = true;
    async function catchUpDailyMemory() {
      const status = await loadMemoryStatus();
      if (!active || !status || status.raw_message_count < 1 || status.summary || status.latest_run?.date === today) return;
      autoMemoryRunDateRef.current = today;
      await runDailyMemory({ silent: true });
    }
    catchUpDailyMemory();
    return () => { active = false; };
  }, [assistantState?.updated_at, memoryAutoDaily, memoryDailyTime, memoryRunBusy]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register(appPath('/sw.js'), { scope: `${appBasePath || ''}/` }).catch(() => {});
  }, []);

  async function loadVault(includeDocuments = false) {
    try {
      setVaultError('');
      const requests = [fetch(appPath('/api/vault/status'))];
      if (includeDocuments) requests.push(fetch(appPath('/api/vault/documents')));
      const responses = await Promise.all(requests);
      const status = await responses[0].json();
      if (!responses[0].ok) throw new Error(status.error || '知识库未连接');
      setVault({ ...status, loading: false });
      if (includeDocuments) {
        const documentPayload = await responses[1].json();
        if (!responses[1].ok) throw new Error(documentPayload.error || '读取知识库失败');
        setVaultDocuments(documentPayload.documents || []);
      }
    } catch (error) {
      setVault((current) => ({ ...current, loading: false, connected: false }));
      setVaultError(error.message || '知识库桥接服务尚未启动');
    }
  }

  useEffect(() => {
    loadVault();
    const events = new EventSource(appPath('/api/vault/events'));
    events.addEventListener('vault-change', () => loadVault(showVault));
    events.onerror = () => events.close();
    return () => events.close();
  }, [showVault]);

  async function openVault() {
    setShowVault(true);
    await loadVault(true);
  }

  async function openDocument(id) {
    try {
      const response = await fetch(appPath(`/api/vault/documents/${id}`));
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '无法读取文档');
      setSelectedDocument(payload.document);
    } catch (error) {
      setVaultError(error.message || '读取文档失败');
    }
  }

  async function updateMemory(memory, status, content = memory.content) {
    try {
      const response = await apiFetch(`/api/assistant/memories/${memory.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          content
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '更新记忆失败');
      applyAssistantData(payload);
      setEditingMemoryId(null);
      setMemoryDraft('');
      setNotice(status === 'active' ? `已确认并写入知识库：${payload.relativePath}` : '这条记忆已忽略');
      await loadVault(showVault);
    } catch (error) {
      setNotice(error.message || '更新记忆失败');
    }
  }

  function addAssistant(text) {
    setMessages((items) => [...items, { id: Date.now() + 1, role: 'assistant', time: timeNow(), text }]);
  }

  async function markCurrentDone() {
    if (!current || aiBusy) return;
    setAiBusy(true);
    try {
      const response = await apiFetch('/api/assistant/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: threadId,
          task_id: current.id,
          conversation_mode: conversationMode,
          actions: [{ type: 'complete_current_task', reason: '用户点击完成当前任务' }]
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '任务完成操作失败');
      applyAssistantData(payload);
      loadThreads();
      const result = payload.results?.find((item) => item.ok);
      setNotice(result?.reason || '任务已完成，计划已重新安排');
      addAssistant(result?.title ? `已记下「${result.title}」完成，我已按今天的剩余时间更新后续安排。` : '任务已完成，我已更新今天后续安排。');
    } catch (error) {
      setNotice(error.message || '任务操作失败');
    } finally {
      setAiBusy(false);
    }
  }

  async function createTaskManually(event) {
    event.preventDefault();
    const title = newTask.title.trim();
    if (!title || taskBusy) return;
    setTaskBusy(true);
    try {
      const selectedProject = projects.find((item) => item.id === newTask.project_id);
      const isLong = newTask.type === 'long';
      const response = await apiFetch('/api/assistant/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: threadId,
          conversation_mode: conversationMode,
          project_id: newTask.project_id || projectId,
          conversation_options: { memory_scope: memoryScope, save_full_conversation: saveTranscript, allow_memory_distillation: distillMemory },
          actions: [{
            type: isLong ? 'create_long_task' : 'create_task', title,
            estimated_minutes: Number(newTask.estimated_minutes) || 45,
            daily_minutes: Number(newTask.estimated_minutes) || 45,
            priority: Number(newTask.priority) || 3,
            project: selectedProject?.name || undefined,
            due_at: newTask.due_at ? new Date(newTask.due_at).toISOString() : undefined,
            reason: newTask.notes.trim()
          }]
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '新建任务失败');
      applyAssistantData(payload);
      setNewTask({ title: '', type: 'one_off', estimated_minutes: '45', priority: '3', project_id: '', due_at: '', notes: '' });
      setShowNewTask(false);
      loadThreads();
    } catch (error) {
      setNotice(error.message || '新建任务失败');
    } finally {
      setTaskBusy(false);
    }
  }

  async function createSubtaskManually(event) {
    event.preventDefault();
    const parent = subtaskDraft?.parent;
    const title = subtaskDraft?.title?.trim();
    if (!parent?.id || !title || taskBusy) return;
    setTaskBusy(true);
    try {
      const response = await apiFetch('/api/assistant/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: threadId,
          conversation_mode: conversationMode,
          conversation_options: { memory_scope: memoryScope, save_full_conversation: saveTranscript, allow_memory_distillation: distillMemory },
          actions: [{
            type: 'create_subtask', title, parent_task_id: parent.id,
            estimated_minutes: Number(subtaskDraft.estimated_minutes) || 30,
            priority: Number(subtaskDraft.priority) || 3,
            reason: subtaskDraft.notes.trim()
          }]
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '新建子任务失败');
      const result = payload.results?.find((item) => item.type === 'create_subtask');
      if (result && !result.ok) throw new Error(result.reason || '新建子任务失败');
      applyAssistantData(payload);
      setSubtaskDraft(null);
      setNotice('子任务已加入父任务。');
      loadThreads();
    } catch (error) {
      setNotice(error.message || '新建子任务失败');
    } finally {
      setTaskBusy(false);
    }
  }

  async function createProjectManually(event) {
    event.preventDefault();
    const name = projectDraft.name.trim();
    if (!name || taskBusy) return;
    setTaskBusy(true);
    try {
      const response = await apiFetch('/api/assistant/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...projectDraft, name, priority: Number(projectDraft.priority) || 3, due_at: projectDraft.due_at ? new Date(projectDraft.due_at).toISOString() : null })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '新建项目失败');
      applyAssistantData(payload);
      setProjectDraft({ name: '', description: '', kind: 'project', priority: '3', due_at: '' });
      setShowNewProject(false);
      setNotice('目标或项目已创建。');
    } catch (error) { setNotice(error.message || '新建项目失败'); }
    finally { setTaskBusy(false); }
  }

  async function createLongTaskManually(event) {
    event.preventDefault();
    const title = longTaskDraft.title.trim();
    if (!title || taskBusy) return;
    setTaskBusy(true);
    try {
      const response = await apiFetch('/api/assistant/long-tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          daily_minutes: Number(longTaskDraft.daily_minutes) || 45,
          priority: Number(longTaskDraft.priority) || 3,
          project_id: longTaskDraft.project_id || projectId || null,
          due_at: longTaskDraft.due_at ? new Date(longTaskDraft.due_at).toISOString() : null,
          notes: longTaskDraft.notes.trim()
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '新建长期任务失败');
      applyAssistantData(payload);
      setLongTaskDraft({ title: '', daily_minutes: '45', priority: '3', project_id: '', due_at: '', notes: '' });
      setShowNewLongTask(false);
      setNotice('长期任务已创建，今天的执行项已加入动态计划。');
    } catch (error) {
      setNotice(error.message || '新建长期任务失败');
    } finally {
      setTaskBusy(false);
    }
  }

  async function toggleLongTask(task) {
    if (taskBusy) return;
    setTaskBusy(true);
    try {
      const nextStatus = task.status === 'active' ? 'paused' : 'active';
      const response = await apiFetch(`/api/assistant/long-tasks/${encodeURIComponent(task.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '更新长期任务失败');
      applyAssistantData(payload);
    } catch (error) {
      setNotice(error.message || '更新长期任务失败');
    } finally {
      setTaskBusy(false);
    }
  }

  async function handleUserMessage(text, attachments = []) {
    setAiBusy(true);
    try {
      const response = await apiFetch('/api/assistant/respond', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          attachments,
          thread_id: threadId,
          conversation_mode: conversationMode,
          project_id: projectId,
          conversation_options: {
            memory_scope: memoryScope,
            save_full_conversation: saveTranscript,
            allow_memory_distillation: distillMemory
          },
          context: { current_task_id: current?.id || null },
          provider_id: selectedProviderId || undefined,
          model: selectedModel || undefined,
          agent_engine: agentEngine || 'legacy'
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'AI 请求失败');
      applyAssistantData(payload);
      addAssistant(payload.reply || '我已更新计划。');
      loadThreads();
      const applied = (payload.actionResults || []).filter((item) => item.ok);
      setNotice(applied.length ? applied.map((item) => item.reason).join(' ') : (payload.plan?.adjustment_reason || '已保存本轮对话。'));
    } catch (error) {
      setNotice(error.message || 'AI 连接暂时不可用');
      addAssistant('这次没有成功写入计划。我保留了你的消息，稍后重试时会继续处理。');
    } finally {
      setAiBusy(false);
    }
  }

  function submitMessage(event) {
    event.preventDefault();
    const text = input.trim();
    if (!text && pendingImages.length === 0) return;
    const attachments = pendingImages.map((item) => ({ name: item.name, type: item.type, data_url: item.dataUrl }));
    setMessages((items) => [...items, { id: Date.now(), role: 'user', time: timeNow(), text, attachments }]);
    setInput('');
    setPendingImages([]);
    handleUserMessage(text || '请查看我上传的图片。', attachments);
  }

  function addImages(event) {
    const files = Array.from(event.target.files || [])
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, Math.max(0, 4 - pendingImages.length));
    files.forEach((file) => { const reader = new FileReader(); reader.onload = () => setPendingImages((items) => [...items, { name: file.name, type: file.type, dataUrl: reader.result }]); reader.readAsDataURL(file); });
    event.target.value = '';
  }

  function conversationDefaults(selected) {
    return selected === 'temporary'
      ? { memory_scope: false, save_full_conversation: false, allow_memory_distillation: false }
      : { memory_scope: true, save_full_conversation: true, allow_memory_distillation: false };
  }

  async function selectMode(selected, selectedProjectId = projectId) {
    const options = conversationDefaults(selected);
    setConversationMode(selected);
    setProjectId(selectedProjectId || projects[0]?.id || '');
    setMemoryScope(options.memory_scope);
    setSaveTranscript(options.save_full_conversation);
    setDistillMemory(options.allow_memory_distillation);
    setMessages([]);
    setMemoryRead([]);
    setThreadId(null);
    window.localStorage.removeItem('forward.current.thread');
    setShowNewConversation(false);
    setShowConversationOptions(false);
    try {
      const response = await apiFetch('/api/assistant/threads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_mode: selected,
          project_id: selectedProjectId || projects[0]?.id || '',
          conversation_options: options
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '创建新对话失败');
      setThreadId(payload.thread?.id || null);
      if (payload.thread?.id) window.localStorage.setItem('forward.current.thread', payload.thread.id);
      setNotice(selected === 'temporary' ? '已打开临时聊天，本次不会读取或沉淀长期内容。' : '已打开新对话。');
      loadThreads();
    } catch (error) {
      setNotice(error.message || '创建新对话失败');
    }
  }

  async function openThread(id, forceAuthentication = false) {
    try {
      const response = await apiFetch(`/api/assistant/threads/${id}`, {}, forceAuthentication);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '读取对话失败');
      const thread = payload.thread;
      setThreadId(thread.id);
      window.localStorage.setItem('forward.current.thread', thread.id);
      setConversationMode(thread.mode);
      setProjectId(thread.project_id || '');
      setMemoryScope(Boolean(thread.memory_scope));
      setSaveTranscript(Boolean(thread.save_full_conversation));
      setDistillMemory(Boolean(thread.allow_memory_distillation));
      setMessages((thread.messages || []).map((message) => ({
        id: message.id,
        role: message.role,
        time: messageTime(message.created_at),
        text: message.content,
        attachments: Array.isArray(message.attachments) ? message.attachments : []
      })));
      setShowHistory(false);
      setNotice('已恢复这段对话及其上下文。');
    } catch (error) {
      setNotice(error.message || '读取对话失败');
    }
  }

  async function updateConversationOptions(nextOptions) {
    if (Object.hasOwn(nextOptions, 'memory_scope')) setMemoryScope(nextOptions.memory_scope);
    if (Object.hasOwn(nextOptions, 'save_full_conversation')) setSaveTranscript(nextOptions.save_full_conversation);
    if (Object.hasOwn(nextOptions, 'allow_memory_distillation')) setDistillMemory(nextOptions.allow_memory_distillation);
    if (!threadId || conversationMode === 'temporary') return;
    try {
      const response = await apiFetch(`/api/assistant/threads/${threadId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_options: nextOptions })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '更新对话设置失败');
      applyAssistantData(payload);
      loadThreads();
    } catch (error) {
      setNotice(error.message || '更新对话设置失败');
    }
  }

  async function submitAuthentication(event) {
    event.preventDefault();
    if (!supabaseClient || authBusy) return;
    setAuthBusy(true);
    try {
      const normalizedEmail = email.trim();
      if (!normalizedEmail || password.length < 6) throw new Error('请输入邮箱和至少 6 位密码。');
      const result = authMode === 'register'
        ? await supabaseClient.auth.signUp({ email: normalizedEmail, password, options: { emailRedirectTo: window.location.origin } })
        : await supabaseClient.auth.signInWithPassword({ email: normalizedEmail, password });
      if (result.error) throw result.error;
      if (result.data.session) {
        setSession(result.data.session);
        setShowAccount(false);
        setNotice('登录成功，正在检查你的云端数据。');
      } else {
        setNotice('注册成功，请先在邮箱中确认账号，然后返回这里登录。');
        setAuthMode('login');
      }
    } catch (error) {
      setNotice(error.message || '登录失败，请检查邮箱、密码和 Supabase 配置。');
    } finally {
      setAuthBusy(false);
    }
  }

  async function initializeCloudSync() {
    if (!session?.access_token || authBusy) return;
    setAuthBusy(true);
    try {
      const response = await apiFetch('/api/assistant/sync/initialize', { method: 'POST' }, true);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '首次同步失败');
      setSyncStatus({ mode: 'cloud', detail: '本机数据已同步到云端' });
      applyAssistantData(payload);
      await loadThreads(true);
      setNotice('本机的任务、计划、对话、记忆和作息已上传到云端。');
      setShowAccount(false);
    } catch (error) {
      setNotice(error.message || '首次同步失败');
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    if (!supabaseClient) return;
    setAuthBusy(true);
    try {
      const { error } = await supabaseClient.auth.signOut();
      if (error) throw error;
      setSession(null);
      setShowAccount(false);
      setNotice('已退出云端账号，当前回到本机模式。');
    } catch (error) {
      setNotice(error.message || '退出登录失败');
    } finally {
      setAuthBusy(false);
    }
  }

  async function requestNotifications() {
    if (!('Notification' in window)) {
      setNotice('此浏览器暂不支持通知权限');
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationStatus(permission);
    if (permission === 'granted') {
      setNotice('提醒已开启：可在安卓浏览器安装 PWA 后收到计划提醒');
      setTimeout(() => sendTestNotification(), 650);
    } else {
      setNotice('通知未开启，计划仍会在应用内显示');
    }
  }

  async function sendTestNotification() {
    const message = { type: 'SHOW_REMINDER', title: '向前 · 计划提醒', body: '10:30 开始高数错题回顾，预计 50 分钟。' };
    const registration = await navigator.serviceWorker?.ready;
    if (registration?.active) registration.active.postMessage(message);
    else new Notification(message.title, { body: message.body });
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${showSidebar ? 'is-open' : ''}`} aria-label="主导航">
        <div className="brand-row">
          <div className="brand-mark"><MoveRight size={20} strokeWidth={2.4} /></div>
          <div><strong>向前</strong><span>你的执行助手</span></div>
          <button className="icon-button sidebar-close" onClick={() => setShowSidebar(false)} aria-label="关闭导航"><X size={20} /></button>
        </div>
        <button className="new-chat" onClick={() => setShowNewConversation(true)}><Plus size={18} /> 新建对话 <span>⌘ K</span></button>
        <nav className="nav-list">
          <button className="nav-item is-active"><SunMedium size={18} /> 今天 <span className="nav-dot" /></button>
          <button className="nav-item" onClick={() => setShowHistory(true)}><MessageCircle size={18} /> 所有对话</button>
          <button className="nav-item" onClick={openVault}><Brain size={18} /> 记忆库 <span className={`vault-dot ${vault.connected ? 'connected' : ''}`} /></button>
        </nav>
        <div className="side-section">
          <div className="side-label"><button className="side-label-link" onClick={() => setShowProjects(true)}>目标与项目</button> <button aria-label="添加项目" onClick={() => setShowNewProject(true)}><Plus size={15} /></button></div>
          {projectSummaries.map((item) => (
            <button className="project-link" key={item.id} onClick={() => selectMode('project', item.id)}>
              <span className={`project-dot ${item.color}`} /> <span>{item.name}</span><small>{item.progress}%</small>
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <button className="profile" onClick={() => setShowAccount(true)}><span>{session?.user?.email ? session.user.email.slice(0, 1).toUpperCase() : 'JC'}</span><div><strong>{session?.user?.email || '九菜'}</strong><small>{syncStatus.mode === 'cloud' ? '云端同步中' : '本机模式'}</small></div>{syncStatus.mode === 'cloud' ? <Cloud size={18} /> : <MoreHorizontal size={18} />}</button>
        </div>
      </aside>
      {showSidebar && <button className="sidebar-backdrop" onClick={() => setShowSidebar(false)} aria-label="关闭导航" />}

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button menu-button" onClick={() => setShowSidebar(true)} aria-label="打开导航"><Menu size={21} /></button>
            <div className="crumb"><span>今天</span><ChevronRight size={14} /><strong>每日规划</strong></div>
            <button className="mode-trigger" onClick={() => setShowConversationOptions((value) => !value)}>
              <mode.icon size={16} /> {mode.label} <ChevronDown size={14} />
            </button>
          </div>
          <div className="topbar-right">
            <button className={`notify-button ${notificationStatus === 'granted' ? 'enabled' : ''}`} onClick={notificationStatus === 'granted' ? sendTestNotification : requestNotifications}>
              <Bell size={16} /> <span>{notificationStatus === 'granted' ? '提醒已开启' : '开启提醒'}</span>
            </button>
            <button className="icon-button" onClick={() => setShowAiSettings(true)} aria-label="AI 设置"><Settings2 size={19} /></button>
          </div>
          {showConversationOptions && (
            <section className="conversation-popover">
              <div className="popover-title">本次对话</div>
              <div className="mode-grid">
                {modes.map((item) => {
                  const Icon = item.icon;
                  return <button key={item.id} className={`mode-option ${conversationMode === item.id ? 'selected' : ''}`} onClick={() => selectMode(item.id, projectId)}><Icon size={17} /><span><strong>{item.label}</strong><small>{item.description}</small></span>{conversationMode === item.id && <Check size={16} />}</button>;
                })}
              </div>
              {conversationMode === 'project' && <label className="inline-select"><span>聚焦项目</span><select value={projectId} onChange={(event) => selectMode('project', event.target.value)}>{projectSummaries.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
              <div className="control-divider" />
              <label className="setting-row"><span><strong>读取记忆</strong><small>{mode.defaultMemory}</small></span><input type="checkbox" checked={memoryScope} onChange={(event) => updateConversationOptions({ memory_scope: event.target.checked })} /></label>
              <label className="setting-row"><span><strong>保存完整对话</strong><small>可随时从历史删除</small></span><input type="checkbox" checked={saveTranscript} onChange={(event) => updateConversationOptions({ save_full_conversation: event.target.checked })} /></label>
              <label className="setting-row"><span><strong>沉淀长期记忆</strong><small>提取后等待你确认</small></span><input type="checkbox" checked={distillMemory} onChange={(event) => updateConversationOptions({ allow_memory_distillation: event.target.checked })} /></label>
            </section>
          )}
        </header>

        <section className="content-layout">
          <div className="chat-column">
            <section className="day-intro">
              <div className="date-kicker"><span className="pulse-dot" /> {dateKicker()}</div>
              {leadProject && <button className="lead-project-card" onClick={() => { setProjectDetailId(leadProject.id); setShowProjectDetail(true); }}><span className={`project-dot ${leadProject.color}`} /><span><small>当前主线 · {leadProject.kind === 'goal' ? '目标' : '项目'}</small><strong>{leadProject.name}</strong><em>{leadProject.daysLeft === null ? '持续推进' : leadProject.daysLeft < 0 ? '已逾期' : `还有 ${leadProject.daysLeft} 天`} · 完成 {leadProject.progress}%</em></span><ChevronRight size={17} /></button>}
              <div className="day-heading-row"><h1>今天，先把最重要的事做下去。</h1><span className="day-heading-actions"><button className="new-task-button" type="button" onClick={() => setShowNewTask(true)}><Plus size={16} /> 新建任务</button></span></div>
              <p>{planner?.is_sleeping ? <>现在 <strong>{planner?.now?.slice(-5) || now}</strong> · 正在睡眠时段 · <strong>{planner?.sleep_window?.end?.time || planner?.wake_time}</strong> 后恢复安排</> : <>现在 <strong>{planner?.now?.slice(-5) || now}</strong> · 可自主调整 <strong>{planner ? formatMinutes(planner.free_minutes) : '加载中'}</strong> · 已安排 <strong>{planner ? formatMinutes(planner.scheduled_minutes) : formatMinutes(scheduleMinutes)}</strong></>}</p>
            </section>

            <section className="mobile-plan" aria-label="今日计划概览">
              <div className="mobile-plan-title"><span>今日动态计划</span><span>{planner?.now?.slice(-5) || now}</span></div>
              <div className="current-compact"><span className="current-indicator" /><div><small>当前任务</small><strong>{current?.title || '暂时没有安排'}</strong></div>{current && <button onClick={markCurrentDone} aria-label="完成当前任务"><Check size={18} /></button>}</div>
              <div className="compact-next"><span>下一件事</span><strong>{next ? `${next.start} · ${next.title}` : '暂无'}</strong></div>
            </section>

            <div className="conversation-stream">
              <div className="unread-marker"><span>今天</span></div>
              {messages.map((message) => (
                <article className={`message ${message.role}`} key={message.id}>
                  {message.role === 'assistant' && <div className="message-avatar"><Bot size={16} /></div>}
                  <div><div className="message-meta">{message.role === 'assistant' ? '向前' : '你'} <time>{message.time}</time></div>{message.text && (message.role === 'assistant' ? <div className="message-markdown">{renderAssistantMarkdown(message.text)}</div> : <p>{message.text}</p>)}{message.attachments?.map((image) => <img className="message-image" key={image.data_url} src={image.data_url} alt={image.name || '上传图片'} />)}</div>
                </article>
              ))}
              {notice && <div className="change-note"><Sparkles size={15} /><span>{notice}</span></div>}
              <div ref={endRef} />
            </div>

            <form className="composer" onSubmit={submitMessage}>
              {pendingImages.length > 0 && <div className="pending-images">{pendingImages.map((image) => <div className="pending-image" key={image.dataUrl}><img src={image.dataUrl} alt={image.name} /><button type="button" onClick={() => setPendingImages((items) => items.filter((item) => item.dataUrl !== image.dataUrl))} aria-label="移除图片"><X size={13} /></button></div>)}</div>}
              <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="说说你刚做了什么，或发生了什么变化…" rows="2" />
              <div className="composer-actions"><span>试试："下午要出门"、"这个任务做完了"、"我累了"</span><label className="tool-button" aria-label="从图库选择图片"><Image size={18} /><input type="file" accept="image/*" multiple hidden onChange={addImages} /></label><label className="tool-button" aria-label="拍照上传"><Camera size={18} /><input type="file" accept="image/*" capture="environment" hidden onChange={addImages} /></label><button type="submit" className="send-button" disabled={!input.trim() && pendingImages.length === 0} aria-label="发送消息"><Send size={17} /></button></div>
            </form>
          </div>

          <aside className="insight-rail" aria-label="计划与上下文">
            <section className="rail-section plan-section">
              <div className="rail-heading"><div><span>今日动态计划</span><small>现在 {planner?.now?.slice(-5) || now}</small></div><button className="text-button plan-add-button" onClick={() => setShowNewTask(true)}><Plus size={13} /> 新建</button></div>
              <div className="time-budget"><div><span>已安排</span><strong>{formatMinutes(planner?.scheduled_minutes ?? scheduleMinutes)}</strong></div><div><span>保留缓冲</span><strong>{planner ? formatMinutes(planner.buffer_minutes) : '加载中'}</strong></div><div><span>自主可用</span><strong>{planner ? formatMinutes(planner.free_minutes) : '加载中'}</strong></div></div>
              <div className="schedule-list">
                {plan.filter((item) => item.state !== 'deferred').map((item) => (
                  <div className={`schedule-item ${item.state} ${item.tone} ${item.isSubtask ? 'subtask' : ''}`} key={item.id}>
                    <time>{item.start}</time><div className="schedule-line"><span /></div><div className="schedule-body"><strong className={item.isSubtask ? 'subtask-title' : ''}>{item.isSubtask && <span className="subtask-mark" aria-hidden="true">↳</span>}{item.title}</strong><small>{item.note}</small></div>{item.state === 'current' && <button className="done-button" onClick={markCurrentDone} aria-label={`完成${item.title}`}><Check size={16} /></button>}{item.state === 'done' && <Check size={16} className="done-check" />}
                  </div>
                ))}
              </div>
              {flexible.length > 0 && <div className="flex-list"><span><Clock3 size={14} /> 可顺延</span>{flexible.map((item) => <button key={item.id}>{item.title}</button>)}</div>}
              <div className="adjustment"><Sparkles size={15} /><p><strong>为什么这样排</strong>{planner?.adjustment_reason || '补考距离截止日最近，因此优先安排复习，并为临时变化留出顺延空间。'}</p></div>
            </section>
            <section className="rail-section context-section">
              <div className="rail-heading"><div><span>本次读取</span><small>{memoryScope ? mode.defaultMemory : '未读取长期记忆'}</small></div><button className="text-button" onClick={() => setShowConversationOptions(true)}>管理</button></div>
              <div className="memory-chips">{!memoryScope ? <span><Circle size={12} /> 本次不读取记忆</span> : memoryRead.length ? memoryRead.map((item) => <span key={`${item.folder}-${item.title}`}><FileText size={13} /> {item.title}</span>) : <span><Target size={13} /> {conversationMode === 'project' ? (project?.name || '指定项目') : mode.defaultMemory}</span>}</div>
            </section>
            <section className="rail-section vault-section">
              <div className="rail-heading"><div><span>本地知识库</span><small>{vault.loading ? '正在连接…' : vault.connected ? `${vault.documentCount} 篇 Markdown · 已联动` : '桥接服务未连接'}</small></div><button className="text-button" onClick={openVault}>查看</button></div>
              {vault.connected ? <div className="vault-preview">{vault.recentDocuments.slice(0, 2).map((document) => <button key={document.id} onClick={() => { openVault(); openDocument(document.id); }}><FileText size={14} /><span><strong>{document.title}</strong><small>{document.folder}</small></span></button>)}</div> : <p className="vault-error">{vaultError || '启动本地桥接服务后，Obsidian 内容会显示在这里。'}</p>}
            </section>
            <section className="rail-section extraction-section">
              <div className="rail-heading"><div><span>待确认记忆</span><small>AI 提取后由你决定是否沉淀</small></div>{pendingMemories.length > 0 && <span className="pending-count">{pendingMemories.length}</span>}</div>
              {pendingMemories.length ? pendingMemories.slice(0, 3).map((memory) => (
                <div className="extraction-item" key={memory.id}><div className="extraction-icon"><Zap size={15} /></div><div>
                  <small>{memory.kind === 'fact' ? '重要事实' : memory.kind} · {projects.find((item) => item.id === memory.project_id)?.name || '个人记录'}</small>
                  {editingMemoryId === memory.id ? <textarea className="memory-editor" value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} rows="3" /> : <strong>{memory.content}</strong>}
                  <div className="extraction-actions">{editingMemoryId === memory.id ? <><button className="text-button" onClick={() => { setEditingMemoryId(null); setMemoryDraft(''); }}>取消</button><button className="text-button confirm" onClick={() => updateMemory(memory, 'pending_review', memoryDraft)}>保存</button></> : <button className="text-button" onClick={() => { setEditingMemoryId(memory.id); setMemoryDraft(memory.content); }}><PenLine size={12} /> 编辑</button>}<button className="text-button confirm" onClick={() => updateMemory(memory, 'active', editingMemoryId === memory.id ? memoryDraft : memory.content)}>确认</button><button className="text-button" onClick={() => updateMemory(memory, 'archived')}>忽略</button></div>
                </div></div>
              )) : <p className="empty-extraction">本轮没有需要你确认的长期记忆。</p>}
            </section>
          </aside>
        </section>
      </main>

      {subtaskDraft && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="新建子任务"><button className="modal-backdrop" onClick={() => setSubtaskDraft(null)} aria-label="关闭新建子任务" /><section className="task-modal"><div className="modal-header"><div><span>新建子任务</span><p>自动归入父任务并继承所属项目，可独立计时和完成。</p></div><button className="icon-button" type="button" onClick={() => setSubtaskDraft(null)} aria-label="关闭"><X size={20} /></button></div><form className="task-form" onSubmit={createSubtaskManually}><p className="subtask-parent">归入父任务：<strong>{subtaskDraft.parent.title}</strong></p><label>子任务内容<input autoFocus value={subtaskDraft.title} onChange={(event) => setSubtaskDraft((current) => ({ ...current, title: event.target.value }))} placeholder="例如：整理第一章错题" maxLength={120} required /></label><div className="task-form-grid"><label>预计时长（分钟）<input type="number" min="5" max="720" step="5" value={subtaskDraft.estimated_minutes} onChange={(event) => setSubtaskDraft((current) => ({ ...current, estimated_minutes: event.target.value }))} /></label><label>优先级<select value={subtaskDraft.priority} onChange={(event) => setSubtaskDraft((current) => ({ ...current, priority: event.target.value }))}><option value="5">高</option><option value="3">中</option><option value="1">低</option></select></label></div><label>备注（可选）<textarea rows="3" value={subtaskDraft.notes} onChange={(event) => setSubtaskDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="补充完成标准或提醒" maxLength={500} /></label><div className="task-form-actions"><button className="text-command" type="button" onClick={() => setSubtaskDraft(null)}>取消</button><button className="primary-command" type="submit" disabled={taskBusy || !subtaskDraft.title.trim()}>{taskBusy ? '正在创建…' : '创建子任务'}</button></div></form></section></div>}
      {showNewConversation && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="新建对话"><button className="modal-backdrop" onClick={() => setShowNewConversation(false)} aria-label="关闭新建对话" /><section className="new-conversation-modal"><div className="modal-header"><div><span>新建对话</span><p>选择 AI 本次可以了解什么。</p></div><button className="icon-button" onClick={() => setShowNewConversation(false)} aria-label="关闭"><X size={20} /></button></div><div className="new-mode-list">{modes.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => selectMode(item.id)}><span className={`new-mode-icon ${item.id}`}><Icon size={20} /></span><span><strong>{item.label}</strong><small>{item.description}</small></span><ChevronRight size={18} /></button>; })}</div></section></div>}
      {showNewTask && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="新建任务"><button className="modal-backdrop" onClick={() => setShowNewTask(false)} aria-label="关闭新建任务" /><section className="task-modal"><div className="modal-header"><div><span>新建任务</span><p>普通任务、截止任务和长期任务都从这里创建。</p></div><button className="icon-button" type="button" onClick={() => setShowNewTask(false)} aria-label="关闭"><X size={20} /></button></div><form className="task-form" onSubmit={createTaskManually}><label>任务内容<input autoFocus value={newTask.title} onChange={(event) => setNewTask((current) => ({ ...current, title: event.target.value }))} placeholder="例如：复习高等数学错题" maxLength={120} required /></label><label>任务类型<select value={newTask.type} onChange={(event) => setNewTask((current) => ({ ...current, type: event.target.value }))}><option value="one_off">普通任务 · 完成一次</option><option value="deadline">截止任务 · 持续推进到截止日</option><option value="long">长期任务 · 每天自动生成</option></select></label><div className="task-form-grid"><label>{newTask.type === 'long' ? '每天预计分钟数' : '预计时长（分钟）'}<input type="number" min="5" max="720" step="5" value={newTask.estimated_minutes} onChange={(event) => setNewTask((current) => ({ ...current, estimated_minutes: event.target.value }))} /></label><label>所属项目<select value={newTask.project_id} onChange={(event) => setNewTask((current) => ({ ...current, project_id: event.target.value }))}><option value="">不指定项目</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><label>截止日期（可选）<input type="datetime-local" value={newTask.due_at} onChange={(event) => setNewTask((current) => ({ ...current, due_at: event.target.value }))} /></label><fieldset className="priority-field"><legend>优先级</legend><div className="priority-options">{[{ value: '5', label: '高', tone: 'high', detail: '优先安排' }, { value: '3', label: '中', tone: 'medium', detail: '正常推进' }, { value: '1', label: '低', tone: 'low', detail: '有空再做' }].map((item) => <label className={`priority-option ${item.tone}`} key={item.value}><input type="radio" name="task-priority" value={item.value} checked={newTask.priority === item.value} onChange={(event) => setNewTask((current) => ({ ...current, priority: event.target.value }))} /><span className="priority-swatch" /><span><strong>{item.label}</strong><small>{item.detail}</small></span></label>)}</div></fieldset><label>备注（可选）<textarea rows="3" value={newTask.notes} onChange={(event) => setNewTask((current) => ({ ...current, notes: event.target.value }))} placeholder="补充范围、完成标准或提醒" maxLength={500} /></label><div className="task-form-actions"><button className="text-command" type="button" onClick={() => setShowNewTask(false)}>取消</button><button className="primary-command" type="submit" disabled={taskBusy || !newTask.title.trim()}>{taskBusy ? '正在创建…' : '创建任务'}</button></div></form></section></div>}
      {showNewLongTask && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="新建长期任务"><button className="modal-backdrop" onClick={() => setShowNewLongTask(false)} aria-label="关闭新建长期任务" /><section className="task-modal"><div className="modal-header"><div><span>新建长期任务</span><p>它不会被单日完成；每天会生成一条可计时、可复盘的执行项。</p></div><button className="icon-button" type="button" onClick={() => setShowNewLongTask(false)} aria-label="关闭"><X size={20} /></button></div><form className="task-form" onSubmit={createLongTaskManually}><label>长期任务名称<input autoFocus value={longTaskDraft.title} onChange={(event) => setLongTaskDraft((current) => ({ ...current, title: event.target.value }))} placeholder="例如：补考复习" maxLength={120} required /></label><div className="task-form-grid"><label>每天预计分钟数<input type="number" min="5" max="720" step="5" value={longTaskDraft.daily_minutes} onChange={(event) => setLongTaskDraft((current) => ({ ...current, daily_minutes: event.target.value }))} /></label><label>所属项目<select value={longTaskDraft.project_id} onChange={(event) => setLongTaskDraft((current) => ({ ...current, project_id: event.target.value }))}><option value="">不指定项目</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><label>最终截止日期（可选）<input type="datetime-local" value={longTaskDraft.due_at} onChange={(event) => setLongTaskDraft((current) => ({ ...current, due_at: event.target.value }))} /></label><fieldset className="priority-field"><legend>优先级</legend><div className="priority-options">{[{ value: '5', label: '高', tone: 'high', detail: '优先安排' }, { value: '3', label: '中', tone: 'medium', detail: '正常推进' }, { value: '1', label: '低', tone: 'low', detail: '有空再做' }].map((item) => <label className={`priority-option ${item.tone}`} key={item.value}><input type="radio" name="long-task-priority" value={item.value} checked={longTaskDraft.priority === item.value} onChange={(event) => setLongTaskDraft((current) => ({ ...current, priority: event.target.value }))} /><span className="priority-swatch" /><span><strong>{item.label}</strong><small>{item.detail}</small></span></label>)}</div></fieldset><label>备注（可选）<textarea rows="3" value={longTaskDraft.notes} onChange={(event) => setLongTaskDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="例如：按错题本复习并计时" maxLength={500} /></label><div className="task-form-actions"><button className="text-command" type="button" onClick={() => setShowNewLongTask(false)}>取消</button><button className="primary-command" type="submit" disabled={taskBusy || !longTaskDraft.title.trim()}>{taskBusy ? '正在创建…' : '创建长期任务'}</button></div></form></section></div>}
      {showProjects && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="目标与项目"><button className="modal-backdrop" onClick={() => setShowProjects(false)} aria-label="关闭目标与项目" /><section className="history-modal project-modal"><div className="modal-header"><div><span>目标与项目</span><p>长期目标负责方向，项目和截止任务负责推进。</p></div><div className="modal-header-actions"><button className="secondary-command" onClick={() => setShowNewProject(true)}><Plus size={15} /> 新建</button><button className="icon-button" onClick={() => setShowProjects(false)} aria-label="关闭"><X size={20} /></button></div></div><div className="project-overview-list">{projectSummaries.map((item) => <button className="project-overview-card" key={item.id} onClick={() => { setProjectDetailId(item.id); setShowProjects(false); setShowProjectDetail(true); }}><span className={`project-dot ${item.color}`} /><span><strong>{item.name}</strong><small>{item.kind === 'goal' ? '长期目标' : '项目'} · {item.daysLeft === null ? '持续推进' : item.daysLeft < 0 ? '已逾期' : `还有 ${item.daysLeft} 天`} · 剩余约 {formatMinutes(item.remainingMinutes)}</small><div className="project-progress"><i style={{ width: `${item.progress}%` }} /></div></span><em>{item.progress}%</em><ChevronRight size={17} /></button>)}</div></section></div>}
      {showNewProject && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="新建目标或项目"><button className="modal-backdrop" onClick={() => setShowNewProject(false)} aria-label="关闭新建目标或项目" /><section className="task-modal"><div className="modal-header"><div><span>新建目标或项目</span><p>先确定方向，再把任务拆进今天。</p></div><button className="icon-button" onClick={() => setShowNewProject(false)} aria-label="关闭"><X size={20} /></button></div><form className="task-form" onSubmit={createProjectManually}><label>名称<input autoFocus value={projectDraft.name} onChange={(event) => setProjectDraft((current) => ({ ...current, name: event.target.value }))} placeholder="例如：通过 9 月 5 日补考" required /></label><label>类型<select value={projectDraft.kind} onChange={(event) => setProjectDraft((current) => ({ ...current, kind: event.target.value }))}><option value="goal">长期目标</option><option value="project">项目</option></select></label><label>截止日期（可选）<input type="datetime-local" value={projectDraft.due_at} onChange={(event) => setProjectDraft((current) => ({ ...current, due_at: event.target.value }))} /></label><label>说明（可选）<textarea rows="3" value={projectDraft.description} onChange={(event) => setProjectDraft((current) => ({ ...current, description: event.target.value }))} placeholder="想达成什么，为什么重要" /></label><div className="task-form-actions"><button className="text-command" type="button" onClick={() => setShowNewProject(false)}>取消</button><button className="primary-command" type="submit" disabled={taskBusy || !projectDraft.name.trim()}>{taskBusy ? '正在创建…' : '创建'}</button></div></form></section></div>}
      {showProjectDetail && projectDetail && <div className="modal-layer" role="dialog" aria-modal="true" aria-label={`${projectDetail.name}项目详情`}><button className="modal-backdrop" onClick={() => setShowProjectDetail(false)} aria-label="关闭项目详情" /><section className="history-modal project-detail-modal"><div className="modal-header"><div><span>{projectDetail.name}</span><p>{projectDetail.kind === 'goal' ? '长期目标' : '项目'} · {projectDetail.status === 'active' ? '进行中' : projectDetail.status}</p></div><button className="icon-button" onClick={() => setShowProjectDetail(false)} aria-label="关闭"><X size={20} /></button></div><div className="project-detail-hero"><div><small>项目进度</small><strong>{projectSummaries.find((item) => item.id === projectDetail.id)?.progress || 0}%</strong></div><div className="project-progress"><i style={{ width: `${projectSummaries.find((item) => item.id === projectDetail.id)?.progress || 0}%` }} /></div><p>{projectDetail.description || '还没有项目说明。'}</p><div className="project-detail-meta"><span><Target size={14} />{projectDetail.due_at ? `截止 ${new Date(projectDetail.due_at).toLocaleDateString('zh-CN')}` : '持续推进'}</span><span><ListChecks size={14} />{projectDetailTasks.length} 项任务</span></div></div><div className="project-detail-actions"><button className="secondary-command" onClick={() => { setShowProjectDetail(false); setProjectId(projectDetail.id); selectMode('project', projectDetail.id); }}><MessageCircle size={15} /> 进入项目对话</button><button className="primary-command" onClick={() => { setShowProjectDetail(false); setNewTask((current) => ({ ...current, project_id: projectDetail.id })); setShowNewTask(true); }}><Plus size={15} /> 新建项目任务</button></div><div className="project-task-list"><div className="project-task-heading"><strong>项目任务</strong><small>{projectDetailTasks.filter((task) => !['done', 'cancelled'].includes(task.status)).length} 项待推进</small></div>{projectDetailTasks.length ? projectDetailTasks.map((task) => <div className="project-task-row" key={task.id}><span className={`priority-swatch ${task.priority >= 5 ? 'high' : task.priority <= 1 ? 'low' : 'medium'}`} /><span><strong>{task.title}</strong><small>{task.status === 'done' ? '已完成' : task.status === 'deferred' ? '已顺延' : task.status === 'cancelled' ? '已取消' : `${task.estimated_minutes} 分钟`}{task.notes ? ` · ${task.notes}` : ''}</small></span>{!task.parent_task_id && !['done', 'cancelled'].includes(task.status) && <button className="subtask-inline-button" type="button" onClick={() => setSubtaskDraft({ parent: task, title: '', estimated_minutes: '30', priority: String(task.priority >= 4 ? 5 : task.priority <= 1 ? 1 : 3), notes: '' })}>子任务</button>}<em>{task.status === 'done' ? '完成' : task.status === 'in_progress' ? '进行中' : '待办'}</em></div>) : <p className="empty-state">这个项目还没有任务，可以让 AI 或你手动添加。</p>}</div></section></div>}
      {showHistory && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="所有对话"><button className="modal-backdrop" onClick={() => setShowHistory(false)} aria-label="关闭对话历史" /><section className="history-modal"><div className="modal-header"><div><span>所有对话</span><p>恢复任一已保存的对话，继续使用原来的上下文。</p></div><button className="icon-button" onClick={() => setShowHistory(false)} aria-label="关闭"><X size={20} /></button></div><div className="history-list">{threads.length ? threads.map((thread) => <button key={thread.id} onClick={() => openThread(thread.id)}><MessageCircle size={17} /><span><strong>{modes.find((item) => item.id === thread.mode)?.label || '对话'}{thread.project_name ? ` · ${thread.project_name}` : ''}</strong><small>{thread.preview || '尚未发送消息'} · {messageTime(thread.updated_at)}</small></span><em>{thread.message_count}</em><ChevronRight size={17} /></button>) : <p className="empty-state">还没有已保存的对话。</p>}</div></section></div>}
      {showVault && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="本地知识库"><button className="modal-backdrop" onClick={() => { setShowVault(false); setSelectedDocument(null); }} aria-label="关闭知识库" /><section className="vault-modal"><div className="modal-header"><div><span>本地知识库</span><p>{vault.connected ? `${vault.documentCount} 篇 Markdown · ${vault.folders.length} 个目录 · 文件改动会自动刷新` : '尚未连接本地桥接服务'}</p></div><button className="icon-button" onClick={() => { setShowVault(false); setSelectedDocument(null); }} aria-label="关闭"><X size={20} /></button></div>{vaultError && <p className="vault-modal-error">{vaultError}</p>}{selectedDocument ? <div className="document-reader"><button className="back-button" onClick={() => setSelectedDocument(null)}>‹ 返回资料列表</button><small>{selectedDocument.relativePath}</small><h2>{selectedDocument.title}</h2><pre>{selectedDocument.content}</pre></div> : <><div className="vault-modal-toolbar"><span className={`connection-status ${vault.connected ? 'online' : ''}`}><span /> {vault.connected ? '已连接到 Obsidian 文件夹' : '等待桥接服务'}</span><button className="icon-button" onClick={() => loadVault(true)} aria-label="刷新知识库"><RefreshCw size={17} /></button></div><div className="vault-document-list">{vaultDocuments.map((document) => <button key={document.id} onClick={() => openDocument(document.id)}><FileText size={18} /><span><strong>{document.title}</strong><small>{document.folder} · {document.preview || '没有正文摘要'}</small></span><ChevronRight size={17} /></button>)}{vault.connected && vaultDocuments.length === 0 && <p className="empty-state">知识库里还没有 Markdown 资料。</p>}</div></>}</section></div>}
      {showAiSettings && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="AI 与记忆设置"><button className="modal-backdrop" onClick={() => setShowAiSettings(false)} aria-label="关闭 AI 设置" /><section className="account-modal ai-settings-modal"><div className="modal-header"><div><span>AI 与自增长记忆库</span><p>日常对话和每日整理各自选择模型；原始对话始终保留，整理结果可追溯、可确认。</p></div><button className="icon-button" onClick={() => setShowAiSettings(false)} aria-label="关闭"><X size={20} /></button></div><label className="setting-row sleep-plan-visibility"><span><strong>睡眠时段显示计划</strong><small>{showSleepPlan ? '显示任务，但不占用睡眠时间' : '睡眠时段隐藏待安排任务'}</small></span><input type="checkbox" checked={showSleepPlan} onChange={(event) => updateSleepPlanVisibility(event.target.checked)} /></label>
        <section className="ai-settings-section"><div className="settings-section-heading"><strong>日常对话 AI</strong><small>负责对话、计划、任务和作息调整</small></div>{aiProviders.length ? <div className="account-form"><label>Agent 引擎<select value={agentEngine} onChange={(event) => setAgentEngine(event.target.value)}><option value="legacy">标准 AI</option><option value="claude_code">Claude Code</option><option value="codex">Codex</option></select></label><label>中转站<select value={selectedProviderId} onChange={(event) => { const id = event.target.value; const provider = aiProviders.find((item) => item.id === id); setSelectedProviderId(id); setSelectedModel(provider?.selected_model || provider?.models?.[0] || ''); }}><option value="">选择中转站</option>{aiProviders.map((provider) => <option value={provider.id} key={provider.id}>{provider.name} · {provider.models.length} 个模型</option>)}</select></label><label>模型{selectedProvider?.models?.length ? <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>{selectedProvider.models.map((model) => <option value={model} key={model}>{model}</option>)}</select> : <input value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} placeholder="输入模型 ID" />}</label><div className="settings-inline-actions"><button className="secondary-command" type="button" disabled={!selectedProviderId || !selectedModel || providerBusy} onClick={() => testProvider(selectedProviderId, selectedModel)}>测试当前连接</button></div></div> : <p className="vault-modal-error">当前没有读取到可用的 AI 提供商。</p>}</section>
        <section className="ai-settings-section memory-settings-section"><div className="settings-section-heading"><strong>每日记忆整理 AI</strong><small>只读取已保存的非临时对话；输出每日摘要与待确认记忆，不会改写原始对话。</small></div><div className="account-form"><label>整理中转站<select value={memoryProviderId} onChange={(event) => { const id = event.target.value; const provider = aiProviders.find((item) => item.id === id); setMemoryProviderId(id); setMemoryModel(provider?.selected_model || provider?.models?.[0] || ''); setMemoryReasoningEffort(''); }}><option value="">沿用日常对话 AI</option>{aiProviders.map((provider) => <option value={provider.id} key={provider.id}>{provider.name}</option>)}</select></label><label>整理模型{selectedMemoryProvider?.models?.length ? <select value={memoryModel} onChange={(event) => setMemoryModel(event.target.value)}>{selectedMemoryProvider.models.map((model) => <option value={model} key={model}>{model}</option>)}</select> : <input value={memoryModel} onChange={(event) => setMemoryModel(event.target.value)} placeholder="输入模型 ID" />}</label><label>推理等级<select value={memoryReasoningEffort} onChange={(event) => setMemoryReasoningEffort(event.target.value)}><option value="">不指定</option>{(selectedMemoryProvider?.reasoning_efforts || ['minimal', 'low', 'medium', 'high']).map((effort) => <option value={effort} key={effort}>{effort}</option>)}</select></label><label className="setting-row memory-auto-row"><span><strong>每天自动整理</strong><small>到设定时间后，在当天首次打开应用时补跑</small></span><input type="checkbox" checked={memoryAutoDaily} onChange={(event) => setMemoryAutoDaily(event.target.checked)} /></label><label>整理时间<input type="time" value={memoryDailyTime} onChange={(event) => setMemoryDailyTime(event.target.value)} /></label><div className="memory-run-status"><Brain size={16} /><span>{memoryStatus?.latest_run?.status === 'running' ? '正在整理…' : memoryStatus?.summary ? `今日摘要已生成 · ${memoryStatus.raw_message_count || 0} 条原始消息` : memoryStatus ? `今天有 ${memoryStatus.raw_message_count || 0} 条可整理原始消息` : '正在读取整理状态…'}</span></div><div className="settings-inline-actions"><button className="secondary-command" type="button" onClick={() => runDailyMemory()} disabled={memoryRunBusy || !aiProviders.length}><RefreshCw size={15} /> {memoryRunBusy ? '正在整理…' : '立即整理今天'}</button><button className="primary-command" type="button" onClick={async () => { try { await saveAiPreferences(); setNotice('AI 与记忆整理设置已保存。'); await loadMemoryStatus(); } catch (error) { setNotice(error.message || '保存设置失败'); } }}>保存所有选择</button></div><button className="archive-export-button" type="button" onClick={exportMemoryArchive}><FileText size={14} /> 导出原始对话与记忆档案</button></div></section>
        <section className="ai-settings-section provider-add-section"><div className="settings-section-heading"><strong>新增中转站</strong><small>密钥只写入服务器私有配置，保存后不会再次显示。</small></div><form className="account-form" onSubmit={(event) => { event.preventDefault(); addProvider(); }}><label>名称<input value={providerDraft.name} onChange={(event) => setProviderDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="例如：我的 GPT 中转站" required /></label><label>Base URL<input value={providerDraft.base_url} onChange={(event) => setProviderDraft((draft) => ({ ...draft, base_url: event.target.value }))} placeholder="https://example.com/v1" required /></label><label>API Key<input type="password" value={providerDraft.api_key} onChange={(event) => setProviderDraft((draft) => ({ ...draft, api_key: event.target.value }))} placeholder="只在保存时发送" autoComplete="new-password" required /></label><div className="provider-grid"><label>API 协议<select value={providerDraft.api_mode} onChange={(event) => setProviderDraft((draft) => ({ ...draft, api_mode: event.target.value }))}><option value="chat_completions">Chat Completions</option><option value="responses">Responses API</option></select></label><label>默认模型<input value={providerDraft.selected_model} onChange={(event) => setProviderDraft((draft) => ({ ...draft, selected_model: event.target.value }))} placeholder="gpt-5.5" required /></label></div><label>可选模型<textarea value={providerDraft.models} onChange={(event) => setProviderDraft((draft) => ({ ...draft, models: event.target.value }))} placeholder="每行一个，或用逗号分隔；至少包含默认模型" rows="2" /></label><label>可用推理等级<textarea value={providerDraft.reasoning_efforts} onChange={(event) => setProviderDraft((draft) => ({ ...draft, reasoning_efforts: event.target.value }))} placeholder="low, medium, high" rows="1" /></label><button className="text-command" type="submit" disabled={providerBusy}>{providerBusy ? '正在保存…' : '保存并加入中转站列表'}</button></form></section>
      </section></div>}      {showAccount && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="云端同步与登录"><button className="modal-backdrop" onClick={() => setShowAccount(false)} aria-label="关闭同步设置" /><section className="account-modal"><div className="modal-header"><div><span>云端同步</span><p>任务、计划、对话、记忆和作息在登录后同步；Obsidian 文件夹继续保留在本机。</p></div><button className="icon-button" onClick={() => setShowAccount(false)} aria-label="关闭"><X size={20} /></button></div>
        {syncStatus.mode === 'cloud' && <div className="sync-state connected"><Cloud size={18} /><div><strong>已连接云端</strong><small>{session?.user?.email || '当前账号'} · {syncStatus.detail}</small></div></div>}
        {syncStatus.mode === 'needs_import' && <div className="sync-state waiting"><Cloud size={18} /><div><strong>云端还没有你的数据</strong><small>本机数据尚未上传，确认后才会同步到此账号。</small></div></div>}
        {['local', 'unavailable', 'error', 'checking'].includes(syncStatus.mode) && <div className="sync-state"><CloudOff size={18} /><div><strong>{syncStatus.mode === 'checking' ? '正在连接云端' : '当前使用本机数据'}</strong><small>{syncStatus.detail}</small></div></div>}
        {session?.user ? <div className="account-actions">{syncStatus.mode === 'needs_import' && <button className="primary-command" onClick={initializeCloudSync} disabled={authBusy}><Cloud size={16} /> {authBusy ? '正在上传…' : '将本机数据同步到云端'}</button>}{syncStatus.mode === 'cloud' && <button className="secondary-command" onClick={() => refreshSync(session)} disabled={authBusy}><RefreshCw size={16} /> 刷新云端数据</button>}<button className="text-command" onClick={signOut} disabled={authBusy}><LogOut size={16} /> 退出登录</button></div> : supabaseClient ? <form className="account-form" onSubmit={submitAuthentication}><div className="auth-switch"><button type="button" className={authMode === 'login' ? 'selected' : ''} onClick={() => setAuthMode('login')}>登录</button><button type="button" className={authMode === 'register' ? 'selected' : ''} onClick={() => setAuthMode('register')}>注册</button></div><label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" required /></label><label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} minLength="6" placeholder="至少 6 位" required /></label><button className="primary-command" type="submit" disabled={authBusy}><LogIn size={16} /> {authBusy ? '正在处理…' : authMode === 'register' ? '创建账号' : '登录并同步'}</button></form> : <p className="vault-modal-error">Supabase 配置还未就绪。补充有效项目 URL 和 Publishable/anon key 后，刷新此页即可登录。</p>}</section></div>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
