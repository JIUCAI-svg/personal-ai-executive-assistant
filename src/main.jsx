import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import {
  Bell, Bot, Brain, CalendarDays, Check, ChevronDown, ChevronRight, Circle,
  Clock3, Cloud, CloudOff, Command, FileText, Flame, FolderKanban, HeartPulse, ListChecks, LogIn, LogOut, Menu,
  MessageCircle, Mic, MoreHorizontal, MoveRight, PenLine, Plus, RefreshCw, Send, Settings2,
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

function dateKicker() {
  return new Intl.DateTimeFormat('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
}

function dynamicPlanToUi(dynamicPlan) {
  if (!dynamicPlan) return [];
  const scheduled = (dynamicPlan.scheduled || []).map((item, index) => ({
    id: item.id,
    start: item.start,
    end: item.end,
    title: item.title,
    project: item.project,
    tone: item.priority >= 5 ? 'urgent' : item.priority >= 3 ? 'work' : 'creative',
    state: item.id === dynamicPlan.current_task?.id ? 'current' : index === 1 ? 'next' : 'planned',
    note: item.notes || (item.due_at ? `截止：${item.due_at.slice(5, 10)}` : '按当前节奏推进'),
    duration: item.estimated_minutes
  }));
  const deferred = (dynamicPlan.deferred || []).map((item) => ({
    id: item.id,
    start: '之后',
    end: '',
    title: item.title,
    project: item.project || '未归类',
    tone: 'creative',
    state: 'deferred',
    note: item.reason || '等待重新安排',
    duration: item.estimated_minutes || 45
  }));
  return [...scheduled, ...deferred];
}

function App() {
  const [plan, setPlan] = useState([]);
  const [planner, setPlanner] = useState(null);
  const [assistantState, setAssistantState] = useState(null);
  const [threadId, setThreadId] = useState(null);
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
  const [showSidebar, setShowSidebar] = useState(false);
  const [memoryScope, setMemoryScope] = useState(true);
  const [saveTranscript, setSaveTranscript] = useState(true);
  const [distillMemory, setDistillMemory] = useState(false);
  const [input, setInput] = useState('');
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
  const [showAiSettings, setShowAiSettings] = useState(false);
  const endRef = useRef(null);

  const mode = modes.find((item) => item.id === conversationMode) || modes[0];
  const projects = assistantState?.projects || [];
  const pendingMemories = (assistantState?.memory_items || []).filter((item) => item.status === 'pending_review');
  const project = projects.find((item) => item.id === projectId) || null;
  const projectSummaries = useMemo(() => projects.map((item, index) => {
    const tasks = (assistantState?.tasks || []).filter((task) => task.project_id === item.id);
    const done = tasks.filter((task) => task.status === 'done').length;
    const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    return { ...item, color: ['coral', 'teal', 'violet', 'blue'][index % 4], progress, detail: `${tasks.filter((task) => ['open', 'in_progress', 'deferred'].includes(task.status)).length} 项待推进` };
  }), [assistantState, projects]);
  const current = plan.find((item) => item.state === 'current');
  const next = plan.find((item) => item.state === 'next' || item.state === 'planned');
  const planned = plan.filter((item) => !['done', 'deferred', 'cancelled'].includes(item.state));
  const scheduleMinutes = planned.reduce((total, item) => total + item.duration, 0);
  const flexible = plan.filter((item) => item.state === 'flex' || item.state === 'deferred');
  const selectedProvider = aiProviders.find((item) => item.id === selectedProviderId) || aiProviders[0] || null;

  useEffect(() => {
    if (selectedProviderId) window.localStorage.setItem('forward.ai.provider', selectedProviderId);
    if (selectedModel) window.localStorage.setItem('forward.ai.model', selectedModel);
  }, [selectedProviderId, selectedModel]);

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
      if (restoreLatest && !threadId && nextThreads[0]?.id) {
        await openThread(nextThreads[0].id, forceAuthentication);
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
    } catch (error) {
      setNotice(error.message || 'AI 提供商暂时不可用');
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
    if (payload.thread?.id) setThreadId(payload.thread.id);
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
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
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

  async function handleUserMessage(text) {
    setAiBusy(true);
    try {
      const response = await apiFetch('/api/assistant/respond', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
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
          model: selectedModel || undefined
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
    if (!text) return;
    setMessages((items) => [...items, { id: Date.now(), role: 'user', time: timeNow(), text }]);
    setInput('');
    handleUserMessage(text);
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
      setConversationMode(thread.mode);
      setProjectId(thread.project_id || '');
      setMemoryScope(Boolean(thread.memory_scope));
      setSaveTranscript(Boolean(thread.save_full_conversation));
      setDistillMemory(Boolean(thread.allow_memory_distillation));
      setMessages((thread.messages || []).map((message) => ({
        id: message.id,
        role: message.role,
        time: messageTime(message.created_at),
        text: message.content
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
          <button className="nav-item" onClick={() => setShowHistory(true)}><ListChecks size={18} /> 计划历史</button>
        </nav>
        <div className="side-section">
          <div className="side-label">进行中的项目 <button aria-label="添加项目"><Plus size={15} /></button></div>
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
              <h1>今天，先把最重要的事做下去。</h1>
              <p>现在 <strong>{planner?.now?.slice(-5) || now}</strong> · 可自主调整 <strong>{planner ? formatMinutes(planner.free_minutes) : '加载中'}</strong> · 已安排 <strong>{planner ? formatMinutes(planner.scheduled_minutes) : formatMinutes(scheduleMinutes)}</strong></p>
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
                  <div><div className="message-meta">{message.role === 'assistant' ? '向前' : '你'} <time>{message.time}</time></div><p>{message.text}</p></div>
                </article>
              ))}
              {notice && <div className="change-note"><Sparkles size={15} /><span>{notice}</span></div>}
              <div ref={endRef} />
            </div>

            <form className="composer" onSubmit={submitMessage}>
              <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="说说你刚做了什么，或发生了什么变化…" rows="2" />
              <div className="composer-actions"><button type="button" className="tool-button" aria-label="语音输入"><Mic size={18} /></button><span>试试："下午要出门"、"这个任务做完了"、"我累了"</span><button type="submit" className="send-button" disabled={!input.trim()} aria-label="发送消息"><Send size={17} /></button></div>
            </form>
          </div>

          <aside className="insight-rail" aria-label="计划与上下文">
            <section className="rail-section plan-section">
              <div className="rail-heading"><div><span>今日动态计划</span><small>现在 {planner?.now?.slice(-5) || now}</small></div><button className="icon-button" aria-label="更多计划操作"><MoreHorizontal size={18} /></button></div>
              <div className="time-budget"><div><span>已安排</span><strong>{formatMinutes(planner?.scheduled_minutes ?? scheduleMinutes)}</strong></div><div><span>保留缓冲</span><strong>{planner ? formatMinutes(planner.buffer_minutes) : '加载中'}</strong></div><div><span>自主可用</span><strong>{planner ? formatMinutes(planner.free_minutes) : '加载中'}</strong></div></div>
              <div className="schedule-list">
                {plan.filter((item) => item.state !== 'deferred').map((item) => (
                  <div className={`schedule-item ${item.state} ${item.tone}`} key={item.id}>
                    <time>{item.start}</time><div className="schedule-line"><span /></div><div className="schedule-body"><strong>{item.title}</strong><small>{item.note}</small></div>{item.state === 'current' && <button className="done-button" onClick={markCurrentDone} aria-label={`完成${item.title}`}><Check size={16} /></button>}{item.state === 'done' && <Check size={16} className="done-check" />}
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

      {showNewConversation && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="新建对话"><button className="modal-backdrop" onClick={() => setShowNewConversation(false)} aria-label="关闭新建对话" /><section className="new-conversation-modal"><div className="modal-header"><div><span>新建对话</span><p>选择 AI 本次可以了解什么。</p></div><button className="icon-button" onClick={() => setShowNewConversation(false)} aria-label="关闭"><X size={20} /></button></div><div className="new-mode-list">{modes.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => selectMode(item.id)}><span className={`new-mode-icon ${item.id}`}><Icon size={20} /></span><span><strong>{item.label}</strong><small>{item.description}</small></span><ChevronRight size={18} /></button>; })}</div></section></div>}
      {showHistory && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="所有对话"><button className="modal-backdrop" onClick={() => setShowHistory(false)} aria-label="关闭对话历史" /><section className="history-modal"><div className="modal-header"><div><span>所有对话</span><p>恢复任一已保存的对话，继续使用原来的上下文。</p></div><button className="icon-button" onClick={() => setShowHistory(false)} aria-label="关闭"><X size={20} /></button></div><div className="history-list">{threads.length ? threads.map((thread) => <button key={thread.id} onClick={() => openThread(thread.id)}><MessageCircle size={17} /><span><strong>{modes.find((item) => item.id === thread.mode)?.label || '对话'}{thread.project_name ? ` · ${thread.project_name}` : ''}</strong><small>{thread.preview || '尚未发送消息'} · {messageTime(thread.updated_at)}</small></span><em>{thread.message_count}</em><ChevronRight size={17} /></button>) : <p className="empty-state">还没有已保存的对话。</p>}</div></section></div>}
      {showVault && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="本地知识库"><button className="modal-backdrop" onClick={() => { setShowVault(false); setSelectedDocument(null); }} aria-label="关闭知识库" /><section className="vault-modal"><div className="modal-header"><div><span>本地知识库</span><p>{vault.connected ? `${vault.documentCount} 篇 Markdown · ${vault.folders.length} 个目录 · 文件改动会自动刷新` : '尚未连接本地桥接服务'}</p></div><button className="icon-button" onClick={() => { setShowVault(false); setSelectedDocument(null); }} aria-label="关闭"><X size={20} /></button></div>{vaultError && <p className="vault-modal-error">{vaultError}</p>}{selectedDocument ? <div className="document-reader"><button className="back-button" onClick={() => setSelectedDocument(null)}>‹ 返回资料列表</button><small>{selectedDocument.relativePath}</small><h2>{selectedDocument.title}</h2><pre>{selectedDocument.content}</pre></div> : <><div className="vault-modal-toolbar"><span className={`connection-status ${vault.connected ? 'online' : ''}`}><span /> {vault.connected ? '已连接到 Obsidian 文件夹' : '等待桥接服务'}</span><button className="icon-button" onClick={() => loadVault(true)} aria-label="刷新知识库"><RefreshCw size={17} /></button></div><div className="vault-document-list">{vaultDocuments.map((document) => <button key={document.id} onClick={() => openDocument(document.id)}><FileText size={18} /><span><strong>{document.title}</strong><small>{document.folder} · {document.preview || '没有正文摘要'}</small></span><ChevronRight size={17} /></button>)}{vault.connected && vaultDocuments.length === 0 && <p className="empty-state">知识库里还没有 Markdown 资料。</p>}</div></>}</section></div>}
      {showAiSettings && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="AI 提供商设置"><button className="modal-backdrop" onClick={() => setShowAiSettings(false)} aria-label="关闭 AI 设置" /><section className="account-modal"><div className="modal-header"><div><span>AI 提供商与模型</span><p>选择本次助手使用的中转站和模型。密钥只保存在服务器，不会显示在这里。</p></div><button className="icon-button" onClick={() => setShowAiSettings(false)} aria-label="关闭"><X size={20} /></button></div>{aiProviders.length ? <div className="account-form"><label>中转站<select value={selectedProviderId} onChange={(event) => { const id = event.target.value; const provider = aiProviders.find((item) => item.id === id); setSelectedProviderId(id); setSelectedModel(provider?.selected_model || provider?.models?.[0] || ''); }}><option value="">选择中转站</option>{aiProviders.map((provider) => <option value={provider.id} key={provider.id}>{provider.name} · {provider.models.length} 个模型</option>)}</select></label><label>模型{selectedProvider?.models?.length ? <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>{selectedProvider.models.map((model) => <option value={model} key={model}>{model}</option>)}</select> : <input value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} placeholder="此中转站没有目录，请输入模型 ID" />}</label><p className="sync-state"><Cloud size={16} /><span>当前：{selectedProvider?.name || '未选择'} · {selectedModel || '未选择模型'}</span></p><button className="primary-command" onClick={() => { setShowAiSettings(false); setNotice(`已切换到 ${selectedProvider?.name || 'AI 提供商'} · ${selectedModel}`); }}>保存本机选择</button></div> : <p className="vault-modal-error">当前没有读取到可用的 AI 提供商。</p>}</section></div>}
      {showAccount && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="云端同步与登录"><button className="modal-backdrop" onClick={() => setShowAccount(false)} aria-label="关闭同步设置" /><section className="account-modal"><div className="modal-header"><div><span>云端同步</span><p>任务、计划、对话、记忆和作息在登录后同步；Obsidian 文件夹继续保留在本机。</p></div><button className="icon-button" onClick={() => setShowAccount(false)} aria-label="关闭"><X size={20} /></button></div>
        {syncStatus.mode === 'cloud' && <div className="sync-state connected"><Cloud size={18} /><div><strong>已连接云端</strong><small>{session?.user?.email || '当前账号'} · {syncStatus.detail}</small></div></div>}
        {syncStatus.mode === 'needs_import' && <div className="sync-state waiting"><Cloud size={18} /><div><strong>云端还没有你的数据</strong><small>本机数据尚未上传，确认后才会同步到此账号。</small></div></div>}
        {['local', 'unavailable', 'error', 'checking'].includes(syncStatus.mode) && <div className="sync-state"><CloudOff size={18} /><div><strong>{syncStatus.mode === 'checking' ? '正在连接云端' : '当前使用本机数据'}</strong><small>{syncStatus.detail}</small></div></div>}
        {session?.user ? <div className="account-actions">{syncStatus.mode === 'needs_import' && <button className="primary-command" onClick={initializeCloudSync} disabled={authBusy}><Cloud size={16} /> {authBusy ? '正在上传…' : '将本机数据同步到云端'}</button>}{syncStatus.mode === 'cloud' && <button className="secondary-command" onClick={() => refreshSync(session)} disabled={authBusy}><RefreshCw size={16} /> 刷新云端数据</button>}<button className="text-command" onClick={signOut} disabled={authBusy}><LogOut size={16} /> 退出登录</button></div> : supabaseClient ? <form className="account-form" onSubmit={submitAuthentication}><div className="auth-switch"><button type="button" className={authMode === 'login' ? 'selected' : ''} onClick={() => setAuthMode('login')}>登录</button><button type="button" className={authMode === 'register' ? 'selected' : ''} onClick={() => setAuthMode('register')}>注册</button></div><label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" required /></label><label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} minLength="6" placeholder="至少 6 位" required /></label><button className="primary-command" type="submit" disabled={authBusy}><LogIn size={16} /> {authBusy ? '正在处理…' : authMode === 'register' ? '创建账号' : '登录并同步'}</button></form> : <p className="vault-modal-error">Supabase 配置还未就绪。补充有效项目 URL 和 Publishable/anon key 后，刷新此页即可登录。</p>}</section></div>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
