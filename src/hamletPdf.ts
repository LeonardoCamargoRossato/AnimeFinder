import type { HamletConversationSnapshot, HamletStoredRecommendation } from './hamletPersistence'
import { applyAnimeFinderPdfFooter, createAnimeFinderPdf } from './pdfUtils'

export type HamletPdfMode = 'conversation' | 'conversation-recommendations' | 'recommendations'

function prettyDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

async function imageData(url: unknown) {
  if (typeof url !== 'string' || !url) return null
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch { return null }
}

function ensureSpace(doc: any, y: number, required: number, top = 18) {
  const height = doc.internal.pageSize.getHeight()
  if (y + required <= height - 14) return y
  doc.addPage()
  return top
}

function drawHeader(doc: any, snapshot: HamletConversationSnapshot, subtitle?: string) {
  const width = doc.internal.pageSize.getWidth()
  doc.setFillColor(30, 23, 56)
  doc.rect(0, 0, width, 26, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17)
  doc.text(snapshot.conversation.title || 'Hamlet AI Conversation', 14, 11)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  const description = snapshot.conversation.description || subtitle || 'AnimeFinder conversational anime discovery'
  doc.text(doc.splitTextToSize(description, width - 28), 14, 17)
  doc.setTextColor(125, 118, 148); doc.setFontSize(7.5)
  doc.text(`Created ${prettyDate(snapshot.conversation.createdAt)} · Last accessed ${prettyDate(snapshot.conversation.lastAccessedAt)}`, 14, 31)
  return 38
}

function drawConversation(doc: any, snapshot: HamletConversationSnapshot, startY: number) {
  const width = doc.internal.pageSize.getWidth()
  let y = startY
  for (const message of snapshot.messages) {
    const isUser = message.role === 'user'
    const boxWidth = Math.min(142, width * 0.68)
    const textWidth = boxWidth - 12
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    const lines = doc.splitTextToSize(message.content, textWidth)
    const height = Math.max(18, lines.length * 4.4 + 11)
    y = ensureSpace(doc, y, height + 5)
    const x = isUser ? width - 14 - boxWidth : 14
    if (isUser) doc.setFillColor(101, 72, 210)
    else doc.setFillColor(40, 32, 68)
    doc.roundedRect(x, y, boxWidth, height, 3, 3, 'F')
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5)
    doc.text(isUser ? 'YOU' : 'HAMLET', x + 6, y + 6)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    doc.text(lines, x + 6, y + 11)
    if (!isUser && message.modelUsed) {
      doc.setTextColor(175, 166, 205); doc.setFontSize(6)
      doc.text(message.modelUsed, x + 6, y + height - 3)
    }
    y += height + 5
  }
  return y
}

async function drawRecommendations(doc: any, recommendations: HamletStoredRecommendation[], startY: number) {
  const width = doc.internal.pageSize.getWidth()
  let y = ensureSpace(doc, startY, 18)
  doc.setTextColor(45, 36, 77); doc.setFont('helvetica', 'bold'); doc.setFontSize(14)
  doc.text('Recommendations', 14, y); y += 8
  const gap = 5
  const margin = 14
  const cardWidth = (width - margin * 2 - gap) / 2
  const cardHeight = 40
  for (let i = 0; i < recommendations.length; i += 2) {
    y = ensureSpace(doc, y, cardHeight + 5)
    for (let column = 0; column < 2; column += 1) {
      const row = recommendations[i + column]
      if (!row) continue
      const meta = row.metadata ?? {}
      const x = margin + column * (cardWidth + gap)
      doc.setFillColor(247, 245, 253); doc.setDrawColor(211, 203, 235)
      doc.roundedRect(x, y, cardWidth, cardHeight, 2.5, 2.5, 'FD')
      const poster = await imageData(meta.posterUrl)
      let textX = x + 5
      if (poster) {
        try { doc.addImage(poster, 'JPEG', x + 4, y + 4, 22, 31); textX = x + 30 } catch { /* keep text-only */ }
      }
      const available = x + cardWidth - textX - 4
      doc.setTextColor(34, 29, 48); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
      doc.text(doc.splitTextToSize(String(meta.title ?? `MAL #${row.malId}`), available), textX, y + 8)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(92, 83, 116)
      const facts = [meta.score != null ? `★ ${meta.score}` : null, meta.year ?? null, meta.type ?? null, meta.episodes ? `${meta.episodes} ep` : null].filter(Boolean).join(' · ')
      doc.text(String(facts || `MAL #${row.malId}`), textX, y + 18)
      const why = String(meta.whyMatches ?? '')
      if (why) doc.text(doc.splitTextToSize(why, available).slice(0, 3), textX, y + 24)
    }
    y += cardHeight + 5
  }
  return y
}

export async function exportHamletConversationPdf(snapshot: HamletConversationSnapshot, mode: HamletPdfMode) {
  const doc = await createAnimeFinderPdf({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  let y = drawHeader(doc, snapshot)
  if (mode !== 'recommendations') y = drawConversation(doc, snapshot, y)
  if (mode !== 'conversation') y = await drawRecommendations(doc, snapshot.recommendations, y + 3)
  void y
  applyAnimeFinderPdfFooter(doc)
  const suffix = mode === 'conversation' ? 'Conversation' : mode === 'recommendations' ? 'Recommendations' : 'Conversation-Recommendations'
  const safeTitle = (snapshot.conversation.title || 'Hamlet').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 50)
  doc.save(`AnimeFinder-Hamlet-${safeTitle}-${suffix}.pdf`)
}
