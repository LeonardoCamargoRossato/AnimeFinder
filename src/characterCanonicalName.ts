import { loadPersonalKnowledge, savePersonalKnowledge } from './aiPersonalKnowledge'
import type { ManagedCatalogWork } from './personalCatalogManager'

export async function applyConfirmedCharacterCanonicalName(
  work: ManagedCatalogWork,
  personalCharacterId: string,
  canonicalName: string,
) {
  const profile = await loadPersonalKnowledge(work.id, work.primaryMalId)
  const current = profile.characters.find((row) => row.id === personalCharacterId)
  if (!current || !canonicalName.trim() || current.name.trim() === canonicalName.trim()) return current?.name ?? null

  const originalName = current.name
  const next = {
    ...profile,
    characters: profile.characters.map((row) => row.id === personalCharacterId ? { ...row, name: canonicalName.trim() } : row),
  }
  await savePersonalKnowledge(next)
  window.dispatchEvent(new CustomEvent('animefinder:personal-knowledge-updated', {
    detail: { workId: work.id, characterId: personalCharacterId, canonicalName: canonicalName.trim(), originalName },
  }))
  return originalName
}
