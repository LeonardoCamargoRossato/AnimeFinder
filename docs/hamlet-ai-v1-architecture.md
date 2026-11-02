# AnimeFinder — Hamlet AI V1.1

## Architecture

```text
Hamlet AI UI
  -> AIProvider
  -> GeminiProvider (browser-safe bridge)
  -> authenticated Supabase Edge Function: hamlet-ai
  -> Gemini Interactions API
  -> preferred-model + automatic fallback chain
  -> structured Hamlet intent + actual responding model
  -> Hamlet Search Service
  -> Supabase personal catalog + AnimeFinder catalog provider
  -> real AnimeFinder recommendations
```

Hamlet is the AnimeFinder AI product/persona. Gemini is only the current reasoning provider.

## Frontend

- `src/hamletTypes.ts` — provider-neutral conversation/search contracts plus preferred-model and actual-model metadata.
- `src/hamletModels.ts` — V1.1 provider/model catalog used by the selector. GPT and Claude are visible preparation only and remain unavailable.
- `src/AIProvider.ts` — provider abstraction.
- `src/GeminiProvider.ts` — calls the authenticated `hamlet-ai` Supabase Edge Function and forwards a preferred model; it contains no Gemini credential.
- `src/hamletSearchService.ts` — converts structured intent into searches over the real AnimeFinder provider and excludes watched titles using the personal catalog.
- `src/HamletAIWorkspace.tsx` — multi-turn conversation, editable interpretation chips, real recommendation cards, active-model indicator and model selector.
- `src/HamletAIEnhancer.tsx` — adds `Search` / `✨ Hamlet AI` to Discover while leaving traditional Search untouched.
- `src/hamlet-ai.css` — responsive workspace and model selector UI.

## Gemini reliability layer

Edge Function: `supabase/functions/hamlet-ai/index.ts`

Production default:

```text
gemini-3.5-flash-lite
```

Fallback priority when the default is preferred:

1. `gemini-3.5-flash-lite`
2. `gemini-3.1-flash-lite`
3. `gemini-3.6-flash`
4. `gemini-3.8-flash`

If the user manually selects another supported Gemini model, that model moves to the first position and the remaining models are used as backups in the reliability order above.

Fallback is triggered only for transient/provider availability conditions such as 408/429/500/502/503/504, timeout/network failure, or a model-specific unavailable/not-found response. Authentication, malformed requests, unsupported model selection and invalid structured output stop cleanly instead of blindly trying every model.

## Timeout strategy

- Per-model request timeout: approximately 10 seconds.
- Overall Edge Function model budget: approximately 38 seconds.
- No endless retries inside a model attempt.
- A transient failure advances immediately to the next model.
- If every model fails, the function returns `HAMLET_ALL_MODELS_UNAVAILABLE` and the React `finally` path removes `Hamlet is thinking...`.

The Edge Function uses the official Gemini Interactions REST endpoint directly so each request can be cancelled with `AbortController` at the HTTP boundary.

## Actual responding model

The successful Edge Function response contains:

```json
{
  "provider": "gemini",
  "model": "gemini-3.1-flash-lite",
  "preferredModel": "gemini-3.5-flash-lite",
  "fallbackUsed": true
}
```

`model` is the model reported by the successful Gemini interaction (falling back to the attempted model identifier only if the provider omits it). React displays the latest successful model. If it differs from the preferred model, the UI shows a subtle `Fallback model` status.

## Model selector

First level:

- Gemini — available
- GPT — unavailable
- Claude — unavailable

Gemini submenu:

- Gemini 3.5 Flash-Lite
- Gemini 3.1 Flash-Lite
- Gemini 3.6 Flash
- Gemini 3.8 Flash

Manual selection changes only the preferred first model. Automatic fallback remains enabled.

Model choice is session-only React state in V1.1. It is not stored in localStorage or Supabase.

## Observability

The Edge Function emits concise server-side attempt logs containing only:

- model id
- status / timeout / network error
- duration in milliseconds
- fallback transition
- successful model

It does not log Gemini credentials, authorization tokens, or full conversation content.

## Security

Required secret:

```text
GEMINI_API_KEY
```

The key is never sent to React, GitHub Pages, localStorage or a database table.

`HAMLET_GEMINI_MODEL` is no longer required in V1.1. The production default is `gemini-3.5-flash-lite`, while manual model preference is validated against the server-side supported-model whitelist.

## V1.1 conversation storage

Conversation history remains current-session React memory only. It is not persisted and never uses localStorage. No Hamlet database migration is required.

## Streaming

Not implemented. The UI shows `Hamlet is thinking...` while the secure request is running and removes it in every success/failure path.

## Search behavior

Gemini/Hamlet does not invent the final anime list. It returns structured criteria. `hamletSearchService.ts` searches the real AnimeFinder catalog, applies watched exclusions from the personal catalog, ranks candidates from available metadata, and creates `Why it matches` text only from provider metadata.

## Manual Supabase deployment

If `GEMINI_API_KEY` is already configured, no secret change is required.

```bash
supabase functions deploy hamlet-ai
```

For a new environment only:

```bash
supabase secrets set GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
supabase functions deploy hamlet-ai
```

Do not create `VITE_GEMINI_API_KEY`.

## Acceptance test

1. Discover shows `Search` and `✨ Hamlet AI`.
2. Hamlet defaults to `Gemini 3.5 Flash-Lite`.
3. The model control opens provider selection: Gemini available, GPT/Claude disabled.
4. Gemini exposes all four supported models.
5. A manual choice becomes preferred but retains fallback.
6. Hamlet: `Quero assistir um anime sobre RPG.`
7. If the preferred model succeeds, the model indicator shows it.
8. If it fails transiently and a backup succeeds, the indicator changes to the actual backup model without polluting the conversation with technical errors.
9. If all models fail, Hamlet shows `Hamlet is temporarily unavailable. Please try again.` and stops loading.
10. Traditional Search remains unchanged.

## Scope boundary

Not included: OpenAI/Anthropic API integrations, Personal Knowledge RAG, embeddings, catalog profile analysis, Character Knowledge retrieval, recommendation learning or fine-tuning.
