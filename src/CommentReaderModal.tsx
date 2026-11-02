import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import SynopsisAudioPlayer from './SynopsisAudioPlayer'

export default function CommentReaderModal({ workName, text, onClose }: {
  workName: string
  text: string
  onClose: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [listenOpen, setListenOpen] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (listenOpen) { setListenOpen(false); return }
      if (expanded) { setExpanded(false); return }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, listenOpen, onClose])

  return createPortal(
    <div className="comment-reader-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <section className={expanded ? 'comment-reader-modal expanded' : 'comment-reader-modal'} role="dialog" aria-modal="true" aria-label={`My Comment — ${workName}`}>
        <header className="comment-reader-header">
          <div><span className="eyebrow">MY COMMENT</span><h2>{workName}</h2></div>
          <div className="comment-reader-header-actions">
            <button className="ghost-button compact" type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? '🗗 Restore' : '⛶ Expand'}</button>
            <button className="comment-reader-close" type="button" onClick={onClose} aria-label="Close">×</button>
          </div>
        </header>
        <div className="comment-reader-body"><p>{text || 'No saved personal comment yet.'}</p></div>
        <footer className="comment-reader-footer">
          <button className="primary-button" type="button" disabled={!text.trim()} onClick={() => setListenOpen((value) => !value)}>{listenOpen ? 'Hide audio controls' : '🔊 Listen'}</button>
          <button className="ghost-button" type="button" onClick={onClose}>Close</button>
        </footer>
        {listenOpen && text.trim() && <div className="comment-reader-audio"><SynopsisAudioPlayer text={text} lang="pt-BR" languageLabel="Personal comment" onClose={() => setListenOpen(false)} /></div>}
      </section>
    </div>,
    document.body,
  )
}
