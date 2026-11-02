# AnimeFinder — Supabase Single Source of Truth V1 Audit

## Architectural result

Persistent Personal Catalog knowledge is being moved to Supabase. Browser storage is not a supported database/fallback after verified migration. In-memory Maps/React state are allowed only for the current page session.

## Browser persistence audit

| Location / key | Previous role | Classification | V1 action |
|---|---|---|---|
| `animefinder.personalCatalog.dynamic.v0` | Personal Catalog overrides/ranking/categories | Persistent application data / legacy migration | Migrated to `personal_catalog_works`; runtime manager no longer reads/writes localStorage. Key removed only after verified migration step. |
| `animefinder.personalCatalog.draft.v0` | unsaved catalog edit | Temporary UI draft | Replaced by module memory. Reload discards unsaved edits by design. |
| `animefinder.personalComments.v1` | personal comments fallback | Persistent application data / legacy migration | Migrated to `anime_comments`; runtime comments are Supabase-only. |
| `animefinder.personalKnowledge.v1` | work comment versions/keywords/characters | Persistent application data / legacy migration | Migrated to normalized Personal Knowledge tables; runtime is Supabase-only. |
| `animefinder.aiEnrichment.v0` | pre-V1 enrichment | Legacy migration data | Used only as migration input when newer Personal Knowledge does not already exist. |
| `animefinder.characterKnowledge.v1` | Jikan links + roster/external cache | Mixed persistent personal data + provider cache | Personal Jikan links migrated to `personal_character_external_sources`; runtime provider caches use Supabase + memory. |
| `animefinder.characterExternalSources.v2` | Jikan/Fandom personal links | Persistent application data / legacy migration | Migrated to `personal_character_external_sources`; runtime write requires Supabase read-back. |
| `animefinder.synopsisCache.v3` | synopsis/translation browser mirror | Persistent provider data / legacy migration | Migrated to `personal_work_synopsis`; runtime is Supabase-first with memory only for the current session. |
| `animefinder.personalKnowledge.draft.*` | unsaved AI workspace text | Temporary UI state | Current workspace draft is memory-only. Legacy browser drafts are not a source of truth. |
| `animefinder.theme` | light/dark preference | UI preference | May remain localStorage; not Personal Catalog/database data. |
| `animefinder.tts.rate`, `animefinder.tts.pitch`, `animefinder.tts.volume`, `animefinder.tts.voice.*` | audio-player preferences | UI/device preference | May remain localStorage; not Personal Catalog/database data. |
| `animefinder.supabase.auth` | Supabase Auth session | Authentication/session handled by Supabase | Remains managed by `@supabase/supabase-js`; explicitly exempt from the application-data rule. |
| hardcoded `src/catalog-data/*` | historical initial catalog | Legacy migration seed | Retained only as one-time bootstrap/migration reference. Runtime manager/category counts come from Supabase. |

## Runtime source map

- Personal Catalog / category count / rank / observations: `animefinder.personal_catalog_works`
- Current work comment: latest `personal_work_comment_versions` (catalog comment only as legacy DB fallback inside RPC)
- Work keywords: `personal_work_keywords`
- Personal Characters: `personal_work_characters`
- Character comments: `personal_character_comments`
- Character keywords: `personal_character_keywords`
- Jikan/Fandom links: `personal_character_external_sources`
- Jikan character provider cache: `external_characters`
- Anime character roster provider cache: `anime_character_roster_cache`
- Genres/external anime metadata: `personal_work_external_metadata`
- Original + pt-BR synopsis: `personal_work_synopsis`
- Master Data: `get_master_data_snapshot()` RPC
- Integrity metrics: `get_data_integrity_report()` RPC

## Migration safety rules

1. Legacy catalog import uses `insert_missing_personal_catalog_works`; existing Supabase work rows are not overwritten.
2. Legacy comments/knowledge/synopsis/external links are inserted only when the corresponding Supabase data is absent.
3. Each browser key is removed only after its migration step completes without an error.
4. Fandom/Jikan confirmed source writes use read-after-write verification before success UI.
5. Clearing localStorage after a complete migration must not remove persistent Personal Catalog data.

## Query / performance design

Opening Master Data performs one `get_master_data_snapshot()` RPC. Optional relations are aggregated server-side. It does not execute a query per work/keyword/character/synopsis row. Provider enrichment is only invoked when persisted metadata is missing or a user explicitly runs a backfill/link action.

## SpeechSynthesis limitation

Browser `SpeechSynthesis` does not expose an audio element/currentTime. V1 anchors the progress indicator to real `boundary` events and interpolates between the most recently observed boundary events. Pause stops interpolation; resume re-anchors; seek/rate changes restart speech from the selected approximate character position. Displayed time remains explicitly approximate.
