# AnimeFinder — Master Data Source Map (V4)

Supabase is the single source of truth for the Master Data Table. Providers are enrichment inputs only.

| Master Data column | Supabase source | Field / relation |
| --- | --- | --- |
| My Ranked | `animefinder.personal_catalog_works` | `my_ranked` |
| Anime | `animefinder.personal_catalog_works` | `display_name` |
| MAL ID | `animefinder.personal_catalog_works` | `primary_mal_id` |
| MAL Score | `animefinder.personal_catalog_works` | `mal_score` |
| Original Observations | `animefinder.personal_catalog_works` | `original_observations` |
| Comments | `animefinder.personal_work_comment_versions` | latest `version_number`; fallback to DB `personal_catalog_works.comments` |
| Keywords | `animefinder.personal_work_keywords` | confirmed rows ordered by `rank` |
| Characters | `animefinder.personal_work_characters` | confirmed rows ordered by `rank` |
| Genres | `animefinder.personal_work_external_metadata` | persisted `genres[]` |
| Full English Name | `animefinder.personal_catalog_works` | `english_name` |
| Original Full Name | `animefinder.personal_catalog_works` | `original_name` |
| MyAnimeList | `animefinder.personal_catalog_works` | `mal_url` |
| Watch Status | `animefinder.personal_catalog_works` | `watch_status` |
| MAL Synopsis | `animefinder.personal_work_synopsis` | `synopsis_original` |
| Synopsis PT-BR | `animefinder.personal_work_synopsis` | `synopsis_pt_br` |
| Synopsis metadata | `animefinder.personal_work_synopsis` | provider/source language/fetched/translated/status/error |
| Character Knowledge | relational projection | `personal_work_characters` + latest `personal_character_comments` + confirmed `personal_character_keywords` + `personal_character_external_sources` |
| Jikan character link | `animefinder.personal_character_external_sources` | provider=`jikan` (legacy links are backfilled from `personal_character_external_links`) |
| Fandom character link | `animefinder.personal_character_external_sources` | provider=`fandom` |

## Read path

`personal_catalog_works` is the base relation. Optional relations never determine whether a work exists in the result. `animefinder.get_master_data_snapshot()` uses left joins/correlated aggregates so a missing synopsis, genre, keyword, character or external link cannot remove a Personal Work.

## Performance

The browser calls one aggregate RPC for the Master Data Table instead of issuing one request per work/relation. Controlled backfills are the only flows allowed to call enrichment providers repeatedly; they run sequentially with delay and persist/read-back each result.

## Integrity checks

The Master Table compares:

- database category count from the RPC;
- number of Master rows for the category;
- database Personal Work IDs against the frontend reference catalog IDs.

Missing database works are reported. The explicit bootstrap action inserts missing works only and never overwrites existing Supabase rows.
