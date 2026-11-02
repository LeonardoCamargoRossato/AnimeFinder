import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { exportHamletConversationPdf, type HamletPdfMode } from './hamletPdf'
import { listHamletConversations, loadHamletConversation, updateHamletConversationMetadata, type HamletConversationSummary } from './hamletPersistence'

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function EditConversationDialog({ row, onClose, onSaved }: { row: HamletConversationSummary; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(row.title)
  const [description, setDescription] = useState(row.description)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function save() {
    setSaving(true); setError('')
    try { await updateHamletConversationMetadata(row.id, title, description); onSaved(); onClose() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update conversation metadata.') }
    finally { setSaving(false) }
  }
  return <div className="hamlet-subdialog-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
    <section className="hamlet-subdialog" role="dialog" aria-modal="true" aria-label="Edit Hamlet conversation">
      <header><div><span className="eyebrow">EDIT CONVERSATION</span><h3>Title and description</h3></div><button onClick={onClose}>×</button></header>
      <label>Conversation title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120}/></label>
      <label>Conversation description<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={360} rows={3}/></label>
      {error && <div className="notice error">{error}</div>}
      <footer><button className="ghost-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></footer>
    </section>
  </div>
}

function PdfMenu({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  async function download(mode: HamletPdfMode) {
    setBusy(true); setOpen(false)
    try { await exportHamletConversationPdf(await loadHamletConversation(conversationId), mode) }
    finally { setBusy(false) }
  }
  return <div className="hamlet-history-pdf-wrap">
    <button className="ghost-button" onClick={() => setOpen((value) => !value)} disabled={busy}>{busy ? 'Preparing PDF…' : 'PDF ▾'}</button>
    {open && <div className="hamlet-history-pdf-menu">
      <button onClick={() => void download('conversation')}>Conversation only</button>
      <button onClick={() => void download('conversation-recommendations')}>Conversation + Recommendations</button>
      <button onClick={() => void download('recommendations')}>Recommendations only</button>
    </div>}
  </div>
}

export default function HamletConversationHistory({ open, onClose, onOpenConversation }: { open: boolean; onClose: () => void; onOpenConversation: (conversationId: string) => void }) {
  const [rows, setRows] = useState<HamletConversationSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [edit, setEdit] = useState<HamletConversationSummary | null>(null)

  async function refresh() {
    setLoading(true); setError('')
    try { setRows(await listHamletConversations()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load Conversation History.') }
    finally { setLoading(false) }
  }
  useEffect(() => { if (open) void refresh() }, [open])
  if (!open) return null

  return createPortal(<div className="hamlet-history-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
    <section className="hamlet-history-modal" role="dialog" aria-modal="true" aria-label="Hamlet Conversation History">
      <header className="hamlet-history-header"><div><span className="eyebrow">HAMLET AI</span><h2>Conversation History</h2><p>Automatically persisted in Supabase. Most recently accessed conversations appear first.</p></div><button onClick={onClose}>×</button></header>
      {loading ? <div className="hamlet-history-empty">Loading conversations…</div> : error ? <div className="notice error">{error}</div> : rows.length ? <div className="hamlet-history-list">
        {rows.map((row) => <article key={row.id} className="hamlet-history-card">
          <div className="hamlet-history-copy"><div className="hamlet-history-title-row"><h3>{row.title}</h3><span className={`hamlet-title-source ${row.titleSource}`}>{row.titleSource === 'user' ? 'User edited' : row.titleSource === 'ai' ? 'AI generated' : 'Pending title'}</span></div><p>{row.description || 'Hamlet will add a short description when the search becomes clear.'}</p><div className="hamlet-history-meta"><span>Created: {dateLabel(row.createdAt)}</span><span>Last accessed: {dateLabel(row.lastAccessedAt)}</span><span>Opened: {row.accessCount} time{row.accessCount === 1 ? '' : 's'}</span></div></div>
          <div className="hamlet-history-actions"><button className="primary-button" onClick={() => { onOpenConversation(row.id); onClose() }}>Continue</button><button className="ghost-button" onClick={() => setEdit(row)}>✎ Edit</button><PdfMenu conversationId={row.id}/></div>
        </article>)}
      </div> : <div className="hamlet-history-empty"><strong>No saved conversations yet</strong><p>Your first real Hamlet conversation will be saved automatically.</p></div>}
    </section>
    {edit && <EditConversationDialog row={edit} onClose={() => setEdit(null)} onSaved={() => void refresh()}/>} 
  </div>, document.body)
}
