// The registry is the contract between the model, the executor, and future
// MCP adapters. Execution stays in the state store so every mutation remains
// deterministic and transactional.
export const ASSISTANT_TOOLS = Object.freeze([
  {
    name: 'get_now',
    description: '读取当前日期、时间和计划日边界。',
    parameters: {}
  },
  {
    name: 'get_today_plan',
    description: '读取指定日期的动态计划、当前任务和可顺延事项。',
    parameters: { date: '可选 YYYY-MM-DD' }
  },
  {
    name: 'list_tasks',
    description: '按状态、项目或关键词查找任务。',
    parameters: { query: '可选关键词', project_id: '可选项目 ID', status: '可选 open、in_progress、deferred、done、cancelled', limit: '最多返回条数' }
  },
  {
    name: 'list_projects',
    description: '读取人生主线、支线和项目列表。',
    parameters: { status: '可选 active、paused、completed、archived', limit: '最多返回条数' }
  },
  {
    name: 'get_app_usage',
    description: '读取手机应用使用摘要和连续使用时长。',
    parameters: { date: '可选 YYYY-MM-DD', limit: '最多返回条数' }
  },
  {
    name: 'set_sleep_time',
    description: '更新今晚的睡觉时间，并触发计划重排。',
    parameters: { time: 'HH:mm', reason: '调整原因' }
  },
  {
    name: 'set_wake_time',
    description: '更新明天的起床时间，并触发计划重排。',
    parameters: { time: 'HH:mm', reason: '调整原因' }
  },
  {
    name: 'set_buffer_minutes',
    description: '设置每天计划保留的缓冲时间，允许设置为 0 分钟。',
    parameters: { minutes: '缓冲分钟数，0-1440', reason: '调整原因' }
  },
  {
    name: 'set_sleep_plan_visibility',
    description: '设置睡眠时段是否仍显示待安排任务；显示仅供查看，不会占用睡眠时间。',
    parameters: { visible: '是否显示，true 或 false', reason: '设置原因' }
  },
  {
    name: 'set_alarm',
    description: '在用户的安卓手机上设置一个闹钟或提醒。需要明确的时间。',
    parameters: { time: 'HH:mm', date: '可选 YYYY-MM-DD', label: '闹钟标签', repeat: '可选 none 或 daily', reason: '设置原因' }
  },
  {
    name: 'schedule_followup',
    description: '安排一次未来的主动唤醒；到时间后系统会再次让 AI 判断是否需要发消息或调整计划。',
    parameters: { after_minutes: '多少分钟后唤醒', instruction: '到时间时需要重新判断的事项', reason: '安排原因' }
  },
  {
    name: 'cancel_alarm',
    description: '取消手机上的一个闹钟。优先使用 alarm_id；也可以用标签和时间匹配。',
    parameters: { alarm_id: '可选闹钟 ID', time: '可选 HH:mm', date: '可选 YYYY-MM-DD', label: '可选闹钟标签', reason: '取消原因' }
  },
  {
    name: 'complete_current_task',
    description: '将当前正在执行的任务标记为完成。',
    parameters: { reason: '完成说明' }
  },
  {
    name: 'set_current_task',
    description: '把指定的可执行任务设为顶部当前任务，并默认立即开始计时；父任务容器不可选择。',
    parameters: { task: '任务名称', task_id: '可选任务 ID', start_timer: '是否立即开始计时，默认 true', mode: '可选 stopwatch 或 countdown', target_minutes: '倒计时分钟数', reason: '选择原因' }
  },
  {
    name: 'cancel_task',
    description: '取消一项任务，使它从计划中移除。',
    parameters: { task: '任务名称', reason: '取消原因' }
  },
  {
    name: 'cancel_all_tasks',
    description: '取消今天所有未完成和已顺延任务。',
    parameters: { reason: '取消原因' }
  },
  {
    name: 'defer_task',
    description: '顺延一项任务，保留任务但今天不再安排。',
    parameters: { task: '任务名称', date: '可选 YYYY-MM-DD', reason: '顺延原因' }
  },
  {
    name: 'create_task',
    description: '创建顶层任务并加入真实任务库，再由计划器安排时间。顶层任务不能绑定父任务。',
    parameters: {
      title: '任务名称', estimated_minutes: '预计分钟数', priority: '1-5',
      project: '可选项目名', due_at: '可选 ISO 时间', date: '可选 YYYY-MM-DD', reason: '创建原因'
    }
  },
  {
    name: 'create_subtask',
    description: '在指定一级任务下创建一条可独立计时、完成的子任务；自动继承父任务所属项目，不能继续嵌套。',
    parameters: {
      title: '子任务名称', parent_task_id: '父任务真实 ID，必填', estimated_minutes: '预计分钟数', priority: '1-5', reason: '创建原因'
    }
  },
  {
    name: 'create_long_task',
    description: '创建长期重复任务；每天自动生成一条独立执行项，完成今天不会结束长期任务。截止时间可留空表示无限期。',
    parameters: {
      title: '长期任务名称', daily_minutes: '每天预计分钟数', priority: '1-5', project: '可选项目名',
      due_at: '可选 ISO 截止时间，留空表示无限期', start_date: '可选 YYYY-MM-DD', notes: '可选备注', reason: '创建原因'
    }
  },
  {
    name: 'update_long_task',
    description: '更新、暂停、恢复或结束长期任务；可调整每日时长和截止日期。',
    parameters: {
      long_task_id: '可选长期任务 ID', task: '长期任务名称', title: '新名称', daily_minutes: '新的每日分钟数',
      priority: '1-5', due_at: 'ISO 截止时间；空字符串表示无限期', notes: '新备注', status: 'active、paused、completed 或 archived'
    }
  },
  {
    name: 'create_project',
    description: '创建一个人生主线、支线或具体项目，并可设置说明、优先级和截止时间。',
    parameters: { name: '目标或项目名称', kind: 'goal 或 project', description: '项目说明', priority: '1-5', due_at: '可选 ISO 截止时间', reason: '创建原因' }
  },
  {
    name: 'update_project',
    description: '修改项目名称、说明、类型、优先级、截止时间或状态；项目状态可设为 active、paused、completed、archived。',
    parameters: { project: '项目名称', project_id: '可选项目 ID', name: '新名称', kind: 'goal 或 project', description: '新说明', priority: '1-5', due_at: '截止时间 ISO', status: 'active、paused、completed 或 archived', reason: '修改原因' }
  },
  { name: 'start_task_timer', description: '开始一项任务的正计时或倒计时；同一时间只运行一个任务。', parameters: { task: '任务名称', task_id: '可选任务 ID', mode: '可选 stopwatch 或 countdown', target_minutes: '倒计时分钟数' } },
  { name: 'pause_task_timer', description: '暂停任务计时并累计已用时间。', parameters: { task: '任务名称', task_id: '可选任务 ID' } },
  { name: 'stop_task_timer', description: '停止任务计时并保存本次时间。', parameters: { task: '任务名称', task_id: '可选任务 ID' } },
  { name: 'complete_task', description: '完成指定任务，保留任务和计时历史。', parameters: { task: '任务名称', task_id: '可选任务 ID' } },
  { name: 'reopen_task', description: '重新打开已完成或已取消的任务。', parameters: { task: '任务名称', task_id: '可选任务 ID' } },
  { name: 'update_task', description: '修改任务标题、备注、预计时长、优先级、所属项目或截止时间。', parameters: { task: '任务名称', task_id: '可选任务 ID', title: '新标题', notes: '新备注', estimated_minutes: '预计分钟数', priority: '1-5', project: '项目名称', due_at: '截止时间 ISO' } },
  { name: 'reorder_tasks', description: '按给定任务 ID 顺序调整待办排序。', parameters: { task_ids: '任务 ID 数组' } },
  {
    name: 'set_unavailable_period',
    description: '记录一段不可用时间，并触发计划重排。',
    parameters: { start: 'HH:mm', end: 'HH:mm', date: '可选 YYYY-MM-DD', reason: '不可用原因' }
  },
  {
    name: 'capture_memory',
    description: '把稳定偏好、明确决定、里程碑或重要事实加入待确认记忆。',
    parameters: { title: '记忆内容', project: '可选项目名', reason: '提取原因' }
  },
  {
    name: 'search_memory',
    description: '按关键词检索已确认的长期记忆和每日摘要；需要了解过去信息时再调用。',
    parameters: { query: '检索关键词或问题', project_id: '可选项目 ID', limit: '最多返回条数' }
  },
  {
    name: 'get_memory',
    description: '读取一条记忆的完整内容。',
    parameters: { memory_id: '记忆 ID，必填' }
  },
  {
    name: 'search_vault',
    description: '按关键词检索本地知识库文档；只返回相关文档摘要，不会自动读取整个知识库。',
    parameters: { query: '检索关键词或问题', folder: '可选文件夹', limit: '最多返回条数' }
  },
  {
    name: 'search_conversations',
    description: '按关键词检索已保存的原始对话记录；需要追溯过去说过的话时调用。',
    parameters: { query: '检索关键词或问题', limit: '最多返回条数' }
  },
  {
    name: 'replan_today',
    description: '按最新作息、任务和可用时间重新计算计划。',
    parameters: { reason: '重排原因' }
  }
]);

export const ASSISTANT_TOOL_NAMES = new Set(ASSISTANT_TOOLS.map((tool) => tool.name));

const NUMBER_PARAMETERS = new Set(['estimated_minutes', 'daily_minutes', 'priority', 'target_minutes', 'minutes', 'after_minutes', 'limit']);
const BOOLEAN_PARAMETERS = new Set(['visible', 'start_timer']);
const REQUIRED_PARAMETERS = {
  get_now: [], get_today_plan: [], list_tasks: [], list_projects: [], get_app_usage: [],
  set_sleep_time: ['time'],
  set_wake_time: ['time'],
  set_buffer_minutes: ['minutes'],
  set_alarm: ['time'],
  schedule_followup: ['after_minutes', 'instruction'],
  cancel_task: ['task'],
  defer_task: ['task'],
  create_task: ['title'],
  create_subtask: ['title', 'parent_task_id'],
  create_long_task: ['title'],
  create_project: ['name'],
  update_project: ['project'],
  set_unavailable_period: ['start', 'end'],
  capture_memory: ['title'],
  set_current_task: [],
  search_memory: ['query'],
  get_memory: ['memory_id'],
  search_vault: ['query'],
  search_conversations: ['query']
};

export const ASSISTANT_SKILLS = Object.freeze([
  {
    name: 'daily_assistant',
    description: '处理日常对话，并在必要时调用其他 Skill。',
    tools: []
  },
  {
    name: 'task_management',
    description: '创建、编辑、排序、计时、完成、取消和顺延任务。',
    tools: ['create_task', 'create_subtask', 'create_long_task', 'update_task', 'update_long_task', 'reorder_tasks', 'set_current_task', 'start_task_timer', 'pause_task_timer', 'stop_task_timer', 'complete_task', 'reopen_task', 'complete_current_task', 'cancel_task', 'cancel_all_tasks', 'defer_task']
  },
  {
    name: 'project_management',
    description: '创建、查看和调整人生主线、支线与项目。',
    tools: ['create_project', 'update_project', 'create_task', 'create_subtask', 'update_task']
  },
  {
    name: 'dynamic_planning',
    description: '根据作息、剩余时间、任务优先级和临时事件重排计划。',
    tools: ['set_sleep_time', 'set_wake_time', 'set_buffer_minutes', 'set_unavailable_period', 'replan_today']
  },
  {
    name: 'knowledge_memory',
    description: '检索知识库并把重要信息放入待确认记忆。',
    tools: ['search_memory', 'get_memory', 'search_vault', 'search_conversations', 'capture_memory']
  },
  {
    name: 'daily_review',
    description: '围绕完成情况、阻碍、事件和明日优先级组织复盘。',
    tools: ['capture_memory', 'create_task', 'create_long_task', 'replan_today']
  }
]);

export function assistantToolPrompt() {
  return ASSISTANT_TOOLS.map((tool) => {
    const parameters = Object.entries(tool.parameters)
      .map(([name, value]) => `${name}: ${value}`)
      .join('；');
    return `- ${tool.name}: ${tool.description} 参数：${parameters}`;
  }).join('\n');
}

export function assistantToolCatalog() {
  return ASSISTANT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: { ...tool.parameters }
  }));
}

function parameterSchema(name, description) {
  return {
    type: NUMBER_PARAMETERS.has(name) ? 'number' : BOOLEAN_PARAMETERS.has(name) ? 'boolean' : 'string',
    description
  };
}

export function assistantMcpTools() {
  return ASSISTANT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(tool.parameters).map(([name, description]) => [name, parameterSchema(name, description)])
      ),
      required: [...(REQUIRED_PARAMETERS[tool.name] || [])],
      additionalProperties: false
    }
  }));
}

export function assistantSkillCatalog() {
  return ASSISTANT_SKILLS.map((skill) => ({
    name: skill.name,
    description: skill.description,
    tools: [...skill.tools]
  }));
}

export function assistantSkillPrompt(mode = 'assistant') {
  const modeSkills = {
    temporary: ['daily_assistant'],
    assistant: ['daily_assistant', 'task_management', 'project_management', 'dynamic_planning', 'knowledge_memory'],
    project: ['daily_assistant', 'task_management', 'project_management', 'knowledge_memory'],
    daily_planning: ['daily_assistant', 'task_management', 'project_management', 'dynamic_planning', 'daily_review']
  };
  const selected = new Set(modeSkills[mode] || modeSkills.assistant);
  return ASSISTANT_SKILLS
    .filter((skill) => selected.has(skill.name))
    .map((skill) => `- ${skill.name}: ${skill.description}`)
    .join('\n');
}
