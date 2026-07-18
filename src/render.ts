import type { AiSummaries, Bill, Briefing, Jurisdiction } from './types'
import { billKey } from './types'

const STATUS_TONE: Record<string, string> = {
  'Signed Into Law': 'signed',
  'Passed Both Chambers': 'moving',
  'In Progress': 'moving',
  Vetoed: 'dead',
  Failed: 'dead',
}

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export function formatDate(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return dateFmt.format(new Date(y, m - 1, d))
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

function statusChip(bill: Bill): HTMLElement {
  const tone = STATUS_TONE[bill.status] ?? 'neutral'
  const chip = el('span', `status-chip status-${tone}`, bill.status)
  return chip
}

function summaryBlock(label: string, text: string, variant: string): HTMLElement {
  const details = el('details', `bill-summary summary-${variant}`)
  const summary = el('summary', 'summary-label', label)
  const body = el('p', 'summary-text', text)
  details.append(summary, body)
  return details
}

export function renderBill(bill: Bill, ai: AiSummaries): HTMLElement {
  const card = el('article', 'bill-card')
  card.dataset.status = bill.status
  card.dataset.search = `${bill.number} ${bill.title} ${bill.subjects.join(' ')} ${bill.officialSummary ?? ''}`.toLowerCase()

  const head = el('div', 'bill-head')
  const numberLine = el('p', 'bill-number')
  numberLine.append(el('span', 'bill-number-text', bill.number))
  if (bill.session) numberLine.append(el('span', 'bill-session', bill.session))
  head.append(numberLine, statusChip(bill))
  card.append(head)

  card.append(el('h3', 'bill-title', bill.title))

  if (bill.lastAction) {
    const action = el('p', 'bill-action')
    action.append(el('span', 'bill-action-date', formatDate(bill.lastActionDate)))
    action.append(document.createTextNode(` — ${bill.lastAction}`))
    card.append(action)
  }

  const aiEntry = ai[billKey(bill)]
  if (aiEntry) card.append(summaryBlock('Plain English', aiEntry.summary, 'plain'))
  if (bill.officialSummary)
    card.append(summaryBlock('Official summary', bill.officialSummary, 'official'))

  const links = el('nav', 'bill-links')
  links.setAttribute('aria-label', `Links for ${bill.number}`)
  links.append(link(bill.link, 'Bill page'))
  if (bill.textLink) links.append(link(bill.textLink, 'Full text'))
  links.append(link(bill.legiscanLink, 'LegiScan'))
  card.append(links)

  return card
}

function link(href: string, label: string): HTMLAnchorElement {
  const a = el('a', 'bill-link', label)
  a.href = href
  a.target = '_blank'
  a.rel = 'noopener'
  return a
}

export function renderSection(
  index: number,
  title: string,
  slug: string,
  bills: Bill[],
  ai: AiSummaries,
  note?: string,
): HTMLElement {
  const section = el('section', 'jurisdiction')
  section.id = slug
  section.setAttribute('aria-labelledby', `${slug}-heading`)

  const heading = el('h2', 'jurisdiction-heading')
  heading.id = `${slug}-heading`
  heading.append(el('span', 'jurisdiction-index', String(index).padStart(2, '0')))
  heading.append(el('span', 'jurisdiction-name', title))
  heading.append(el('span', 'jurisdiction-count', `${bills.length} bills`))
  section.append(heading)
  if (note) section.append(el('p', 'jurisdiction-note', note))

  const list = el('div', 'bill-list')
  for (const bill of bills) list.append(renderBill(bill, ai))
  section.append(list)

  const empty = el('p', 'jurisdiction-empty', 'No bills match the current filters.')
  empty.hidden = true
  section.append(empty)
  return section
}

export function renderNav(container: HTMLElement, sections: { slug: string; label: string }[]) {
  for (const { slug, label } of sections) {
    const a = el('a', 'section-nav-link', label)
    a.href = `#${slug}`
    container.append(a)
  }
}

export function renderBriefing(briefing: Briefing) {
  const host = document.getElementById('briefing')!
  const body = host.querySelector('.briefing-body')!
  body.append(el('p', 'briefing-headline', briefing.headline))
  for (const para of briefing.paragraphs) body.append(el('p', 'briefing-para', para))
  body.append(el('p', 'briefing-date', formatDate(briefing.date)))
  host.hidden = false
}

export function elsewhereGroups(bills: Bill[]): Jurisdiction[] {
  const byState = new Map<string, Bill[]>()
  for (const bill of bills) {
    const list = byState.get(bill.jurisdiction) ?? []
    list.push(bill)
    byState.set(bill.jurisdiction, list)
  }
  return [...byState.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([code, stateBills]) => ({ code, name: code, bills: stateBills }))
}
