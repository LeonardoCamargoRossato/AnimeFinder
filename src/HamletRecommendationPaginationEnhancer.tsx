import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getLastHamletSearchMeta, requestHamletSearchContinuation } from './hamletSearchService'

const PAGE_SIZE = 10
const SEARCH_BATCH_SIZE = 25
const HOST_ATTR = 'data-hamlet-pagination-host'

function createAssistantBubble(text: string, extraClass: string) {
  const message = document.createElement('div')
  message.className = `hamlet-message assistant ${extraClass}`
  const label = document.createElement('span')
  label.textContent = 'Hamlet'
  const paragraph = document.createElement('p')
  paragraph.textContent = text
  message.append(label, paragraph)
  return message
}

function setComposerText(value: string, submit = false) {
  const textarea = document.querySelector<HTMLTextAreaElement>('.hamlet-composer textarea')
  const form = textarea?.closest<HTMLFormElement>('form.hamlet-composer')
  if (!textarea || !form) return
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.focus()
  if (submit) window.setTimeout(() => form.requestSubmit(), 0)
}

function isContinuationText(value: string) {
  const text = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  return /^(continue|continuar|continua|pode continuar|continue pesquisando|continuar pesquisando|pesquise mais|buscar mais|busque mais|mais resultados|ver mais)$/.test(text)
}

function addSearchActions(bubble: HTMLElement, hasMore: boolean) {
  if (!hasMore) return
  const actions = document.createElement('div')
  actions.className = 'hamlet-search-decision-actions'

  const continueButton = document.createElement('button')
  continueButton.type = 'button'
  continueButton.textContent = `Continuar pesquisando (+${SEARCH_BATCH_SIZE})`
  continueButton.addEventListener('click', () => {
    requestHamletSearchContinuation()
    setComposerText('continue pesquisando', true)
  })

  const refineButton = document.createElement('button')
  refineButton.type = 'button'
  refineButton.textContent = 'Refinar pesquisa'
  refineButton.addEventListener('click', () => setComposerText('Quero refinar a pesquisa: '))

  actions.append(continueButton, refineButton)
  bubble.append(actions)
}

function ensureSearchProgress() {
  const messages = document.querySelector<HTMLElement>('.hamlet-messages')
  const loading = document.querySelector('.hamlet-recommendations-panel .hamlet-loading')
  if (!messages || !loading) return
  if (messages.querySelector('.hamlet-search-progress[data-active="true"]')) return
  const bubble = createAssistantBubble('Estou pesquisando no catálogo agora. Aguarde um pouquinho enquanto eu comparo um primeiro lote de obras com os seus filtros…', 'hamlet-search-progress')
  bubble.dataset.active = 'true'
  messages.append(bubble)
  messages.scrollTop = messages.scrollHeight
}

function ensureSearchSummary() {
  const messages = document.querySelector<HTMLElement>('.hamlet-messages')
  const grid = document.querySelector<HTMLElement>('.hamlet-results-grid')
  if (!messages || !grid) return
  const cards = Array.from(grid.querySelectorAll<HTMLElement>('.hamlet-compact-card'))
  if (!cards.length) return

  const meta = getLastHamletSearchMeta()
  if (!meta.filteredRecommendations) return
  const topTitle = cards[0].querySelector<HTMLElement>('.hamlet-compact-title')?.textContent?.trim() || 'a primeira opção'
  const why = cards[0].querySelector<HTMLElement>('.hamlet-compact-why')?.textContent?.trim() || 'ela ficou no topo do ranking atual'
  const key = [meta.catalogTotal, meta.loadedCandidates, meta.filteredRecommendations, meta.nextPage, topTitle].join(':')
  if (messages.dataset.hamletSearchSummaryKey === key) return

  messages.querySelectorAll<HTMLElement>('.hamlet-search-progress[data-active="true"]').forEach((node) => { node.dataset.active = 'false' })
  const total = meta.catalogTotal.toLocaleString('pt-BR')
  const loaded = meta.loadedCandidates.toLocaleString('pt-BR')
  const recommended = meta.filteredRecommendations.toLocaleString('pt-BR')
  const remaining = Math.max(0, meta.catalogTotal - meta.loadedCandidates).toLocaleString('pt-BR')
  const text = meta.hasMore
    ? `Olha que legal: encontrei ${total} obras candidatas no catálogo para os filtros atuais. Para não sobrecarregar a API, analisei ${loaded} até agora e ${recommended} ficaram como recomendações. Minha principal sugestão neste lote é ${topTitle}, porque ${why} Ainda há cerca de ${remaining} candidatas para explorar. Você quer que eu continue pesquisando em lotes de ${SEARCH_BATCH_SIZE} ou prefere refinar a pesquisa? Se continuar, pode levar um tempo até percorrermos tudo.`
    : `Concluí a pesquisa: o catálogo tinha ${total} obras candidatas para os filtros atuais. Analisei ${loaded} e ${recommended} ficaram como recomendações. Minha principal sugestão é ${topTitle}, porque ${why}`
  const bubble = createAssistantBubble(text, 'hamlet-search-summary')
  addSearchActions(bubble, meta.hasMore)
  messages.append(bubble)
  messages.dataset.hamletSearchSummaryKey = key
  messages.scrollTop = messages.scrollHeight
}

export default function HamletRecommendationPaginationEnhancer() {
  const [grid, setGrid] = useState<HTMLElement | null>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [page, setPage] = useState(1)
  const [count, setCount] = useState(0)
  const [signature, setSignature] = useState('')

  useEffect(() => {
    const root = document.getElementById('root')
    if (!root) return

    const markContinuationFromComposer = () => {
      const textarea = document.querySelector<HTMLTextAreaElement>('.hamlet-composer textarea')
      if (textarea && isContinuationText(textarea.value)) requestHamletSearchContinuation()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key === 'Enter' && !event.shiftKey && target?.matches('.hamlet-composer textarea')) markContinuationFromComposer()
    }
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.hamlet-composer button[type="submit"]')) markContinuationFromComposer()
    }
    root.addEventListener('keydown', onKeyDown, true)
    root.addEventListener('click', onClick, true)

    const sync = () => {
      ensureSearchProgress()
      ensureSearchSummary()
      const nextGrid = document.querySelector<HTMLElement>('.hamlet-results-grid')
      if (!nextGrid) {
        setGrid(null)
        setHost(null)
        setCount(0)
        setSignature('')
        setPage(1)
        return
      }
      const panel = nextGrid.closest<HTMLElement>('.hamlet-recommendations-panel')
      if (!panel) return
      let nextHost = panel.querySelector<HTMLElement>(`[${HOST_ATTR}]`)
      if (!nextHost) {
        nextHost = document.createElement('div')
        nextHost.setAttribute(HOST_ATTR, 'true')
        nextHost.className = 'hamlet-pagination-host'
        nextGrid.after(nextHost)
      }
      const cards = Array.from(nextGrid.querySelectorAll<HTMLElement>('.hamlet-compact-card'))
      const nextCount = cards.length
      const nextSignature = cards.slice(0, 3).map((card) => card.querySelector('.hamlet-compact-title')?.textContent?.trim() ?? '').join('|') + `:${nextCount}`
      setGrid((current) => current === nextGrid ? current : nextGrid)
      setHost((current) => current === nextHost ? current : nextHost)
      setCount((current) => current === nextCount ? current : nextCount)
      setSignature((current) => current === nextSignature ? current : nextSignature)
      setPage((current) => Math.min(Math.max(1, current), Math.max(1, Math.ceil(nextCount / PAGE_SIZE))))
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      root.removeEventListener('keydown', onKeyDown, true)
      root.removeEventListener('click', onClick, true)
    }
  }, [])

  useEffect(() => {
    if (!grid) return
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('.hamlet-compact-card'))
    const start = (page - 1) * PAGE_SIZE
    const end = start + PAGE_SIZE
    cards.forEach((card, index) => { card.style.display = index >= start && index < end ? '' : 'none' })
    grid.scrollTop = 0
  }, [grid, page, count, signature])

  if (!grid || !host || count === 0) return null
  const meta = getLastHamletSearchMeta()
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const start = (page - 1) * PAGE_SIZE + 1
  const end = Math.min(page * PAGE_SIZE, count)

  return createPortal(
    <div className="hamlet-pagination-shell">
      <div className="hamlet-search-coverage">
        <strong>{meta.catalogTotal ? `${meta.catalogTotal.toLocaleString('pt-BR')} candidatas no catálogo` : `${count.toLocaleString('pt-BR')} recomendações`}</strong>
        <span>{meta.loadedCandidates.toLocaleString('pt-BR')} analisadas · {count.toLocaleString('pt-BR')} recomendações carregadas{meta.hasMore ? ` · próximo lote disponível` : ' · pesquisa concluída'}</span>
      </div>
      <div className="hamlet-pagination-controls" aria-label="Paginação das recomendações">
        <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>‹ Anterior</button>
        <span>Mostrando {start}–{end} · Página {page} de {pages}</span>
        <button type="button" onClick={() => setPage((value) => Math.min(pages, value + 1))} disabled={page >= pages}>Próxima ›</button>
      </div>
    </div>,
    host,
  )
}
