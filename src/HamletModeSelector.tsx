export type HamletMode = 'discovery' | 'self-knowledge'

type Props = {
  mode: HamletMode
  onChange: (mode: HamletMode) => void
}

export default function HamletModeSelector({ mode, onChange }: Props) {
  return (
    <div className="hamlet-dual-mode-selector" role="tablist" aria-label="Hamlet AI mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'discovery'}
        className={mode === 'discovery' ? 'active' : ''}
        onClick={() => onChange('discovery')}
      >
        Anime Discovery
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'self-knowledge'}
        className={mode === 'self-knowledge' ? 'active' : ''}
        onClick={() => onChange('self-knowledge')}
      >
        Self-Knowledge
      </button>
    </div>
  )
}
