// The registry is the contract between the model, the executor, and future
// MCP adapters. Execution stays in the state store so every mutation remains
// deterministic and transactional.
export const ASSISTANT_TOOLS = Object.freeze([
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
    name: 'set_alarm',
    description: '在用户的安卓手机上设置一个闹钟或提醒。需要明确的时间。',
    parameters: { time: 'HH:mm', date: '可选 YYYY-MM-DD', label: '闹钟标签', repeat: '可选 none 或 daily', reason: '设置原因' }
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
    description: '创建任务并加入真实任务库，再由计划器安排时间。',
    parameters: {
      title: '任务名称', estimated_minutes: '预计分钟数', priority: '1-5',
      project: '可选项目名', due_at: '可选 ISO 时间', date: '可选 YYYY-MM-DD', reason: '创建原因'
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
    name: 'replan_today',
    description: '按最新作息、任务和可用时间重新计算计划。',
    parameters: { reason: '重排原因' }
  }
]);

export const ASSISTANT_TOOL_NAMES = new Set(ASSISTANT_TOOLS.map((tool) => tool.name));

const NUMBER_PARAMETERS = new Set(['estimated_minutes', 'priority', 'target_minutes', 'minutes']);
const REQUIRED_PARAMETERS = {
  set_sleep_time: ['time'],
  set_wake_time: ['time'],
  set_buffer_minutes: ['minutes'],
  set_alarm: ['time'],
  cancel_task: ['task'],
  defer_task: ['task'],
  create_task: ['title'],
  create_project: ['name'],
  update_project: ['project'],
  set_unavailable_period: ['start', 'end'],
  capture_memory: ['title']
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
    tools: ['create_task', 'update_task', 'reorder_tasks', 'start_task_timer', 'pause_task_timer', 'stop_task_timer', 'complete_task', 'reopen_task', 'complete_current_task', 'cancel_task', 'cancel_all_tasks', 'defer_task']
  },
  {
    name: 'project_management',
    description: '创建、查看和调整人生主线、支线与项目。',
    tools: ['create_project', 'update_project', 'create_task', 'update_task']
  },
  {
    name: 'dynamic_planning',
    description: '根据作息、剩余时间、任务优先级和临时事件重排计划。',
    tools: ['set_sleep_time', 'set_wake_time', 'set_buffer_minutes', 'set_unavailable_period', 'replan_today']
  },
  {
    name: 'knowledge_memory',
    description: '检索知识库并把重要信息放入待确认记忆。',
    tools: ['capture_memory']
  },
  {
    name: 'daily_review',
    description: '围绕完成情况、阻碍、事件和明日优先级组织复盘。',
    tools: ['capture_memory', 'create_task', 'replan_today']
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
    type: NUMBER_PARAMETERS.has(name) ? 'number' : 'string',
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
