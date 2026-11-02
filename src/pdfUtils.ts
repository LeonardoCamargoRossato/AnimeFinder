export const ANIMEFINDER_PORTFOLIO_URL = 'https://leonardocamargorossato.github.io/LCR-SolutionsArchitecture-IA-Quantum/#/'

export async function createAnimeFinderPdf(options: Record<string, unknown> = {}) {
  const moduleUrl = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm'
  const pdfModule = await import(/* @vite-ignore */ moduleUrl) as { jsPDF: new (options?: Record<string, unknown>) => any }
  return new pdfModule.jsPDF(options)
}

export function applyAnimeFinderPdfFooter(doc: any) {
  const pages = typeof doc.getNumberOfPages === 'function' ? doc.getNumberOfPages() : 1
  const text = 'AnimeFinder created by '
  const creator = 'Leonardo Camargo Rossato'
  const divider = ' / '
  const portfolio = 'LCR Portfolio'
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    const width = doc.internal.pageSize.getWidth()
    const height = doc.internal.pageSize.getHeight()
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(100, 96, 120)
    const total = `${text}${creator}${divider}${portfolio}`
    const totalWidth = doc.getTextWidth(total)
    let x = (width - totalWidth) / 2
    const y = height - 5
    doc.text(text, x, y); x += doc.getTextWidth(text)
    if (typeof doc.textWithLink === 'function') doc.textWithLink(creator, x, y, { url: ANIMEFINDER_PORTFOLIO_URL })
    else doc.text(creator, x, y)
    x += doc.getTextWidth(creator)
    doc.text(divider, x, y); x += doc.getTextWidth(divider)
    if (typeof doc.textWithLink === 'function') doc.textWithLink(portfolio, x, y, { url: ANIMEFINDER_PORTFOLIO_URL })
    else doc.text(portfolio, x, y)
  }
}
