import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function text(value, limit = 20000) {
  return String(value || '').trim().slice(0, limit);
}

function run(command, args, { env = {}, cwd = process.cwd(), timeoutMs = 120000, onStdout = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} 执行超时。`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; onStdout?.(String(chunk)); });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${command} 返回码 ${code}：${text(stderr || stdout, 800)}`));
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

function parseCodexOutput(stdout) {
  const lines = text(stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let result = '';
  let sessionId = null;
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'thread.started') sessionId = text(event.thread_id || event.threadId) || sessionId;
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') result = text(event.item.text || event.item.message || result);
      if (event.type === 'turn.completed' && event.last_message) result = text(event.last_message);
      if (event.type === 'message' && event.role === 'assistant') result = text(event.content || result);
    } catch {
      // Codex can emit human-readable diagnostics alongside JSON events.
    }
  }
  return { content: result || lines[lines.length - 1] || '', sessionId };
}

function codexConfig(provider, mcpUrl, token) {
  const escaped = (value) => JSON.stringify(String(value || ''));
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
    const output = await run('claude', args, {
      cwd: appRoot,
      env: { ANTHROPIC_API_KEY: provider.api_key, ANTHROPIC_BASE_URL: provider.base_url, CLAUDE_CONFIG_DIR: home },
      timeoutMs: 150000,
      onStdout: (chunk) => onEvent?.({ type: 'agent_output', text: chunk.slice(-4000) })
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
  const output = await run('codex', args, {
      cwd: appRoot,
      env: {
        CODEX_HOME: home, OPENAI_API_KEY: provider.api_key,
        FORWARD_MCP_TOKEN: accessToken || mcpToken || '', FORWARD_MCP_ACCESS_TOKEN: accessToken || ''
      },
      timeoutMs: 150000,
      onStdout: (chunk) => {
        for (const line of String(chunk).split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
          try {
            const event = JSON.parse(line);
            onEvent?.({
              type: event.type || 'agent_event',
              text: event.item?.text || event.item?.message || event.last_message || '',
              item_type: event.item?.type || ''
            });
          } catch { /* diagnostics are intentionally omitted from the event stream */ }
        }
      }
    });
  const parsed = parseCodexOutput(output.stdout);
  return { engine: selected, content: parsed.content, sessionId: parsed.sessionId || nativeSessionId || null, sessionHome: home };
}
