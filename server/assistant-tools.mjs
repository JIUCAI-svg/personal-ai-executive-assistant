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

export const ASSISTANT_SKILLS = Object.freeze([
  {
    name: 'daily_assistant',
    description: '处理日常对话，并在必要时调用其他 Skill。',
    tools: []
  },
  {
    name: 'task_management',
    description: '创建、完成、取消和顺延任务。',
    tools: ['create_task', 'complete_current_task', 'cancel_task', 'cancel_all_tasks', 'defer_task']
  },
  {
    name: 'dynamic_planning',
    description: '根据作息、剩余时间、任务优先级和临时事件重排计划。',
    tools: ['set_sleep_time', 'set_wake_time', 'set_unavailable_period', 'replan_today']
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

export function assistantSkillCatalog() {
  return ASSISTANT_SKILLS.map((skill) => ({
    name: skill.name,
    description: skill.description,
    tools: [...skill.tools]
  }));
}
