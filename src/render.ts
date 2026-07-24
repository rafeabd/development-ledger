import type {
  AiSummaries,
  AssetClass,
  Bill,
  Briefing,
  Jurisdiction,
  Mechanics,
  NewsItem,
  Opportunities,
  Opportunity,
  OpportunitySignal,
  OpportunityType,
  RegItem,
  Signals,
} from './types'
import { billKey } from './types'

const SIGNAL_LABEL: Record<OpportunitySignal, string> = {
  opportunity: 'Opportunity',
  risk: 'Risk',
  neutral: 'Neutral',
}

const TYPE_LABEL: Record<OpportunityType, string> = {
  incentive: 'Incentive',
  timing: 'Timing',
  'risk-cost': 'Cost / Risk',
}

const ASSET_LABEL: Record<AssetClass, string> = {
  multifamily: 'Multifamily',
  commercial: 'Commercial',
  lending: 'Lending',
  land: 'Land',
}

function cardId(bill: Bill): string {
  return `bill-${billKey(bill)}`
}

function signalRow(opp: Opportunity): HTMLElement {
  const row = el('div', 'signal-row')
  row.append(el('span', `sig-chip sig-${opp.signal}`, SIGNAL_LABEL[opp.signal]))
  row.append(el('span', 'urgency-badge', `Urgency ${opp.urgency}`))
  for (const t of opp.types) row.append(el('span', 'tag-chip tag-type', TYPE_LABEL[t]))
  for (const a of opp.assets) row.append(el('span', 'tag-chip tag-asset', ASSET_LABEL[a]))
  return row
}

function hasMechanics(m: Mechanics): boolean {
  return (
    m.dollars.length > 0 ||
    m.rates.length > 0 ||
    m.deadlines.length > 0 ||
    Boolean(m.eligibility) ||
    Boolean(m.authority)
  )
}

function mechRow(label: string, items: string[]): HTMLElement | null {
  if (items.length === 0) return null
  const row = el('div', 'mech-row')
  row.append(el('dt', 'mech-label', label))
  const dd = el('dd', 'mech-values')
  for (const item of items) dd.append(el('span', 'mech-value', item))
  row.append(dd)
  return row
}

/** Expandable block of hard specifics extracted from the bill's full text. */
function mechanicsBlock(m: Mechanics): HTMLElement {
  const details = el('details', 'bill-mechanics')
  const summary = el('summary', 'summary-label mech-summary', 'Money mechanics')
  details.append(summary)

  const dl = el('dl', 'mech-list')
  const rows = [
    mechRow('Dollars', m.dollars),
    mechRow('Rates', m.rates),
    mechRow('Deadlines', m.deadlines),
    mechRow('Eligibility', m.eligibility ? [m.eligibility] : []),
    mechRow('Authority', m.authority ? [m.authority] : []),
  ].filter((r): r is HTMLElement => r !== null)
  for (const row of rows) dl.append(row)
  details.append(dl)

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(m.source.date) && !m.source.date.startsWith('0000')
  const provText = validDate
    ? `From the ${m.source.type} text (${formatDate(m.source.date)})`
    : `From the ${m.source.type} text`
  const prov = el('p', 'mech-prov')
  const provLink = el('a', 'mech-prov-link', provText)
  provLink.href = m.source.url
  provLink.target = '_blank'
  provLink.rel = 'noopener'
  prov.append(provLink)
  prov.append(document.createTextNode(' — figures quoted from the bill; verify before acting.'))
  details.append(prov)

  return details
}

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

export function renderBill(bill: Bill, ai: AiSummaries, opps: Opportunities): HTMLElement {
  const card = el('article', 'bill-card')
  card.id = cardId(bill)
  card.dataset.status = bill.status
  card.dataset.search = `${bill.number} ${bill.title} ${bill.subjects.join(' ')} ${bill.officialSummary ?? ''}`.toLowerCase()

  const opp = opps[billKey(bill)]
  card.dataset.signal = opp?.signal ?? ''
  card.dataset.assets = opp?.assets.join(' ') ?? ''

  const head = el('div', 'bill-head')
  const numberLine = el('p', 'bill-number')
  numberLine.append(el('span', 'bill-number-text', bill.number))
  if (bill.session) numberLine.append(el('span', 'bill-session', bill.session))
  head.append(numberLine, statusChip(bill))
  card.append(head)

  card.append(el('h3', 'bill-title', bill.title))

  if (opp) {
    card.append(signalRow(opp))
    if (opp.play) card.append(el('p', 'bill-play', opp.play))
    if (opp.mechanics && hasMechanics(opp.mechanics)) card.append(mechanicsBlock(opp.mechanics))
  }

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
  opps: Opportunities,
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
  for (const bill of bills) list.append(renderBill(bill, ai, opps))
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

const PLAY_FEED_LIMIT = 15

interface RankedPlay {
  bill: Bill
  opp: Opportunity
}

function renderPlayRow(bill: Bill, opp: Opportunity): HTMLElement {
  const item = el('li', `play-row play-${opp.signal}`)

  const rank = el('a', 'play-urgency')
  rank.href = `#${cardId(bill)}`
  rank.append(el('span', 'play-urgency-num', String(opp.urgency)))
  rank.append(el('span', 'play-urgency-label', 'urgency'))
  item.append(rank)

  const body = el('div', 'play-body')

  const meta = el('p', 'play-meta')
  meta.append(el('span', `sig-chip sig-${opp.signal}`, SIGNAL_LABEL[opp.signal]))
  meta.append(el('span', 'play-jur', `${bill.jurisdiction} ${bill.number}`))
  for (const a of opp.assets) meta.append(el('span', 'tag-chip tag-asset', ASSET_LABEL[a]))
  if (opp.mechanics && hasMechanics(opp.mechanics)) {
    meta.append(el('span', 'play-specifics', '◆ specifics'))
  }
  body.append(meta)

  const text = el('a', 'play-text', opp.play || bill.title)
  text.href = `#${cardId(bill)}`
  body.append(text)

  item.append(body)
  return item
}

/** Ranked cross-jurisdiction feed of the highest-urgency opportunities and risks. */
export function renderPlayFeed(bills: Bill[], opps: Opportunities): HTMLElement | null {
  const ranked: RankedPlay[] = bills
    .map((bill) => ({ bill, opp: opps[billKey(bill)] }))
    .filter((x): x is RankedPlay => Boolean(x.opp) && x.opp.signal !== 'neutral')
    .sort((a, b) => b.opp.urgency - a.opp.urgency)

  if (ranked.length === 0) return null

  const top = ranked.slice(0, PLAY_FEED_LIMIT)
  const section = el('section', 'play-feed')
  section.id = 'plays'
  section.setAttribute('aria-labelledby', 'plays-heading')

  const heading = el('h2', 'play-feed-heading')
  heading.id = 'plays-heading'
  heading.append(el('span', 'play-feed-title', 'The Play'))
  heading.append(
    el('span', 'play-feed-sub', `Top ${top.length} of ${ranked.length} by urgency`),
  )
  section.append(heading)

  const list = el('ol', 'play-list')
  for (const { bill, opp } of top) list.append(renderPlayRow(bill, opp))
  section.append(list)

  return section
}

function externalLink(href: string, className: string, text: string): HTMLAnchorElement {
  const a = el('a', className, text)
  a.href = href
  a.target = '_blank'
  a.rel = 'noopener'
  return a
}

function renderRegItem(item: RegItem): HTMLElement {
  const row = el('article', 'feed-item')
  const meta = el('p', 'feed-meta')
  meta.append(el('span', 'feed-kind', item.type))
  if (item.agencies.length) meta.append(el('span', 'feed-src', item.agencies.join(' · ')))
  if (item.date) meta.append(el('span', 'feed-date', formatDate(item.date)))
  row.append(meta)
  row.append(externalLink(item.url, 'feed-title', item.title))
  if (item.abstract) row.append(el('p', 'feed-abstract', item.abstract))
  return row
}

function renderNewsItem(item: NewsItem): HTMLElement {
  const row = el('article', 'feed-item')
  const meta = el('p', 'feed-meta')
  meta.append(el('span', 'feed-src', item.source))
  if (item.date) meta.append(el('span', 'feed-date', formatDate(item.date)))
  row.append(meta)
  row.append(externalLink(item.url, 'feed-title', item.title))
  return row
}

function feedColumn(title: string, note: string, items: HTMLElement[]): HTMLElement {
  const col = el('div', 'feed-column')
  const head = el('div', 'feed-column-head')
  head.append(el('h3', 'feed-column-title', title))
  head.append(el('span', 'feed-column-count', `${items.length}`))
  col.append(head)
  col.append(el('p', 'feed-column-note', note))
  const list = el('div', 'feed-list')
  for (const item of items) list.append(item)
  col.append(list)
  return col
}

function feedSubgroup(label: string, items: NewsItem[]): HTMLElement[] {
  if (items.length === 0) return []
  const header = el('div', 'feed-subhead')
  header.append(el('span', 'feed-subhead-label', label))
  header.append(el('span', 'feed-subhead-count', `${items.length}`))
  return [header, ...items.map(renderNewsItem)]
}

function newsColumn(news: NewsItem[]): HTMLElement {
  const col = el('div', 'feed-column')
  const head = el('div', 'feed-column-head')
  head.append(el('h3', 'feed-column-title', 'In the news'))
  head.append(el('span', 'feed-column-count', `${news.length}`))
  col.append(head)
  col.append(el('p', 'feed-column-note', 'Policy & trade headlines — high-signal first, wider watch below.'))
  const list = el('div', 'feed-list')
  for (const node of feedSubgroup('High signal', news.filter((n) => n.tier === 'tight')))
    list.append(node)
  for (const node of feedSubgroup('Wider watch', news.filter((n) => n.tier === 'broad')))
    list.append(node)
  col.append(list)
  return col
}

/** The interpretation layer: Federal Register actions + policy/trade news. */
export function renderSignals(signals: Signals): HTMLElement | null {
  const hasReg = signals.regulations.length > 0
  const hasNews = signals.news.length > 0
  if (!hasReg && !hasNews) return null

  const section = el('section', 'signals')
  section.id = 'radar'
  section.setAttribute('aria-labelledby', 'radar-heading')

  const heading = el('h2', 'jurisdiction-heading')
  heading.id = 'radar-heading'
  heading.append(el('span', 'jurisdiction-index', '—'))
  heading.append(el('span', 'jurisdiction-name', 'Regulatory Radar'))
  heading.append(el('span', 'jurisdiction-count', 'rules & news'))
  section.append(heading)
  section.append(
    el(
      'p',
      'jurisdiction-note',
      'The interpretation layer above the bills — where agencies define the mechanics and the market reacts. Every item links to its source.',
    ),
  )

  const columns = el('div', 'feed-columns')
  if (hasReg) {
    columns.append(
      feedColumn(
        'Federal Register',
        'Rules, proposed rules & notices from HUD, Treasury/IRS, FHFA, USDA, CFPB.',
        signals.regulations.map(renderRegItem),
      ),
    )
  }
  if (hasNews) {
    columns.append(newsColumn(signals.news))
  }
  section.append(columns)
  return section
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
