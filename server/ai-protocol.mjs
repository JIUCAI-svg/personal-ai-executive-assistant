function text(value) {
  return String(value || '').trim();
}

function normalizeRole(role) {
  if (role === 'assistant') return 'assistant';
  if (role === 'system' || role === 'developer') return 'developer';
  return 'user';
}

export function assistantEndpoint(provider) {
  const baseUrl = text(provider?.base_url).replace(/\/$/, '');
  return `${baseUrl}/${provider?.api_mode === 'responses' ? 'responses' : 'chat/completions'}`;
}

export function buildAssistantModelRequest(provider, request = {}) {
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const model = text(request.model || provider?.model);
  if (provider?.api_mode !== 'responses') {
    return {
      model,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.reasoning_effort ? { reasoning_effort: request.reasoning_effort } : {}),
      ...(request.response_format ? { response_format: request.response_format } : {}),
      messages
    };
  }

  // Responses uses a different envelope. Keep JSON mode in the output text
  // contract so the same deterministic action parser is used by both APIs.
  return {
    model,
    input: messages
      .filter((message) => text(message?.content))
      .map((message) => {
        const role = normalizeRole(message.role);
        // Responses distinguishes input content from prior assistant output.
        // Relays that enforce the schema reject assistant history as input_text.
        return {
          role,
          content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: text(message.content) }]
        };
      }),
    text: { format: { type: 'json_object' } },
    ...(request.reasoning_effort ? { reasoning: { effort: request.reasoning_effort } } : {})
  };
}

function responseContentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === 'string') return item;
      return text(item?.text || item?.output_text || item?.content);
    }).filter(Boolean).join('\n');
  }
  return text(content?.text || content?.output_text || content?.content);
}

export function extractAssistantText(provider, payload) {
  if (provider?.api_mode !== 'responses') return text(payload?.choices?.[0]?.message?.content);
  if (text(payload?.output_text)) return text(payload.output_text);
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const pieces = output.flatMap((item) => {
    if (item?.type !== 'message' && !item?.content) return [];
    return [responseContentText(item.content)];
  }).filter(Boolean);
  return pieces.join('\n').trim();
}

export function upstreamErrorMessage(payload, status) {
  const detail = text(payload?.error?.message || payload?.message || payload?.error || payload?.detail);
  return detail ? `AI 网关返回 HTTP ${status}：${detail.slice(0, 300)}` : `AI 网关返回 HTTP ${status}`;
}
