# Supabase Setup

Create a new Supabase project, then open its SQL Editor and run `migrations/001_initial_schema.sql`.

After the project is ready, configure these values in the deployment environment for the AI gateway, never in the Android app:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AI_BASE_URL`
- `AI_API_KEY`
- `AI_MODEL`

The Android app will use the Supabase anon key only after authentication is added. The service role key and AI key stay in the Edge Function environment.
