# Hamlet AI — Supabase Edge Function V1.2

`hamlet-ai` is the secure server bridge between AnimeFinder and the Gemini Developer API.

## Security

- `GEMINI_API_KEY` exists only as a Supabase Edge Function secret.
- The React/GitHub Pages bundle never receives the key.
- The function validates the authenticated Supabase user and authorizes only the private AnimeFinder account.
- Do not add `VITE_GEMINI_API_KEY` or any Gemini key to GitHub Actions, frontend env files, localStorage, or database tables.

## V1.1 reliability preserved

Default model: `gemini-3.5-flash-lite`.

Fallback order:

1. `gemini-3.5-flash-lite`
2. `gemini-3.1-flash-lite`
3. `gemini-3.6-flash`
4. `gemini-3.8-flash`

The frontend may submit a supported model as `preferredModel`. It is tried first; all other supported Gemini models remain fallback candidates.

Fallback is reserved for transient conditions such as 408/429/500/502/503/504, provider timeout/network failure and temporary model unavailability. Each attempt is capped at about 10 seconds and the overall model-attempt budget is about 38 seconds.

Server logs include model/status/duration only. Never log keys, tokens or full personal conversation content.

## V1.2 structured output

The Edge Function now returns:

- Hamlet reply
- complete structured anime-search intent
- `conversationMetadata`
- actual successful Gemini model
- preferred model
- whether fallback was used

`conversationMetadata` contains a concise AI-generated title/description only when enough context exists or when the search meaning materially changed. This metadata is generated in the **same Gemini request**; V1.2 does not make an extra metadata-only AI request.

If `titleSource=user`, Hamlet returns no replacement metadata. The frontend also prevents AI metadata from overwriting user-edited metadata.

## Persistent conversation data

Conversation persistence is handled directly by the authenticated React/Supabase client, not by the Gemini Edge Function. Apply the migration:

`supabase/migrations/20261102162500_hamlet_ai_v1_2.sql`

It creates:

- `animefinder.hamlet_conversations`
- `animefinder.hamlet_messages`
- `animefinder.hamlet_recommendations`
- indexes
- RLS policies
- `animefinder.touch_hamlet_conversation(uuid)`

No service-role key is required in the browser.

## Deployment

From a terminal linked to the AnimeFinder Supabase project:

```bash
supabase db push
supabase functions deploy hamlet-ai
```

For a fresh environment only:

```bash
supabase secrets set GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
supabase db push
supabase functions deploy hamlet-ai
```

No new Gemini secret is required when `GEMINI_API_KEY` already exists. `HAMLET_GEMINI_MODEL` remains unnecessary and ignored.

## Acceptance test

1. Apply the migration and redeploy `hamlet-ai`.
2. Open AnimeFinder → Discover → Hamlet AI.
3. Confirm the model defaults to Gemini 3.5 Flash-Lite and the selector still exposes the V1.1 fallback models.
4. Start a real conversation; confirm it appears automatically in Conversation History.
5. Navigate to Anime Details and back; confirm the active conversation restores.
6. Refresh the browser; confirm the active conversation restores from Supabase.
7. Continue until Hamlet generates a concise conversation title/description.
8. Edit that metadata manually and confirm later messages do not overwrite it.
9. Start New Conversation and confirm the previous one remains in history.
10. Mark one recommendation as Needs classification and verify the Personal Catalog.
11. Export all three Hamlet PDF modes.
12. If a preferred Gemini model fails transiently and a backup succeeds, confirm the actual successful model still reaches the UI and is stored on the assistant message.
