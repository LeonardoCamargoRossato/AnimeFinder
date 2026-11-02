# AnimeFinder — Hamlet AI V1

## Architecture

```text
Hamlet AI UI
  -> AIProvider
  -> GeminiProvider (browser-safe bridge)
  -> authenticated Supabase Edge Function: hamlet-ai
  -> Google GenAI SDK / Gemini Interactions API
  -> structured Hamlet intent
  -> Hamlet Search Service
  -> Supabase personal catalog + AnimeFinder catalog provider
  -> real AnimeFinder recommendations
```

Hamlet is the AnimeFinder AI product/persona. Gemini is only the current reasoning provider.

## Frontend

- `src/hamletTypes.ts` — provider-neutral conversation and search-intent contracts.
- `src/AIProvider.ts` — provider abstraction.
- `src/GeminiProvider.ts` — calls the authenticated `hamlet-ai` Supabase Edge Function. It contains no Gemini credential.
- `src/hamletSearchService.ts` — converts the structured intent into searches over the real AnimeFinder provider and excludes watched titles using the personal catalog.
- `src/HamletAIWorkspace.tsx` — multi-turn conversation, editable interpretation chips, real recommendation cards and Why it matches.
- `src/HamletAIEnhancer.tsx` — adds `Search` / `✨ Hamlet AI` to Discover while leaving the existing Search implementation untouched.
- `src/hamlet-ai.css` — responsive desktop/mobile UI.

## AI provider

Edge Function: `supabase/functions/hamlet-ai/index.ts`

- Official SDK: `@google/genai`
- Recommended API surface used: Gemini Interactions API
- Default model: `gemini-3.8-flash`
- Optional server-side override: `HAMLET_GEMINI_MODEL`
- Required secret: `GEMINI_API_KEY`
- Structured output: JSON schema containing Hamlet reply + full updated search intent
- Auth: Supabase authenticated request plus the private AnimeFinder account check

The key is never sent to React, GitHub Pages, localStorage or a database table.

## V1 conversation storage

Conversation history is current-session React memory only. It is not persisted and never uses localStorage. No Hamlet database migration is required in V1.

## Streaming

Not implemented in V1. The UI shows `Hamlet is thinking...` while the secure request is running. Streaming can be added later without changing the provider boundary.

## Search behavior

Gemini/Hamlet does not invent the final anime list. It returns structured criteria. `hamletSearchService.ts` then searches the real AnimeFinder catalog, applies watched exclusions from the personal catalog, ranks candidates from available metadata, and creates `Why it matches` text only from provider metadata.

## Manual Supabase steps

The frontend is deployable without the Gemini key. Hamlet conversation calls become functional only after the Edge Function is configured.

```bash
supabase secrets set GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
supabase secrets set HAMLET_GEMINI_MODEL="gemini-3.8-flash"
supabase functions deploy hamlet-ai
```

`HAMLET_GEMINI_MODEL` is optional.

Do not create `VITE_GEMINI_API_KEY`.

## Acceptance test

1. Discover shows `Search` and `✨ Hamlet AI`.
2. Traditional Search remains unchanged.
3. Hamlet: `Quero assistir um anime sobre RPG.`
4. Hamlet clarifies the ambiguous meaning of RPG.
5. User: `Algo de fantasia com níveis e habilidades.`
6. Structured intent becomes ready and real AnimeFinder recommendations appear.
7. User: `Não quero isekai.`
8. Prior criteria remain and `Avoid Isekai` appears as an editable chip.
9. Recommendation cards open the existing Anime Details route.
10. If Gemini/Edge Function is unavailable, Hamlet shows a friendly error and Search still works.

## V1 scope boundary

Not included: Personal Knowledge RAG, embeddings, catalog profile analysis, Character Knowledge retrieval, recommendation learning or fine-tuning. Those remain future Hamlet V2/V3 work.
