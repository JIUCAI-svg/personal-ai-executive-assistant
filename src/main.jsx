import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Bell, Bot, Brain, CalendarDays, Check, ChevronDown, ChevronRight, Circle,
  Clock3, Command, FileText, Flame, FolderKanban, HeartPulse, ListChecks, Menu,
  MessageCircle, Mic, MoreHorizontal, MoveRight, Plus, RefreshCw, Send, Settings2,
  Sparkles, SunMedium, Target, X, Zap
} from 'lucide-react';
import './styles.css';

const initialPlan = [
  { id: 'math', start: '10:30', end: '11:20', title: '高等数学 · 错题回顾', project: '补考', tone: 'urgent', state: 'current', note: '第 2 章极限与连续', duration: 50 },
  { id: 'break', start: '11:20', end: '11:35', title: '短暂休息', project: '缓冲', tone: 'break', state: 'next', note: '离开屏幕，喝水走动', duration: 15 },
  { id: 'english', start: '11:35', end: '12:20', title: '英语 · 阅读一篇', project: '补考', tone: 'urgent', state: 'planned', note: '计时完成 + 订正', duration: 45 },
  { id: 'lunch', start: '12:20', end: '13:30', title: '午饭与休息', project: '生活', tone: 'break', state: 'planned', note: '不安排任务', duration: 70 },
  { id: 'experiment', start: '13:30', end: '14:20', title: '多手机收益实验 · 记录', project: '收益实验', tone: 'work', state: 'planned', note: '汇总昨天的数据', duration: 50 },
  { id: 'script', start: '14:35', end: '15:25', title: '漫剧 · 拆解一个热门开场', project: 'AI 漫剧', tone: 'creative', state: 'flex', note: '可顺延', duration: 50 },
  { id: 'live', start: '15:40', end: '16:20', title: '直播 · 设计一段特色玩法', project: '和平精英直播', tone: 'creative', state: 'flex', note: '可顺延', duration: 40 }
];

const projectSummaries = [
  { name: '补考', color: 'coral', progress: 32, detail: '9 月 5 日 · 还剩 16 天' },
  { name: '收益实验', color: 'teal', progress: 48, detail: '今日待整理实验数据' },
  { name: 'AI 漫剧', color: 'violet', progress: 16, detail: '下一步：拆开场结构' },
  { name: '特色直播', color: 'blue', progress: 9, detail: '下一步：确定玩法切口' }
];

const modes = [
  { id: 'daily', icon: CalendarDays, label: '每日规划', description: '读取今日任务、时间、进度和复盘', defaultMemory: '今日计划、补考、近期复盘' },
  { id: 'assistant', icon: Sparkles, label: '普通助手', description: '了解你的长期目标和近期动态', defaultMemory: '长期目标与近期记录' },
  { id: 'project', icon: FolderKanban, label: '项目对话', description: '聚焦一个指定项目', defaultMemory: '补考项目' },
  { id: 'temporary', icon: MessageCircle, label: '临时聊天', description: '不读取知识库，也不沉淀长期内容', defaultMemory: '不读取长期记忆' }
];

const initialMessages = [
  { id: 1, role: 'assistant', time: '10:24', text: '上午好。你距离下一次补考还有 16 天，今天先把高数错题回顾推进 50 分钟。做完后我会按实际进度重排后面的时间。' },
  { id: 2, role: 'user', time: '10:26', text: '好，我现在开始做高数错题。' },
  { id: 3, role: 'assistant', time: '10:26', text: '已开始记录。当前只需要做「第 2 章极限与连续」的错题，不用同时担心下午的项目。' }
];

function minutes(time) {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

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

function App() {
  const [plan, setPlan] = useState(initialPlan);
  const [messages, setMessages] = useState(initialMessages);
  const [conversationMode, setConversationMode] = useState('daily');
  const [project, setProject] = useState('补考');
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
  const [writingToVault, setWritingToVault] = useState(false);
  const endRef = useRef(null);

  const mode = modes.find((item) => item.id === conversationMode) || modes[0];
  const current = plan.find((item) => item.state === 'current');
  const next = plan.find((item) => item.state === 'next' || item.state === 'planned');
  const planned = plan.filter((item) => !['done', 'deferred', 'cancelled'].includes(item.state));
  const scheduleMinutes = planned.reduce((total, item) => total + item.duration, 0);
  const flexible = plan.filter((item) => item.state === 'flex');
  const extraction = useMemo(() => {
    if (notice.includes('完成')) return { kind: '任务更新', text: '高等数学 · 错题回顾已完成', project: '补考', action: '已写入今日记录' };
    if (notice.includes('外出')) return { kind: '生活事件', text: '下午 15:00 - 18:00 外出', project: '今日计划', action: '等待确认写入' };
    if (notice.includes('精力')) return { kind: '执行状态', text: '当前精力不足，需要降低任务强度', project: '今日计划', action: '等待确认写入' };
    return { kind: '项目进度', text: '正在进行第 2 章极限与连续错题回顾', project: '补考', action: '已写入今日记录' };
  }, [notice]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(timeNow()), 30000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  async function loadVault(includeDocuments = false) {
    try {
      setVaultError('');
      const requests = [fetch('/api/vault/status')];
      if (includeDocuments) requests.push(fetch('/api/vault/documents'));
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
    const events = new EventSource('/api/vault/events');
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
      const response = await fetch(`/api/vault/documents/${id}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '无法读取文档');
      setSelectedDocument(payload.document);
    } catch (error) {
      setVaultError(error.message || '读取文档失败');
    }
  }

  async function writeExtractionToVault() {
    if (!vault.connected || writingToVault) return;
    setWritingToVault(true);
    try {
      const isProjectProgress = extraction.project && extraction.project !== '今日计划';
      const response = await fetch('/api/vault/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${extraction.project} · ${extraction.kind}`,
          body: `## 本次更新\n\n${extraction.text}\n\n## 来源\n\n来自「向前」本次对话的已确认提取。`,
          kind: isProjectProgress ? 'project-progress' : 'note',
          project: isProjectProgress ? extraction.project : '',
          source: 'personal-ai-executive-assistant'
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '写入失败');
      setNotice(`已写入知识库：${payload.relativePath}`);
      await loadVault(showVault);
    } catch (error) {
      setVaultError(error.message || '写入知识库失败');
    } finally {
      setWritingToVault(false);
    }
  }

  function addAssistant(text) {
    setMessages((items) => [...items, { id: Date.now() + 1, role: 'assistant', time: timeNow(), text }]);
  }

  function markCurrentDone() {
    if (!current) return;
    setPlan((items) => {
      const firstRemaining = items.find((item) => item.id !== current.id && !['done', 'deferred', 'cancelled'].includes(item.state));
      return items.map((item) => {
        if (item.id === current.id) return { ...item, state: 'done' };
        if (item.id === firstRemaining?.id) return { ...item, state: 'current' };
        if (item.state === 'current') return { ...item, state: 'planned' };
        return item;
      });
    });
    setNotice('已完成高数错题回顾，计划已向前推进');
    addAssistant('已记下：高数错题回顾完成。下一件事是 15 分钟休息，然后继续英语阅读。补考优先级保持不变，因为 9 月 5 日是固定截止日。');
  }

  function handleUserMessage(text) {
    const normalized = text.replace(/\s/g, '');
    if (normalized.includes('完成') || normalized.includes('做完')) {
      markCurrentDone();
      return;
    }
    if (normalized.includes('外出') || normalized.includes('出门')) {
      setPlan((items) => items.map((item) => {
        if (['script', 'live'].includes(item.id)) return { ...item, state: 'deferred', start: '明天', end: '', note: '因下午外出顺延至明天' };
        return item;
      }));
      setNotice('下午外出已加入计划，两个可顺延事项已移动到明天');
      addAssistant('已为你留出下午外出时间。漫剧拆解和直播玩法都属于可顺延事项，我已移到明天；补考英语与收益实验仍保留，因为它们更接近今天的核心目标。');
      return;
    }
    if (normalized.includes('累') || normalized.includes('疲惫')) {
      setPlan((items) => items.map((item) => {
        if (item.id === 'experiment') return { ...item, duration: 25, end: '13:55', note: '精力不足，缩减为关键数据记录' };
        if (item.id === 'script') return { ...item, state: 'deferred', start: '明天', end: '', note: '因精力不足顺延至明天' };
        return item;
      }));
      setNotice('已根据你的精力状态降低下午负荷');
      addAssistant('收到，下午不再安排高消耗创作。我把收益实验缩减为 25 分钟关键数据记录，漫剧任务顺延到明天。这样能保住补考主线，也留出恢复空间。');
      return;
    }
    if ((normalized.includes('取消') || normalized.includes('删除') || normalized.includes('删掉') || normalized.includes('移除'))
      && (normalized.includes('所有') || normalized.includes('全部') || normalized.includes('清空') || normalized.includes('计划'))) {
      setPlan((items) => items.map((item) => ({ ...item, state: 'cancelled', start: '已取消', end: '', note: '已从计划移除' })));
      setNotice('今天和顺延的全部任务已取消');
      addAssistant('已取消今天和已顺延的全部任务，当前计划已清空。之后有新安排时，我会从空计划重新建立。');
      return;
    }
    if (normalized.includes('取消') || normalized.includes('删除') || normalized.includes('删掉') || normalized.includes('移除')) {
      const target = plan.find((item) => {
        const compactTitle = item.title.replace(/\s/g, '').toLowerCase();
        const keywords = item.title.split(/[·•:：、\s]+/).filter((part) => part.length >= 2);
        return normalized.includes(compactTitle) || keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
      }) || current;
      if (!target) {
        addAssistant('请告诉我具体要取消哪一项任务，我会从今天的计划中移除它。');
        return;
      }
      setPlan((items) => {
        const nextId = target.state === 'current'
          ? items.find((item) => item.id !== target.id && !['done', 'deferred', 'cancelled'].includes(item.state))?.id
          : undefined;
        return items.map((item) => {
          if (item.id === target.id) return { ...item, state: 'cancelled', start: '已取消', end: '', note: '已从今天计划移除' };
          if (item.id === nextId) return { ...item, state: 'current' };
          return item;
        });
      });
      setNotice(`${target.title}已从今天计划移除`);
      addAssistant(`已将「${target.title}」从今天的计划中移除，不会再占用今天的时间。其他任务已按剩余时间重新排列。`);
      return;
    }
    if (normalized.includes('不做') || normalized.includes('跳过') || normalized.includes('顺延') || normalized.includes('推迟')) {
      setPlan((items) => items.map((item) => item.state === 'current' ? { ...item, state: 'deferred', start: '明天', end: '', note: '主动顺延' } : item));
      setNotice('当前任务已顺延，计划将重新聚焦');
      addAssistant('已顺延当前任务，并把它移到之后的计划中；今天会保留更重要的执行空间。');
      return;
    }
    setNotice('已从本轮对话识别到一条待确认记录');
    addAssistant('我已理解这条信息，并在右侧生成了一条可确认的更新。你随时可以继续说进度、时间变化或临时安排，我会据此重排。');
  }

  function submitMessage(event) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    setMessages((items) => [...items, { id: Date.now(), role: 'user', time: timeNow(), text }]);
    setInput('');
    window.setTimeout(() => handleUserMessage(text), 250);
  }

  function selectMode(selected) {
    setConversationMode(selected);
    if (selected === 'project') setProject('补考');
    setShowNewConversation(false);
    setShowConversationOptions(true);
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
          <button className="nav-item"><MessageCircle size={18} /> 所有对话</button>
          <button className="nav-item" onClick={openVault}><Brain size={18} /> 记忆库 <span className={`vault-dot ${vault.connected ? 'connected' : ''}`} /></button>
          <button className="nav-item"><ListChecks size={18} /> 计划历史</button>
        </nav>
        <div className="side-section">
          <div className="side-label">进行中的项目 <button aria-label="添加项目"><Plus size={15} /></button></div>
          {projectSummaries.map((item) => (
            <button className="project-link" key={item.name} onClick={() => { setProject(item.name); setConversationMode('project'); }}>
              <span className={`project-dot ${item.color}`} /> <span>{item.name}</span><small>{item.progress}%</small>
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <button className="profile"><span>JC</span><div><strong>九菜</strong><small>执行节奏：稳步</small></div><MoreHorizontal size={18} /></button>
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
            <button className="icon-button"><Settings2 size={19} /></button>
          </div>
          {showConversationOptions && (
            <section className="conversation-popover">
              <div className="popover-title">本次对话</div>
              <div className="mode-grid">
                {modes.map((item) => {
                  const Icon = item.icon;
                  return <button key={item.id} className={`mode-option ${conversationMode === item.id ? 'selected' : ''}`} onClick={() => setConversationMode(item.id)}><Icon size={17} /><span><strong>{item.label}</strong><small>{item.description}</small></span>{conversationMode === item.id && <Check size={16} />}</button>;
                })}
              </div>
              {conversationMode === 'project' && <label className="inline-select"><span>聚焦项目</span><select value={project} onChange={(event) => setProject(event.target.value)}>{projectSummaries.map((item) => <option key={item.name}>{item.name}</option>)}</select></label>}
              <div className="control-divider" />
              <label className="setting-row"><span><strong>读取记忆</strong><small>{mode.defaultMemory}</small></span><input type="checkbox" checked={memoryScope} onChange={(event) => setMemoryScope(event.target.checked)} /></label>
              <label className="setting-row"><span><strong>保存完整对话</strong><small>可随时从历史删除</small></span><input type="checkbox" checked={saveTranscript} onChange={(event) => setSaveTranscript(event.target.checked)} /></label>
              <label className="setting-row"><span><strong>沉淀长期记忆</strong><small>提取后等待你确认</small></span><input type="checkbox" checked={distillMemory} onChange={(event) => setDistillMemory(event.target.checked)} /></label>
            </section>
          )}
        </header>

        <section className="content-layout">
          <div className="chat-column">
            <section className="day-intro">
              <div className="date-kicker"><span className="pulse-dot" /> 周三，8 月 20 日</div>
              <h1>今天，先把最重要的事做下去。</h1>
              <p>现在 <strong>{now}</strong> · 今日还可用约 <strong>5 小时 55 分钟</strong> · 已安排 4 小时 35 分钟</p>
            </section>

            <section className="mobile-plan" aria-label="今日计划概览">
              <div className="mobile-plan-title"><span>今日动态计划</span><span>10:24</span></div>
              <div className="current-compact"><span className="current-indicator" /><div><small>当前任务</small><strong>{current?.title || '计划已完成'}</strong></div><button onClick={markCurrentDone} aria-label="完成当前任务"><Check size={18} /></button></div>
              <div className="compact-next"><span>下一件事</span><strong>{next?.start} · {next?.title}</strong></div>
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
              <div className="rail-heading"><div><span>今日动态计划</span><small>现在 {now}</small></div><button className="icon-button" aria-label="更多计划操作"><MoreHorizontal size={18} /></button></div>
              <div className="time-budget"><div><span>已安排</span><strong>{formatMinutes(scheduleMinutes)}</strong></div><div><span>保留缓冲</span><strong>1 小时 20 分</strong></div><div><span>剩余可用</span><strong>5 小时 55 分</strong></div></div>
              <div className="schedule-list">
                {plan.filter((item) => item.state !== 'deferred').map((item) => (
                  <div className={`schedule-item ${item.state} ${item.tone}`} key={item.id}>
                    <time>{item.start}</time><div className="schedule-line"><span /></div><div className="schedule-body"><strong>{item.title}</strong><small>{item.note}</small></div>{item.state === 'current' && <button className="done-button" onClick={markCurrentDone} aria-label="完成高数错题回顾"><Check size={16} /></button>}{item.state === 'done' && <Check size={16} className="done-check" />}
                  </div>
                ))}
              </div>
              {flexible.length > 0 && <div className="flex-list"><span><Clock3 size={14} /> 可顺延</span>{flexible.map((item) => <button key={item.id}>{item.title}</button>)}</div>}
              <div className="adjustment"><Sparkles size={15} /><p><strong>为什么这样排</strong>补考距离截止日最近，因此上午优先安排两个复习块；创作类任务放在下午，并保留顺延空间。</p></div>
            </section>
            <section className="rail-section context-section">
              <div className="rail-heading"><div><span>本次读取</span><small>{memoryScope ? mode.defaultMemory : '未读取长期记忆'}</small></div><button className="text-button" onClick={() => setShowConversationOptions(true)}>管理</button></div>
              <div className="memory-chips">{memoryScope ? <><span><Target size={13} /> 9 月 5 日补考</span><span><Flame size={13} /> 近期复习进度</span><span><HeartPulse size={13} /> 今日精力记录</span></> : <span><Circle size={12} /> 本次不读取记忆</span>}</div>
            </section>
            <section className="rail-section vault-section">
              <div className="rail-heading"><div><span>本地知识库</span><small>{vault.loading ? '正在连接…' : vault.connected ? `${vault.documentCount} 篇 Markdown · 已联动` : '桥接服务未连接'}</small></div><button className="text-button" onClick={openVault}>查看</button></div>
              {vault.connected ? <div className="vault-preview">{vault.recentDocuments.slice(0, 2).map((document) => <button key={document.id} onClick={() => { openVault(); openDocument(document.id); }}><FileText size={14} /><span><strong>{document.title}</strong><small>{document.folder}</small></span></button>)}</div> : <p className="vault-error">{vaultError || '启动本地桥接服务后，Obsidian 内容会显示在这里。'}</p>}
            </section>
            <section className="rail-section extraction-section">
              <div className="rail-heading"><div><span>本轮提取</span><small>来自刚才的对话</small></div><span className="pending-count">1</span></div>
              <div className="extraction-item"><div className="extraction-icon"><Zap size={15} /></div><div><small>{extraction.kind} · {extraction.project}</small><strong>{extraction.text}</strong><div className="extraction-actions"><button className="text-button">编辑</button><button className="text-button confirm" onClick={writeExtractionToVault} disabled={!vault.connected || writingToVault}>{writingToVault ? '写入中…' : '确认写入知识库'}</button></div></div></div>
            </section>
          </aside>
        </section>
      </main>

      {showNewConversation && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="新建对话"><button className="modal-backdrop" onClick={() => setShowNewConversation(false)} aria-label="关闭新建对话" /><section className="new-conversation-modal"><div className="modal-header"><div><span>新建对话</span><p>选择 AI 本次可以了解什么。</p></div><button className="icon-button" onClick={() => setShowNewConversation(false)} aria-label="关闭"><X size={20} /></button></div><div className="new-mode-list">{modes.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => selectMode(item.id)}><span className={`new-mode-icon ${item.id}`}><Icon size={20} /></span><span><strong>{item.label}</strong><small>{item.description}</small></span><ChevronRight size={18} /></button>; })}</div></section></div>}
      {showVault && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="本地知识库"><button className="modal-backdrop" onClick={() => { setShowVault(false); setSelectedDocument(null); }} aria-label="关闭知识库" /><section className="vault-modal"><div className="modal-header"><div><span>本地知识库</span><p>{vault.connected ? `${vault.documentCount} 篇 Markdown · ${vault.folders.length} 个目录 · 文件改动会自动刷新` : '尚未连接本地桥接服务'}</p></div><button className="icon-button" onClick={() => { setShowVault(false); setSelectedDocument(null); }} aria-label="关闭"><X size={20} /></button></div>{vaultError && <p className="vault-modal-error">{vaultError}</p>}{selectedDocument ? <div className="document-reader"><button className="back-button" onClick={() => setSelectedDocument(null)}>‹ 返回资料列表</button><small>{selectedDocument.relativePath}</small><h2>{selectedDocument.title}</h2><pre>{selectedDocument.content}</pre></div> : <><div className="vault-modal-toolbar"><span className={`connection-status ${vault.connected ? 'online' : ''}`}><span /> {vault.connected ? '已连接到 Obsidian 文件夹' : '等待桥接服务'}</span><button className="icon-button" onClick={() => loadVault(true)} aria-label="刷新知识库"><RefreshCw size={17} /></button></div><div className="vault-document-list">{vaultDocuments.map((document) => <button key={document.id} onClick={() => openDocument(document.id)}><FileText size={18} /><span><strong>{document.title}</strong><small>{document.folder} · {document.preview || '没有正文摘要'}</small></span><ChevronRight size={17} /></button>)}{vault.connected && vaultDocuments.length === 0 && <p className="empty-state">知识库里还没有 Markdown 资料。</p>}</div></>}</section></div>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
