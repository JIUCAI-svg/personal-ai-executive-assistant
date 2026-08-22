# Assistant Runtime

The assistant uses three layers:

1. **Skills** describe the behavior for a conversation scenario.
2. **Tools** are deterministic mutations or queries. The model may request them
   through `actions`, but the state store is the only place that changes data.
3. **MCP adapters** can be added later for external systems such as Android
   notifications, calendar, or another knowledge base. They should map their
   result to the same tool result shape.

The current registry lives in `server/assistant-tools.mjs`. Add a tool there
first, then add its executor branch in `server/state-store.mjs`. The model
prompt and `/api/assistant/tools` catalog are generated from the registry, so
they cannot silently drift from the server allow-list.

## Runtime contract

```text
message -> context -> model JSON -> normalize actions -> execute atomically
         -> tool results -> replan -> reply + audit log
```

An action is considered successful only when its executor returns `ok: true`.
The UI receives both `toolCalls` (requested operations) and `toolResults`
(actual execution results). A future MCP bridge should preserve that distinction
and never report a mutation based only on the model's text.

## MCP bridge

The local API exposes a small MCP-compatible JSON-RPC endpoint at
`POST /api/mcp`:

- `initialize` negotiates the protocol and server capabilities.
- `tools/list` returns the registered tools with JSON Schemas.
- `tools/call` executes one tool through the state store and returns both the
  operation result and the resulting dynamic plan.

`tools/call` accepts optional `thread_id`, `conversation_mode`,
`conversation_options`, `project_id`, and `task_id` fields beside `name` and
`arguments`. This keeps external adapters such as Android notifications and
calendar integrations on the same conversation and audit-log model.

The endpoint uses the same local/remote gateway check as the assistant API.
For LAN clients set `AI_GATEWAY_TOKEN` and send it as `x-forward-token`; do not
put the AI provider key in a phone or browser client.

## Conversation modes

Conversation mode still controls memory scope and persistence. Skills must obey
those flags: temporary conversations may use tools that affect the active plan
only when explicitly requested, but they do not create long-term memories or
transcripts unless the conversation options enable them.
