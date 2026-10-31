# AnimeFinder — Supabase Google OAuth setup

AnimeFinder uses Google only as the identity provider. Supabase Auth owns the session, and PostgreSQL RLS is the security boundary for private catalog data.

Authorized application account:

`leo.se.rosato@gmail.com`

## 1. Supabase Data API

In the Supabase Dashboard, open the Data API / API settings and add this schema to **Exposed schemas**:

`animefinder`

Run `supabase/schema.sql` in the SQL Editor after this repository update. The script creates/updates the table, views, trigger, grants and RLS policies. RLS checks both the authenticated Supabase UUID and the authorized email claim.

## 2. Supabase Auth URL Configuration

Open **Authentication → URL Configuration**.

Set **Site URL** to:

`https://leonardocamargorossato.github.io/AnimeFinder/`

Add these **Redirect URLs**:

- `https://leonardocamargorossato.github.io/AnimeFinder/`
- `http://localhost:5173/AnimeFinder/`

The application deliberately redirects OAuth back to the Vite base URL. Supabase restores the session there, and the HashRouter sends the authorized user to `#/app`.

## 3. Google OAuth client

Open Google Auth Platform / Google Cloud Console and create an OAuth Client ID with application type **Web application**.

### Authorized JavaScript origins

Add:

- `https://leonardocamargorossato.github.io`
- `http://localhost:5173`

Do not include `/AnimeFinder/` in the JavaScript origin. Origins contain protocol + host + optional port only.

### Authorized redirect URI

In Supabase, open **Authentication → Sign In / Providers → Google** and copy the callback URL shown by Supabase.

Add that exact callback URL to Google's **Authorized redirect URIs**. It has the form:

`https://<your-project-ref>.supabase.co/auth/v1/callback`

Use the exact value shown in your Supabase project rather than typing a project reference manually.

## 4. Enable Google in Supabase

In **Authentication → Sign In / Providers → Google**:

1. Enable Google.
2. Paste the Google OAuth **Client ID**.
3. Paste the Google OAuth **Client Secret**.
4. Save.

The Google Client Secret stays only in Supabase/Google configuration. Never place it in the GitHub repository or Vite environment.

## 5. GitHub Actions secrets

AnimeFinder only needs these repository secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Do not add a service-role key or Google Client Secret to the frontend.

## 6. Local development

Create a local `.env.local` that is not committed:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
```

Then run:

```bash
npm install
npm run dev
```

Open the URL Vite prints for `/AnimeFinder/`.

## 7. Expected production flow

`/AnimeFinder/#/`
→ Enter AnimeFinder
→ `/AnimeFinder/#/login`
→ Continue with Google
→ Google
→ Supabase callback
→ `/AnimeFinder/`
→ Supabase restores session
→ authorized email check
→ `/AnimeFinder/#/app`

An authenticated account other than `leo.se.rosato@gmail.com` receives Access Denied in the frontend, while database RLS independently rejects access to `animefinder.watched_anime`.
