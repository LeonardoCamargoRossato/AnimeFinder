import { supabase } from './supabase'

export async function handleSupabaseAuthCallback() {
  if (!supabase || typeof window === 'undefined') return

  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  if (!code) return

  const flowId = url.searchParams.get('sb_flow_id')
  const { error } = await supabase.auth.exchangeCodeForSession(
    code,
    flowId ? { flowId } : undefined,
  )

  if (error) {
    console.error('AnimeFinder OAuth callback failed:', error)
    return
  }

  url.searchParams.delete('code')
  url.searchParams.delete('sb_flow_id')
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
}
