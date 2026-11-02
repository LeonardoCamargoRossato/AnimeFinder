# Hamlet AI — Supabase Edge Function

`hamlet-ai` is the secure server bridge between AnimeFinder and the Gemini Developer API.

## Security

- `GEMINI_API_KEY` exists only as a Supabase Edge Function secret.
- The React/GitHub Pages bundle never receives the key.
- The function validates the authenticated Supabase user and currently authorizes only the private AnimeFinder account.
- Do not add `VITE_GEMINI_API_KEY` or any Gemini key to GitHub Actions, frontend env files, localStorage, or database tables.

## Current Gemini implementation

- Official SDK: `@google/genai`
- API style: Gemini Interactions API
- Default model: `gemini-3.8-flash`
- Optional model override: `HAMLET_GEMINI_MODEL`
- Structured JSON output is validated again in the AnimeFinder client before use.
- Streaming is not enabled in Hamlet V1.
- Conversation history is ephemeral React memory in V1; no Hamlet conversation tables are created yet.

## Required manual setup

From a terminal with the Supabase CLI linked to the AnimeFinder project:

```bash
supabase secrets set GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
supabase secrets set HAMLET_GEMINI_MODEL="gemini-3.8-flash"
supabase functions deploy hamlet-ai
```

`HAMLET_GEMINI_MODEL` is optional. If omitted, the function defaults to `gemini-3.8-flash`.

You can also add the secret from the Supabase Dashboard under Edge Functions / Secrets, then deploy the function with the CLI.

## Acceptance test

After deployment, open AnimeFinder → Discover → Hamlet AI and try:

1. `Quero assistir um anime sobre RPG.`
2. Hamlet should clarify the intended RPG meaning instead of searching titles containing “RPG”.
3. Reply `Algo de fantasia com níveis e habilidades.`
4. Hamlet should return a structured intent and AnimeFinder should search the real catalog.
5. Reply `Não quero isekai.`
6. Existing criteria should remain and Isekai should be added as an exclusion.

If the function or Gemini is unavailable, Hamlet shows a friendly error and traditional Search remains fully operational.
