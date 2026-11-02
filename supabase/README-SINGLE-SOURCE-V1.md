# AnimeFinder — Supabase Single Source of Truth V1

Run these SQL files in **Supabase → SQL Editor** in this order:

1. `data-integrity-master-v4.sql`
   - self-contained/idempotent base migration;
   - creates missing Personal Catalog / Personal Knowledge / synopsis / external-source structures;
   - creates `insert_missing_personal_catalog_works` and the base Master Data RPC.

2. `supabase-single-source-v1-provider-cache.sql`
   - creates the Supabase-side Jikan character/provider cache tables used by the Single Source runtime;
   - no browser persistence is used for these caches.

3. `supabase-single-source-v1.sql`
   - makes comments and external anime metadata Supabase-backed;
   - adds write-through metadata RPC;
   - upgrades `get_master_data_snapshot()`;
   - adds `get_data_integrity_report()`.

All files are idempotent and designed to preserve existing rows.

## After SQL

1. Reload AnimeFinder and log in.
2. On startup, the app runs a **verified legacy migration** for old browser/hardcoded Personal Catalog data. It only removes an old browser key after the corresponding migration step succeeds.
3. The runtime Personal Catalog is then hydrated from `get_master_data_snapshot()`.
4. Open **My Watched Anime → Expand → View Full Table**.
5. Use **Backfill Genres** and **Backfill Synopsis** if needed.
6. Use **↻** to re-query Supabase only; it does not call Jikan/Fandom/translation.

## Verification SQL

After the migration/bootstrap, run:

```sql
select animefinder.get_data_integrity_report();
```

This returns actual database counts for works, categories, genres, synopsis and character provider links. Do not use hardcoded UI counts as the audit result.

## Hard-reload acceptance test

Once the legacy migration reports no errors, clear AnimeFinder application localStorage keys (do not intentionally break the Supabase Auth session), reload, log in again, and verify:

- Personal Catalog still exists;
- World Trigger comment/keywords/characters still exist;
- Sōya Kazama Fandom link still exists;
- genres and synopsis still exist;
- Master Data reconstructs from Supabase.

Theme/TTS preferences may still use browser storage because they are device/UI preferences, not Personal Catalog data. Supabase Auth also manages its own session storage key.
