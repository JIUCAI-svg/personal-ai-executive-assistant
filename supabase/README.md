# Supabase Setup

Create a new Supabase project, then open its SQL Editor and run these files in order:

1. `migrations/001_initial_schema.sql`
2. `migrations/002_cloud_state_sync.sql`

In **Authentication → Providers → Email**, enable Email. During development, either turn off **Confirm email** or complete the verification link sent to your inbox before logging in.

Copy the project URL plus its **Publishable key** (or the legacy `anon` key) to `.env.local`:

```env
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

Restart the local service after editing `.env.local`. In the app, click the account area in the bottom-left corner, register or log in, then use the explicit **将本机数据同步到云端** action. It uploads the current local tasks, plans, conversations, memories, and schedule settings only when the cloud account has no snapshot. The local Obsidian Markdown vault stays on the computer and is not uploaded by this first synchronization pass.

When a second browser or future Android client signs into the same account, it reads the same cloud state. Simultaneous writes use a revision check; a conflicted save reloads and retries instead of silently overwriting the other device.

After the project is ready, configure these values in the deployment environment for the AI gateway, never in the Android app:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `AI_BASE_URL`
- `AI_API_KEY`
- `AI_MODEL`

The Web App uses the Supabase publishable/anon key only after authentication. The AI key always stays in the local bridge or a future server-side function; it is never sent to the browser or Android app.
