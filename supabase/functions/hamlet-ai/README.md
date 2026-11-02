# Hamlet AI — Supabase Edge Function V1.1

`hamlet-ai` is the secure server bridge between AnimeFinder and the Gemini Developer API.

## Security

- `GEMINI_API_KEY` exists only as a Supabase Edge Function secret.
- The React/GitHub Pages bundle never receives the key.
- The function validates the authenticated Supabase user and currently authorizes only the private AnimeFinder account.
- Do not add `VITE_GEMINI_API_KEY` or any Gemini key to GitHub Actions, frontend env files, localStorage, or database tables.

## Reliability model chain

Default model:

```text
gemini-3.5-flash-lite
```

Default fallback order:

1. `gemini-3.5-flash-lite`
2. `gemini-3.1-flash-lite`
3. `gemini-3.6-flash`
4. `gemini-3.8-flash`

The frontend may submit one of these supported model ids as `preferredModel`. That model is tried first; the remaining supported models remain enabled as fallback.

Fallback is used for transient conditions such as 408/429/500/502/503/504, provider timeout/network failure and model-specific temporary unavailability. Non-transient auth/config/request errors do not blindly run the entire chain.

Each model attempt is limited to about 10 seconds and the total model-attempt budget is limited to about 38 seconds.

## API

- API style: official Gemini Interactions REST API.
- Structured JSON output is enforced with `response_format` and validated again in the AnimeFinder client.
- Streaming is not enabled.
- Conversation history remains ephemeral React memory; no Hamlet conversation tables are created.

The direct REST call is intentional in V1.1: it lets the Edge Function apply `AbortController` directly to each HTTP attempt for reliable timeout/fallback behavior.

## Observability

Server logs include concise records such as:

```text
Hamlet model attempt: { model, status, durationMs }
Hamlet fallback: { model }
Hamlet success: { model, durationMs }
```

Do not log keys, authorization headers/tokens, or full conversation content.

## Required manual setup

If the Gemini key is already configured, V1.1 requires no new secret:

```bash
supabase functions deploy hamlet-ai
```

For a fresh environment:

```bash
supabase secrets set GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
supabase functions deploy hamlet-ai
```

`HAMLET_GEMINI_MODEL` is no longer required. If it still exists from V1, V1.1 ignores it.

## Acceptance test

After deployment, open AnimeFinder → Discover → Hamlet AI.

1. Confirm the visible model defaults to `Gemini 3.5 Flash-Lite`.
2. Open the model selector: Gemini is available; GPT and Claude are disabled.
3. Open Gemini and select any supported model as preferred.
4. Send `Quero assistir um anime sobre RPG.`
5. Hamlet should clarify the RPG intent or produce structured criteria.
6. If the preferred model fails transiently but a backup succeeds, the conversation continues without a technical error and the model indicator changes to the actual backup model.
7. If all Gemini models fail, Hamlet must stop loading and show `Hamlet is temporarily unavailable. Please try again.`
8. Traditional Search remains operational.
