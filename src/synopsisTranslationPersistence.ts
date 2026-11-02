import { isSupabaseConfigured, supabase } from './supabase'

export interface SynopsisTranslationPersistenceAudit {
  originalCount: number
  ptBrCount: number
  missingPtBrCount: number
  failedRows: number
}

export async function auditSynopsisTranslationPersistence(): Promise<SynopsisTranslationPersistenceAudit> {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.')
  const { data: userData, error: userError } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (userError || !userId) throw new Error('Sign in before verifying synopsis translations.')

  const { data, error } = await supabase
    .from('personal_work_synopsis')
    .select('personal_work_id,synopsis_original,synopsis_pt_br,status')
    .eq('user_id', userId)

  if (error) throw new Error(`Could not verify PT-BR synopsis persistence: ${error.message}`)

  let originalCount = 0
  let ptBrCount = 0
  let failedRows = 0
  for (const row of data ?? []) {
    const hasOriginal = Boolean(row.synopsis_original?.trim())
    const hasPtBr = Boolean(row.synopsis_pt_br?.trim())
    if (hasOriginal) originalCount += 1
    if (hasPtBr) ptBrCount += 1
    if (hasOriginal && !hasPtBr && row.status === 'failed') failedRows += 1
  }

  return {
    originalCount,
    ptBrCount,
    missingPtBrCount: Math.max(0, originalCount - ptBrCount),
    failedRows,
  }
}
