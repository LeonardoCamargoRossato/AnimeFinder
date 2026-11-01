import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

async function exportVisibleCatalogPdf() {
  const table = document.querySelector('.catalog-v2-table') as HTMLTableElement | null
  if (!table) return
  const moduleUrl = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm'
  const pdfModule = await import(/* @vite-ignore */ moduleUrl) as { jsPDF: new (options?: Record<string, unknown>) => any }
  const doc = new pdfModule.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text('AnimeFinder — Personal Catalog', 12, 13)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  const rows = Array.from(table.querySelectorAll('tbody tr'))
  let y = 23
  for (const row of rows) {
    if (y > 198) { doc.addPage(); y = 14 }
    const cells = Array.from(row.querySelectorAll('td')).map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim())
    const rank = cells[0] || '—'
    const anime = cells[2] || cells[1] || '—'
    const score = cells[3] || '—'
    const line = `${rank}  ${anime}  ${score}`.slice(0, 150)
    doc.text(line, 12, y)
    y += 6
  }
  doc.save('AnimeFinder-Personal-Catalog.pdf')
}

export default function CatalogPdfMenuEnhancer() {
  const location = useLocation()
  useEffect(() => {
    if (location.pathname !== '/app/my-anime') return
    const sync = () => {
      const menu = document.querySelector('.catalog-export-menu') as HTMLElement | null
      if (!menu || menu.querySelector('[data-catalog-pdf-v2]')) return
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.catalogPdfV2 = 'true'
      button.textContent = 'Download PDF'
      button.addEventListener('click', () => { void exportVisibleCatalogPdf() })
      menu.appendChild(button)
    }
    sync()
    const observer = new MutationObserver(sync)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [location.pathname])
  return null
}
