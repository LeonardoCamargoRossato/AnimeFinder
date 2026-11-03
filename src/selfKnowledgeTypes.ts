export type SelfKnowledgeQueryRoute = 'structured' | 'statistical' | 'semantic' | 'hybrid' | 'contradiction'
export type SelfKnowledgeDomain = 'anime' | 'character' | 'preference'

export interface SelfKnowledgeConversationMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  modelUsed?: string
  route?: SelfKnowledgeQueryRoute
  evidenceSummary?: SelfKnowledgeEvidenceSummary
  index?: SelfKnowledgeIndexCoverage
}

export interface SelfKnowledgeIndexCoverage {
  totalDerivedDocuments: number
  indexedDocuments: number
  pendingEmbeddings: number
  embeddedThisRequest: number
}

export interface SelfKnowledgeEvidenceSummary {
  totalWorks: number
  rankedWorks: number
  semanticMatches: number
  rankGroups: Array<{ label: string; sampleSize: number }>
  possibleContradictions: number
}

export interface SelfKnowledgeAnswer {
  reply: string
  route: SelfKnowledgeQueryRoute
  domains: SelfKnowledgeDomain[]
  provider: string
  model?: string
  embedding: {
    provider: string
    model: string
    dimensions: number
  }
  index: SelfKnowledgeIndexCoverage
  evidenceSummary: SelfKnowledgeEvidenceSummary
}

export interface SelfKnowledgeSyncStatus {
  embedding: {
    provider: string
    model: string
    dimensions: number
  }
  sync: {
    status?: {
      documents?: number
      embedded?: number
      anime?: number
      character?: number
      preference?: number
      updatedAt?: string | null
    }
    totalDerivedDocuments: number
    changedDocuments: number
    embeddedThisRequest: number
    pendingEmbeddings: number
    embeddingFailures: number
    removedStaleDocuments: number
  }
}
