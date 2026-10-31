# AnimeFinder

AnimeFinder is a personal anime discovery and catalog application built with React, TypeScript and Vite. It searches MyAnimeList data through Jikan, supports reusable filters, tracks watched anime and provides a review-first import workflow for existing title lists.

## Features

- Search anime by known titles through Jikan
- Filter by score, episodes, genre, year, type, status and watched state
- Persistent personal watched catalog
- Anime details with known title variants
- Review-first list import with manual match confirmation
- Light and dark themes
- Responsive GitHub Pages deployment
- Provider abstraction ready for future anime data sources
- Supabase-ready catalog storage with secure Row Level Security

## Architecture

The UI depends on the `AnimeProvider` interface rather than Jikan directly. `JikanProvider` is the current implementation. Future providers can implement the same interface and be selected without rebuilding the frontend.

Personal catalog access is isolated in `src/catalog.ts`. If Supabase is not configured or the user is not authenticated, AnimeFinder uses browser `localStorage`. Once Supabase is configured and the user signs in, the same application flow uses the `watched_anime` table.

## Local development

```bash
npm install
npm run dev
```

## Supabase setup

1. Create a Supabase project.
2. Open the SQL Editor and run `supabase/schema.sql`.
3. In Authentication, keep email sign-in enabled.
4. Add the GitHub Pages URL to the allowed redirect URLs:
   `https://leonardocamargorossato.github.io/AnimeFinder/`
5. In this GitHub repository, open **Settings → Secrets and variables → Actions**.
6. Add repository secrets:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
7. Re-run the Pages workflow or push a new commit.
8. Open AnimeFinder → Settings and sign in with the email account you want to own the catalog.

Do not use a Supabase service-role key in the frontend or GitHub Pages build.

## Deployment

Pushes to `main` trigger `.github/workflows/deploy.yml`, which builds the Vite application and deploys `dist/` to GitHub Pages.

Public site:

`https://leonardocamargorossato.github.io/AnimeFinder/`

## Data source

Anime discovery data is provided by Jikan, an unofficial API for public MyAnimeList data. AnimeFinder stores MAL IDs as provider identifiers whenever a confirmed match is available; titles are treated as searchable aliases rather than primary identifiers.
