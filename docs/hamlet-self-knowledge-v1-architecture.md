# Hamlet AI Self-Knowledge Engine — Hybrid Analysis Architecture V1

## Principle

Supabase normalized AnimeFinder data remains the source of truth. The vector layer is derived, replaceable and traceable.

Existing structured sources are reused rather than duplicated:

- `personal_catalog_works`
- `personal_work_comment_versions`
- `personal_work_keywords`
- `personal_work_characters`
- `personal_character_comments`
- `personal_character_keywords`
- `personal_character_external_sources`
- `personal_work_synopsis`
- `personal_work_external_metadata`
- `get_master_data_snapshot()`

## Data flow

```text
User Question
   ↓
Query Classification
   ↓
SelfKnowledgeService
   ↓
Master Data snapshot ────────┐
   ↓                         │
Structured evidence          │
Statistical evidence         │
                             ├─ Evidence Package → Gemini reasoning → Hamlet answer
Knowledge Document Builder   │
   ↓                         │
SHA-256 content hash         │
   ↓                         │
changed only? → embedding    │
   ↓                         │
pgvector semantic retrieval ─┘
```

## Knowledge Documents

Only three derived semantic domains are stored:

### Anime

Work-level semantic description: title, genres, synopsis and relevant provider metadata. Personal rank/status remain separate structured columns on the derived document and still originate in Master Data.

### Character

One document per relevant stored personal character, including personal character keywords/comment, character rank and confirmed external context when available.

### Preference

The user's relationship to a work: personal comments, observations, keywords and watch/drop context.

Every derived document includes `source_refs` back to normalized source entities.

## Embeddings

- provider: Google Gemini API
- model: `gemini-embedding-2`
- dimensions: 768
- vector store: Supabase pgvector
- distance: cosine
- index: HNSW

The external MyAnimeList/Jikan-compatible catalog is **not embedded** in V1. Only the user's existing Personal Knowledge / Master Data entities generate documents.

## Incremental strategy

The builder normalizes document text and relevant structured metadata, computes a SHA-256 hash and compares it with the stored derived row.

```text
source data
  ↓
normalized document + structured retrieval fields
  ↓
SHA-256 content hash
  ↓
unchanged + same model/dimensions → preserve existing vector
changed/new/model changed        → regenerate only this document
```

Indexing uses small batches so opening Self-Knowledge or asking a question does not create a large provider burst. Structured/statistical analysis remains immediately available for the full Master Data snapshot even if semantic indexing is still incomplete.

## SelfKnowledgeService responsibilities

The public frontend entry point is `SelfKnowledgeService.ask()` / `sync()`. Server-side orchestration implements the conceptual capabilities:

- semantic retrieval
- rank group comparison
- keyword analysis
- genre analysis
- character analysis
- dropped/unfinished analysis
- possible contradiction detection
- structured evidence extraction

The browser does not read pgvector directly and does not receive the full Master Data snapshot.

## Hybrid query routing

V1 routes questions as:

- `structured`: direct catalog/ranking/status evidence
- `statistical`: frequencies, distributions, rank groups, watched/dropped comparisons
- `semantic`: comments/meaning/themes/personal-language retrieval
- `hybrid`: structured/statistical + semantic evidence
- `contradiction`: possible divergence between rank/status and personal wording

Routing is deterministic in V1 to avoid spending an additional model call only to classify a question.

## Statistical rules

Ranking is always treated as an ordinal **personal ranking**, never a rating.

Supported evidence includes:

- Top N groups
- arbitrary detected rank intervals such as 100–150
- keyword frequencies
- genre frequencies
- character-keyword frequencies
- watched vs dropped/unfinished comparisons
- rank-group comparisons
- MAL score summaries only as an external score, never as personal ranking

Every group carries sample size. Hamlet is instructed not to claim correlation or causality from insufficient samples.

## Contradiction analysis

V1 flags conservative candidates only. Examples include:

- Top 25 rank + predominantly negative wording
- rank 100+ + strongly positive wording
- dropped/unfinished + strongly positive wording

These are supplied to Hamlet as **possible contradictions**, not errors or facts about the user.

## Evidence-first reasoning

Gemini receives only the bounded Evidence Package, not the entire database. Hamlet's response is instructed to separate:

1. DATA
2. ANALYSIS
3. INTERPRETATION

Interpretations must remain tentative where evidence is weak.

## Security

- existing Supabase Auth retained
- existing single-user authorization retained
- RLS on derived documents
- `GEMINI_API_KEY` only in Supabase Edge Function environment
- embedding generation server-side
- no private key or service-role secret in frontend

## Installation order

Assuming the current AnimeFinder Master Data / Personal Knowledge schema is already installed:

1. Run `supabase/migrations/20261102223000_hamlet_self_knowledge_v1.sql` manually in Supabase SQL Editor.
2. Deploy `supabase/functions/hamlet-self-knowledge`.
3. Reuse the existing `GEMINI_API_KEY` secret.
4. Open Hamlet AI → Self-Knowledge. The index warms incrementally and reports coverage in the UI.

If the existing Master Data migration is missing, run the current prerequisite migrations first; the Self-Knowledge migration intentionally fails early instead of creating duplicate Master Data tables.
