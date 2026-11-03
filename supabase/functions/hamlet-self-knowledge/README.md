# Hamlet AI Self-Knowledge Engine V1

This Edge Function implements AnimeFinder's **Hybrid Analysis Architecture** for the Self-Knowledge mode.

## Architecture

`Supabase Master Data (source of truth)` → `Knowledge Document Builder` → `incremental hash check` → `Gemini embedding` → `pgvector retrieval` → `structured/statistical evidence + semantic evidence` → `Gemini reasoning` → `Hamlet answer`.

The function never treats embeddings as the source of truth. Personal rank, character rank, watch status, category, MAL score, identifiers, source refs and timestamps stay structured.

### Semantic domains

- `anime`: synopsis, genres and relevant work metadata.
- `character`: character name, personal character keywords/comments/rank and confirmed external context when present.
- `preference`: personal comments, observations, keywords, watch/drop status and other personal annotations.

## Embedding configuration

- Provider: **Google Gemini API**
- Model: **`gemini-embedding-2`**
- Dimensions: **768**
- Vector store: Supabase Postgres + `pgvector`
- Distance: cosine
- Index: HNSW

A raw 768-dimensional float32 vector is approximately 3 KB (`768 × 4 bytes`) before PostgreSQL row, metadata and HNSW index overhead. For example, 500 derived documents are roughly 1.5 MB of raw vector values; actual database usage is higher because metadata and indexes are additional.

## Incremental regeneration

Every derived Knowledge Document receives a SHA-256 content hash over normalized text plus structured fields relevant to retrieval. The existing embedding is preserved when:

- the hash is unchanged;
- embedding model is unchanged; and
- embedding dimensions are unchanged.

Only changed/new documents are re-embedded. Stale derived documents are removed when their source entity no longer exists.

The function processes embeddings in small batches (default 18, maximum 30) with low concurrency to avoid provider rate-limit bursts. Structured/statistical analysis still uses the full current Master Data snapshot even while semantic indexing is catching up.

## Security

- Supabase Auth session is required.
- Single-user authorization remains enforced.
- `GEMINI_API_KEY` is read only from the Supabase Edge Function environment.
- No Gemini or embedding secret is exposed to the browser.
- pgvector retrieval is accessed through authenticated RLS/RPC paths.

## Operations

`POST { operation: "sync" }`

Builds/updates a small batch of derived documents and returns index coverage.

`POST { operation: "ask", message, conversation }`

1. updates a small incremental embedding batch;
2. classifies the question;
3. builds structured/statistical evidence;
4. runs semantic retrieval when useful;
5. packages evidence;
6. asks the reasoning provider for an evidence-first Hamlet response.

## Manual deployment

1. Run `supabase/migrations/20261102223000_hamlet_self_knowledge_v1.sql` in the AnimeFinder Supabase SQL Editor.
2. Ensure the existing `GEMINI_API_KEY` project secret is available.
3. Deploy this function, for example with Supabase CLI:

```bash
supabase functions deploy hamlet-self-knowledge --project-ref <YOUR_ANIMEFINDER_PROJECT_REF>
```

The GitHub Pages deployment does **not** deploy Supabase Edge Functions automatically.
