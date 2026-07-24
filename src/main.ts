import './styles/tokens.css'
import './styles/global.css'
import { loadAll } from './data'
import {
  formatDate,
  renderBriefing,
  renderNav,
  renderPlayFeed,
  renderSection,
  renderSignals,
} from './render'

const SECTION_META = [
  { code: 'US', label: 'Federal' },
  { code: 'NY', label: 'New York' },
  { code: 'PA', label: 'Pennsylvania' },
  { code: 'FL', label: 'Florida' },
] as const

function applyFilters() {
  const query = (document.getElementById('search') as HTMLInputElement).value.trim().toLowerCase()
  const status = (document.getElementById('status-filter') as HTMLSelectElement).value
  const signal = (document.getElementById('signal-filter') as HTMLSelectElement).value
  const asset = (document.getElementById('asset-filter') as HTMLSelectElement).value
  let visible = 0
  let total = 0
  for (const card of document.querySelectorAll<HTMLElement>('.bill-card')) {
    total += 1
    const assets = (card.dataset.assets ?? '').split(' ').filter(Boolean)
    const matches =
      (!query || (card.dataset.search ?? '').includes(query)) &&
      (!status || card.dataset.status === status) &&
      (!signal || card.dataset.signal === signal) &&
      (!asset || assets.includes(asset))
    card.hidden = !matches
    if (matches) visible += 1
  }
  for (const section of document.querySelectorAll<HTMLElement>('.jurisdiction')) {
    const any = section.querySelector('.bill-card:not([hidden])') !== null
    section.querySelector<HTMLElement>('.jurisdiction-empty')!.hidden = any
  }
  const count = document.getElementById('result-count')!
  count.textContent = visible === total ? `${total} bills` : `${visible} of ${total} bills`
}

async function init() {
  document.getElementById('today')!.textContent = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date())

  const { bills, aiSummaries, opportunities, briefing, signals } = await loadAll()

  if (briefing) renderBriefing(briefing)

  const allBills = [...bills.jurisdictions.flatMap((j) => j.bills), ...bills.elsewhere]
  const playFeed = renderPlayFeed(allBills, opportunities)
  const navEntries: { slug: string; label: string }[] = []
  if (playFeed) {
    document.getElementById('play-feed-host')!.append(playFeed)
    navEntries.push({ slug: 'plays', label: 'The Play' })
  }

  const sectionsHost = document.getElementById('sections')!
  const navHost = document.querySelector<HTMLElement>('.section-nav')!

  let index = 1
  for (const meta of SECTION_META) {
    const jurisdiction = bills.jurisdictions.find((j) => j.code === meta.code)
    if (!jurisdiction || jurisdiction.bills.length === 0) continue
    const slug = meta.label.toLowerCase().replace(/\s+/g, '-')
    sectionsHost.append(
      renderSection(index, meta.label, slug, jurisdiction.bills, aiSummaries, opportunities),
    )
    navEntries.push({ slug, label: meta.label })
    index += 1
  }

  if (bills.elsewhere.length > 0) {
    sectionsHost.append(
      renderSection(
        index,
        'Elsewhere',
        'elsewhere',
        bills.elsewhere,
        aiSummaries,
        opportunities,
        'Notable real-estate bills surfacing in other statehouses, found by nationwide scan.',
      ),
    )
    navEntries.push({ slug: 'elsewhere', label: 'Elsewhere' })
  }

  if (signals) {
    const signalsEl = renderSignals(signals)
    if (signalsEl) {
      sectionsHost.append(signalsEl)
      navEntries.push({ slug: 'radar', label: 'Radar' })
    }
  }

  renderNav(navHost, navEntries)

  const statusSelect = document.getElementById('status-filter') as HTMLSelectElement
  const statuses = [
    ...new Set(
      [...document.querySelectorAll<HTMLElement>('.bill-card')].map((c) => c.dataset.status ?? ''),
    ),
  ].sort()
  for (const status of statuses) {
    const option = document.createElement('option')
    option.value = status
    option.textContent = status
    statusSelect.append(option)
  }

  document.getElementById('search')!.addEventListener('input', applyFilters)
  statusSelect.addEventListener('change', applyFilters)
  document.getElementById('signal-filter')!.addEventListener('change', applyFilters)
  document.getElementById('asset-filter')!.addEventListener('change', applyFilters)
  applyFilters()

  document.getElementById('generated-at')!.textContent =
    `Data refreshed ${formatDate(bills.generatedAt.slice(0, 10))}.`
}

init().catch((err) => {
  const main = document.querySelector('main')!
  const notice = document.createElement('p')
  notice.className = 'load-error'
  notice.textContent = `Could not load bill data: ${err instanceof Error ? err.message : String(err)}`
  main.prepend(notice)
})
