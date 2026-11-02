import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { listAnimeComments } from './comments'
import { currentWorkVersion, loadPersonalKnowledge, type PersonalKnowledge } from './aiPersonalKnowledge'
import { findManagedWorkByMalId, type ManagedCatalogWork } from './personalCatalogManager'

type LoadState = 'idle' | 'loading' | 'success' | 'error'

function PersonalKnowledgePanel({ malId }: { malId: number }) {
  const [state, setState] = useState<LoadState>('idle')
  const [knowledge, setKnowledge] = useState<PersonalKnowledge | null>(null)
  const [work, setWork] = useState<ManagedCatalogWork | null>(() => findManagedWorkByMalId(malId))
  const [error, setError] = useState('')
  const [commentExpanded, setCommentExpanded] = useState(false)

  useEffect(() => {
    setState('idle'); setKnowledge(null); setError(''); setCommentExpanded(false); setWork(findManagedWorkByMalId(malId))
  }, [malId])

  async function load() {
    if (!work) { setError('This anime is not linked to a Personal Catalog work yet.'); setState('error'); return }
    setState('loading'); setError(''); setCommentExpanded(false)
    try {
      const comments = await listAnimeComments()
      const fallback = comments.find((row) => row.malId === malId)?.contentText ?? ''
      const data = await loadPersonalKnowledge(work.id, malId, fallback)
      setKnowledge(data); setState('success')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load Personal Knowledge.')
      setState('error')
    }
  }

  function openEditor() {
    if (!work) return
    window.dispatchEvent(new CustomEvent('animefinder:open-personal-knowledge', { detail: { workId: work.id, malId, work } }))
  }

  const comment = knowledge ? currentWorkVersion(knowledge)?.content ?? '' : ''
  const keywords = knowledge?.keywords.filter((row) => row.confirmed).sort((a, b) => a.rank - b.rank) ?? []
  const characters = knowledge?.characters.filter((row) => row.confirmed).sort((a, b) => a.rank - b.rank) ?? []
  const commentNeedsToggle = comment.length > 320 || comment.split(/\n\s*\n/).length > 1

  return <section className="details-v2-deferred-section personal-knowledge-details-section">
    <div className="details-v2-section-heading deferred-heading">
      <div><span className="eyebrow">MY PERSONAL KNOWLEDGE</span><h2>My Personal Knowledge</h2><p>Your personal comments, confirmed keywords and ranked characters for this work.</p></div>
      {state !== 'success' && <button type="button" className="ghost-button deferred-load-button" disabled={state === 'loading'} onClick={load}>{state === 'loading' ? 'Loading…' : state === 'error' ? 'Retry' : 'Load Personal Knowledge'}</button>}
    </div>
    {state === 'loading' && <div className="deferred-loading" role="status"><div className="deferred-loading-row"><span className="spinner" /><strong>Loading Personal Knowledge…</strong></div><div className="deferred-progress"><span /></div><small>This private section loads only when requested.</small></div>}
    {state === 'error' && <div className="notice error">{error}</div>}
    {state === 'success' && knowledge && <div className="personal-knowledge-details-grid">
      <article className="personal-knowledge-details-card comment-card">
        <span>MY COMMENT</span>
        <div className={commentExpanded ? 'personal-knowledge-comment-shell expanded' : 'personal-knowledge-comment-shell'}>
          <p>{comment || 'No saved personal comment yet.'}</p>
        </div>
        {commentNeedsToggle && <button type="button" className="text-button personal-knowledge-comment-toggle" onClick={() => setCommentExpanded((value) => !value)}>{commentExpanded ? 'Show less' : 'Show more'}</button>}
        {knowledge.versions.length > 0 && <small>V{knowledge.currentVersionNumber} · {knowledge.versions.length} version{knowledge.versions.length === 1 ? '' : 's'}</small>}
      </article>
      <article className="personal-knowledge-details-card"><span>KEYWORDS</span>{keywords.length ? <div className="personal-knowledge-ranked-list">{keywords.map((row) => <b key={row.label}>#{row.rank} {row.label}</b>)}</div> : <p>No confirmed keywords yet.</p>}</article>
      <article className="personal-knowledge-details-card"><span>FAVORITE / HIGHLIGHTED CHARACTERS</span>{characters.length ? <div className="personal-knowledge-character-list">{characters.map((row) => <div key={row.id}><b>#{row.rank} {row.name}</b><small>{row.commentVersions.at(-1)?.content ? `${row.commentVersions.at(-1)!.content.slice(0, 120)}${row.commentVersions.at(-1)!.content.length > 120 ? '…' : ''}` : 'No personal comment yet.'}</small></div>)}</div> : <p>No confirmed characters yet.</p>}</article>
      <div className="personal-knowledge-details-actions"><button type="button" className="primary-button" onClick={openEditor}>✨ Open AI Personal Knowledge</button></div>
    </div>}
  </section>
}

export default function PersonalKnowledgeDetailsEnhancer() {
  const location = useLocation()
  const match = location.pathname.match(/^\/app\/anime\/(\d+)$/)
  const analysis = new URLSearchParams(location.search).get('view') === 'analysis'
  const malId = match ? Number(match[1]) : null
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setHost(null)
    if (!malId || analysis) return
    let mounted: HTMLDivElement | null = null
    const sync = () => {
      const related = document.querySelector('.details-v2-related-section') as HTMLElement | null
      if (!related) return
      const parent = related.parentElement
      if (!parent) return
      const existing = parent.querySelector(':scope > .personal-knowledge-details-host') as HTMLDivElement | null
      if (existing) { mounted = existing; setHost(existing); return }
      const next = document.createElement('div')
      next.className = 'personal-knowledge-details-host'
      related.insertAdjacentElement('afterend', next)
      mounted = next; setHost(next)
    }
    sync()
    const observer = new MutationObserver(sync)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { childList: true, subtree: true })
    return () => { observer.disconnect(); mounted?.remove() }
  }, [malId, analysis])

  return host && malId ? createPortal(<PersonalKnowledgePanel malId={malId} />, host) : null
}
