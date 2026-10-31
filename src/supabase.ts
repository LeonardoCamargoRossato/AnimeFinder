import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey)

// AnimeFinder is a client-only SPA hosted on GitHub Pages.
// Remove stale PKCE callback codes left by previous failed attempts before
// initializing the implicit browser OAuth flow.
if (typeof window !== 'undefined') {
  const url = new URL(window.location.href)
  if (url.searchParams.has('code')) {
    url.searchParams.delete('code')
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
  }
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseKey!, {
      db: {
        schema: 'animefinder',
      },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'implicit',
      },
    })
  : null

export function getAuthRedirectUrl() {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
  return `${window.location.origin}${base}`
}
