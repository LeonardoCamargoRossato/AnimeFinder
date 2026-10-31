# AnimeFinder

## 🌐 Live Site

👉 **[Open AnimeFinder](https://leonardocamargorossato.github.io/AnimeFinder/)**

AnimeFinder is a private personal anime discovery and catalog application built with React, TypeScript and Vite. It searches MyAnimeList data through Jikan, supports reusable filters, tracks watched anime and provides a review-first import workflow for existing title lists.

## Features

- Public AnimeFinder landing page
- Google OAuth through Supabase Auth
- Private application access restricted to the authorized account
- Search anime by known titles through Jikan
- Filter by score, episodes, genre, year, type, status and watched state
- Persistent watched catalog in Supabase
- Anime details with known title variants
- Review-first list import with manual match confirmation
- Light and dark themes
- Responsive GitHub Pages deployment
- Provider abstraction ready for future anime data sources

## Architecture

Anime discovery metadata:

`Jikan / MyAnimeList → AnimeProvider → AnimeFinder UI`

Authentication and personal persistence:

`Google → Supabase Auth → AnimeFinder authorization → animefinder.watched_anime`

The UI depends on the `AnimeProvider` interface rather than Jikan directly. `JikanProvider` is the current implementation. Future providers can implement the same interface without rebuilding the application screens.

Personal catalog access is isolated in `src/catalog.ts`. Supabase is the authoritative watched-anime database. Browser storage is used only for non-sensitive UI preferences such as the light/dark theme.

The PostgreSQL data lives under the dedicated `animefinder` schema rather than `public`.

## Local development

Create `.env.local`:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
```

Then run:

```bash
npm install
npm run dev
```

## Supabase and Google OAuth setup

1. Run `supabase/schema.sql` in Supabase SQL Editor.
2. Add `animefinder` to the Data API exposed schemas.
3. Enable Google in Supabase Auth.
4. Configure the Google OAuth client and Supabase redirect URLs.
5. Add these GitHub Actions repository secrets:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
6. Push to `main` or re-run the Pages workflow.

Detailed setup instructions:

`docs/SUPABASE_GOOGLE_OAUTH.md`

Never commit a Supabase service-role key, Google Client Secret or OAuth secret to this repository.

## Security

The frontend checks the signed-in email for routing and UX, but it is not the security boundary. The `animefinder.watched_anime` RLS policies independently require both:

- the authenticated Supabase `user_id`
- the authorized email claim

## Deployment

Pushes to `main` trigger `.github/workflows/deploy.yml`, which builds the Vite application and deploys `dist/` to GitHub Pages.

## Data source

Anime discovery data is provided by Jikan, an unofficial API for public MyAnimeList data. AnimeFinder stores MAL IDs as provider identifiers whenever a confirmed match is available; titles are treated as searchable aliases rather than primary identifiers.
