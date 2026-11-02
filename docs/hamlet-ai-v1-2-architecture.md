# AnimeFinder — Hamlet AI V1.2

## Scope

V1.2 is an incremental upgrade over Hamlet V1.1. It preserves the Gemini reliability chain, timeout protection, actual-model indicator and model selector while adding persistent conversations, compact recommendations, catalog classification actions and PDF history exports.

## Runtime architecture

```text
Hamlet UI
  -> AIProvider
  -> GeminiProvider
  -> Supabase Edge Function hamlet-ai
  -> Gemini fallback chain
  -> structured intent + optional conversation metadata

Hamlet UI
  -> Supabase animefinder.hamlet_conversations
  -> animefinder.hamlet_messages
  -> animefinder.hamlet_recommendations

Structured intent
  -> AnimeFinder Search Service
  -> real anime catalog results

Mark as Watched
  -> existing Personal Catalog persistence
  -> watched OR needs-classification
```

Supabase remains the source of truth. No Hamlet conversation data is persisted in localStorage.

## Automatic persistence

- A database conversation is created only when the user sends the first real message.
- The conversation ID remains stable for that search/session.
- User and Hamlet messages are inserted incrementally; the full history is not reloaded after each message.
- Assistant messages store `model_used`, which is the actual Gemini model returned by V1.1 fallback handling.
- Current structured intent, preferred model and last model used are updated on the conversation row.
- Recommendations are stored as MAL IDs plus compact display/recommendation metadata. Full catalog payloads and poster binaries are not duplicated.
- Navigation away from Discover is safe because returning to Hamlet restores the current active conversation from Supabase.

## AI title and description

The existing Hamlet model request now also returns `conversationMetadata` in the same structured response. This does **not** add another Gemini call.

Hamlet returns metadata only when enough context exists or when the meaning materially changes. The frontend persists it only when `title_source != user`.

Once the user edits title/description in Conversation History, `title_source=user`; both frontend and Edge Function rules protect it from automatic overwrite.

## Conversation History

History is ordered by `last_accessed_at DESC` and shows title, description, created date, last accessed date and access count.

Opening a history item restores its messages, intent, preferred/last model and live recommendations. `touch_hamlet_conversation()` increments `access_count`, updates `last_accessed_at`, and marks the selected conversation active.

`Continue Last Conversation` opens the most recently accessed conversation. If that conversation is already active in the UI, no duplicate state is created.

`New Conversation` archives the current active context and clears the visible workspace. A new database row is not created until the user sends a real message.

## Watched / Needs Classification

Recommendation cards use the existing Personal Catalog persistence. The action dialog offers:

- Already classified -> category `watched`
- Needs classification -> category `needs-classification`

Existing Personal Works are updated rather than duplicated. The resulting action is also recorded in the recommendation metadata for future Personal Knowledge use.

## Compact recommendation UI

V1.2 replaces the large poster cards in Hamlet with compact horizontal cards prioritizing poster, title, score, year, format, episodes, short match explanation and quick action. Desktop shows two compact cards per row; mobile collapses to one.

## PDF exports

Conversation History exposes three modes:

1. Conversation only
2. Conversation + Recommendations
3. Recommendations only

Hamlet PDFs use conversational left/right bubbles and compact recommendation cards. Poster images are loaded on export when CORS permits; export remains functional without an image.

`src/pdfUtils.ts` centralizes the global footer:

> AnimeFinder created by Leonardo Camargo Rossato / LCR Portfolio

Both linked names point to:

`https://leonardocamargorossato.github.io/LCR-SolutionsArchitecture-IA-Quantum/#/`

## Database

Tables:

- `animefinder.hamlet_conversations`
- `animefinder.hamlet_messages`
- `animefinder.hamlet_recommendations`

All three use RLS with `auth.uid() = user_id`. Indexes cover user/history ordering, conversation message ordering and recommendation lookup.

## V1.1 reliability preserved

Preferred/default model remains `gemini-3.5-flash-lite` with fallback:

1. gemini-3.5-flash-lite
2. gemini-3.1-flash-lite
3. gemini-3.6-flash
4. gemini-3.8-flash

Manual selection changes only the first preferred model; fallback remains enabled. The actual successful model is returned to the UI and stored on the assistant message.

## Deployment

Apply the database migration, then redeploy the Edge Function because its structured output now includes conversation metadata.

```bash
supabase db push
supabase functions deploy hamlet-ai
```

`GEMINI_API_KEY` remains the only required Gemini secret. No service-role key or Gemini key is sent to the browser.

## Manual acceptance test

1. Apply migration and redeploy `hamlet-ai`.
2. Open Discover -> Hamlet AI.
3. Send a real search; confirm Conversation History receives one conversation automatically.
4. Open Anime Details, navigate elsewhere, return to Hamlet; confirm messages restore.
5. Refresh browser; confirm active conversation restores.
6. Confirm AI title/description appears once enough context exists.
7. Edit title; continue chatting; confirm custom title is not overwritten.
8. Start New Conversation; confirm previous conversation remains in history.
9. Continue an older conversation; confirm access metadata changes.
10. Mark one recommendation as Needs classification and verify Personal Catalog.
11. Export all three PDF modes.
12. Trigger/observe V1.1 model fallback and confirm the actual model is retained.
