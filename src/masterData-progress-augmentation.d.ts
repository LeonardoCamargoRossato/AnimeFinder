import './masterData'

declare module './masterData' {
  interface MetadataBackfillProgress {
    haltedReason?: string
  }
}

export {}
