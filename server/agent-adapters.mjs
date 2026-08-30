import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function text(value, limit = 20000) {
  return String(value || '').trim().slice(0, limit);
}

function run(command, args, { env = {}, cwd = process.cwd(), timeoutMs = 120000 } = {}) {
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
    child.stdout.on('data', (chunk) => { stdout += chunk; });
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
    return text(parsed.result || parsed.message || parsed.output || parsed.content || raw);
  } catch {
    return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() || raw;
  }
}

function parseCodexOutput(stdout) {
  const lines = text(stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let result = '';
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') result = text(event.item.text || event.item.message || result);
      if (event.type === 'turn.completed' && event.last_message) result = text(event.last_message);
      if (event.type === 'message' && event.role === 'assistant') result = text(event.content || result);
    } catch {
      // Codex can emit human-readable diagnostics alongside JSON events.
    }
  }
  return result || lines[lines.length - 1] || '';
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

export async function runAgentEngine({ engine, prompt, provider, appRoot, mcpUrl, mcpToken, accessToken = '' }) {
  const selected = String(engine || '').toLowerCase();
  if (!['claude_code', 'codex'].includes(selected)) throw new Error('未选择可用的 Agent 引擎。');
  if (!provider?.base_url || !provider?.api_key || !provider?.model) throw new Error('Agent 缺少中转站、密钥或模型配置。');
  if (selected === 'claude_code') {
    const output = await run('claude', [
      '--print', '--output-format', 'json', '--model', provider.model,
      '--permission-mode', 'bypassPermissions', '--strict-mcp-config',
      '--mcp-config', mcpConfig(mcpUrl, mcpToken, accessToken), prompt
    ], {
      cwd: appRoot,
      env: { ANTHROPIC_API_KEY: provider.api_key, ANTHROPIC_BASE_URL: provider.base_url },
      timeoutMs: 150000
    });
    return { engine: selected, content: parseClaudeOutput(output.stdout) };
  }

  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'forward-codex-'));
  try {
    await writeFile(path.join(tempHome, 'config.toml'), codexConfig(provider, mcpUrl, mcpToken), 'utf8');
    const output = await run('codex', [
      'exec', '--json', '--ephemeral', '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check', '-C', appRoot, prompt
    ], {
      cwd: appRoot,
      env: {
        CODEX_HOME: tempHome, OPENAI_API_KEY: provider.api_key,
        FORWARD_MCP_TOKEN: accessToken || mcpToken || '', FORWARD_MCP_ACCESS_TOKEN: accessToken || ''
      },
      timeoutMs: 150000
    });
    return { engine: selected, content: parseCodexOutput(output.stdout) };
  } finally {
    await rm(tempHome, { recursive: true, force: true }).catch(() => undefined);
  }
}
