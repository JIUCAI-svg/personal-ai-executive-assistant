import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function text(value, limit = Infinity) {
  const normalized = String(value || '').trim();
  return Number.isFinite(limit) ? normalized.slice(0, limit) : normalized;
}

function commandPrefix(environmentKey, fallbackExecutable) {
  const executable = text(process.env[`${environmentKey}_EXECUTABLE`]) || fallbackExecutable;
  let args = [];
  try {
    const parsed = JSON.parse(process.env[`${environmentKey}_EXECUTABLE_ARGS`] || '[]');
    if (Array.isArray(parsed)) args = parsed.map((item) => String(item));
  } catch {
    // An invalid optional override behaves like no extra arguments.
  }
  return { executable, args };
}

function run(command, args, { env = {}, cwd = process.cwd(), timeoutMs = null, onStdout = null, onStderr = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = Number.isFinite(timeoutMs) && timeoutMs > 0 ? setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} 执行超时。`));
    }, timeoutMs) : null;
    child.stdout.on('data', (chunk) => { stdout += chunk; onStdout?.(String(chunk)); });
    child.stderr.on('data', (chunk) => { stderr += chunk; onStderr?.(String(chunk)); });
    child.on('error', (error) => { if (timer) clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${command} 返回码 ${code}：${text(stderr || stdout, 20000)}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function mcpConfig(url, token, accessToken = '') {
  const headers = {
    ...(token ? { 'x-forward-token': token } : {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
  };
  return JSON.stringify({
    mcpServers: {
      forward_assistant: {
        type: 'http',
        url,
        ...(Object.keys(headers).length ? { headers } : {})
      }
    }
  });
}

function parseClaudeOutput(stdout) {
  const raw = text(stdout);
  try {
    const parsed = JSON.parse(raw);
    return { content: text(parsed.result || parsed.message || parsed.output || parsed.content || raw), sessionId: text(parsed.session_id || parsed.sessionId) || null };
  } catch {
    return { content: raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() || raw, sessionId: null };
  }
}

function outputText(value) {
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value)) return value.map((item) => outputText(item)).filter(Boolean).join('\n').trim();
  if (!value || typeof value !== 'object') return '';
  const candidate = value.text ?? value.output_text ?? value.message ?? value.content ?? value.result ?? '';
  return typeof candidate === 'string' ? text(candidate) : outputText(candidate);
}

function eventPhase(event, item = undefined) {
  return String(item?.phase || event?.phase || event?.payload?.phase || '').trim().toLowerCase();
}

function isFinalPhase(phase) {
  return !phase || new Set(['final', 'final_answer', 'answer', 'result', 'completed']).has(phase);
}

function parseCodexOutput(stdout) {
  const lines = text(stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let completedCandidate = '';
  let finalResult = '';
  let sessionId = null;
  let sawJson = false;
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      sawJson = true;
      if (event.type === 'thread.started') sessionId = text(event.thread_id || event.threadId) || sessionId;
      const item = event.item || event.payload?.item;
      const phase = eventPhase(event, item);
      // `turn.completed.last_message` is the strongest completion signal. A
      // commentary message can be emitted before it, so it must never win.
      if (event.type === 'turn.completed' && event.last_message) {
        const message = outputText(event.last_message);
        if (message) finalResult = message;
      }
      if (event.type === 'item.completed' && item?.type === 'agent_message') {
        const message = outputText(item);
        if (message && isFinalPhase(phase)) completedCandidate = message;
      }
      // Codex emits agent_message inside an event_msg envelope on some CLI
      // versions. The phase is essential here: commentary must stay out of
      // the final chat reply, while final_answer is valid user-facing text.
      if (event.type === 'event_msg' && event.payload?.type === 'agent_message') {
        const message = outputText(event.payload.message || event.payload.content);
        const payloadPhase = eventPhase(event.payload);
        if (message && payloadPhase && isFinalPhase(payloadPhase)) finalResult = message;
      }
      // Some Codex versions expose response items rather than the normalized
      // item.completed envelope. Only accept an explicitly final message.
      const responseItem = event.type === 'response_item' ? (event.payload || event.item || event) : null;
      if (responseItem?.type === 'message' && responseItem.role === 'assistant' && isFinalPhase(eventPhase(responseItem))) {
        const message = outputText(responseItem.content);
        if (message) finalResult = message;
      }
      if (event.type === 'message' && event.role === 'assistant' && isFinalPhase(phase)) {
        const message = outputText(event.content);
        if (message) finalResult = message;
      }
      if (event.type === 'task_complete' && event.last_agent_message) {
        const message = outputText(event.last_agent_message);
        if (message) finalResult = message;
      }
    } catch {
      // Codex can emit human-readable diagnostics alongside JSON events.
    }
  }
  // When JSON events are present, returning the last arbitrary line can leak
  // a commentary/status message into the chat. Non-JSON CLI output remains a
  // useful fallback for older wrappers that print only plain text.
  return { content: finalResult || completedCandidate || (sawJson ? '' : lines[lines.length - 1] || ''), sessionId };
}

export { parseCodexOutput };

export function codexConfig(provider, mcpUrl, token) {
  const escaped = (value) => JSON.stringify(String(value || ''));
  // Codex speaks the Responses protocol only: current CLI versions refuse to
  // load a provider with `wire_api = "chat"`, so protocol conversion has to
  // happen on the gateway side (the provider must serve /v1/responses).
  return [
    'model = ' + escaped(provider.model),
    'model_provider = "forward"',
    '[model_providers.forward]',
    'name = "forward"',
    'base_url = ' + escaped(provider.base_url),
    'env_key = "OPENAI_API_KEY"',
    '[mcp_servers.forward_assistant]',
    'url = ' + escaped(mcpUrl),
    'bearer_token_env_var = "FORWARD_MCP_TOKEN"',
    ''
  ].join('\n');
}

export function agentEngineCatalog() {
  return [
    { id: 'legacy', name: '标准 AI', description: '使用当前中转站工具调用链路。' },
    { id: 'claude_code', name: 'Claude Code', description: '由 Claude Code 自主判断并调用工具。' },
    { id: 'codex', name: 'Codex', description: '由 Codex 自主判断并调用工具。' }
  ];
}

export async function runAgentEngine({ engine, prompt, provider, appRoot, mcpUrl, mcpToken, accessToken = '', nativeSessionId = '', sessionHome = '', imagePaths = [], onEvent = null }) {
  const selected = String(engine || '').toLowerCase();
  if (!['claude_code', 'codex'].includes(selected)) throw new Error('未选择可用的 Agent 引擎。');
  if (!provider?.base_url || !provider?.api_key || !provider?.model) throw new Error('Agent 缺少中转站、密钥或模型配置。');
  const home = sessionHome || await mkdtemp(path.join(os.tmpdir(), 'forward-agent-'));
  await mkdir(home, { recursive: true });
  await writeFile(path.join(home, 'config.toml'), codexConfig(provider, mcpUrl, mcpToken), 'utf8');
  if (selected === 'claude_code') {
    const args = [
      '--print', '--output-format', 'json', '--model', provider.model,
      '--permission-mode', 'bypassPermissions', '--strict-mcp-config',
      '--mcp-config', mcpConfig(mcpUrl, mcpToken, accessToken),
      ...(imagePaths.length ? ['--add-dir', home] : [])
    ];
    if (nativeSessionId) args.push('--resume', nativeSessionId);
    // Claude Code can read local image files through its native file tools.
    // The absolute paths are also included in the prompt for deterministic
    // discovery across CLI versions.
    args.push(prompt);
    const claudeCommand = commandPrefix('FORWARD_CLAUDE', 'claude');
    const output = await run(claudeCommand.executable, [...claudeCommand.args, ...args], {
      cwd: appRoot,
      env: { ANTHROPIC_API_KEY: provider.api_key, ANTHROPIC_BASE_URL: provider.base_url, CLAUDE_CONFIG_DIR: home },
      onStdout: (chunk) => onEvent?.({ type: 'agent_output', stream: 'stdout', text: chunk.slice(-4000) }),
      onStderr: (chunk) => onEvent?.({ type: 'agent_output', stream: 'stderr', text: chunk.slice(-4000) })
    });
    const parsed = parseClaudeOutput(output.stdout);
    return { engine: selected, content: parsed.content, sessionId: parsed.sessionId || nativeSessionId || null };
  }
  const args = nativeSessionId
    // `-C/--cd` belongs to `codex exec`, not the `exec resume` subcommand.
    // The child process already runs with `cwd: appRoot`, so resume does not
    // need a directory argument.
    ? ['exec', 'resume', '--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', ...imagePaths.flatMap((file) => ['-i', file]), nativeSessionId, prompt]
    : ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', ...imagePaths.flatMap((file) => ['-i', file]), '-C', appRoot, prompt];
  let flushStdout = null;
  const codexCommand = commandPrefix('FORWARD_CODEX', 'codex');
  const output = await run(codexCommand.executable, [...codexCommand.args, ...args], {
      cwd: appRoot,
      env: {
        CODEX_HOME: home, OPENAI_API_KEY: provider.api_key,
        FORWARD_MCP_TOKEN: accessToken || mcpToken || '', FORWARD_MCP_ACCESS_TOKEN: accessToken || ''
      },
      onStdout: (() => {
        // stdout chunks can split a JSON line at any byte boundary. Buffer
        // until a complete newline-delimited event is available, then retain
        // the raw event in the run log while parsing it for UI activity.
        let pending = '';
        const consume = (input, flush = false) => {
          pending += String(input || '');
          const lines = pending.split(/\r?\n/);
          if (!flush) pending = lines.pop() || '';
          else pending = '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed);
            onEvent?.({
              type: event.type || 'agent_event',
              text: event.item?.text || event.item?.message || event.last_message || '',
              item_type: event.item?.type || ''
            });
          } catch {
            // Keep human-readable CLI diagnostics in the run log as well.
            onEvent?.({ type: 'agent_output', stream: 'stdout', text: trimmed.slice(-4000) });
          }
          }
        };
        flushStdout = () => consume('', true);
        return (chunk) => consume(chunk, false);
      })(),
      onStderr: (chunk) => onEvent?.({ type: 'agent_output', stream: 'stderr', text: chunk.slice(-4000) })
    });
  // Flush a final unterminated line emitted by some CLI wrappers.
  flushStdout?.();
  const parsed = parseCodexOutput(output.stdout);
  return { engine: selected, content: parsed.content, sessionId: parsed.sessionId || nativeSessionId || null, sessionHome: home };
}
