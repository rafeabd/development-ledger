import './styles/tokens.css'
import './styles/global.css'
import { loadAll } from './data'
import { formatDate, renderBriefing, renderNav, renderSection } from './render'

const SECTION_META = [
  { code: 'US', label: 'Federal' },
  { code: 'NY', label: 'New York' },
  { code: 'PA', label: 'Pennsylvania' },
  { code: 'FL', label: 'Florida' },
] as const

function applyFilters() {
  const query = (document.getElementById('search') as HTMLInputElement).value.trim().toLowerCase()
  const status = (document.getElementById('status-filter') as HTMLSelectElement).value
  let visible = 0
  let total = 0
  for (const card of document.querySelectorAll<HTMLElement>('.bill-card')) {
    total += 1
    const matches =
      (!query || (card.dataset.search ?? '').includes(query)) &&
      (!status || card.dataset.status === status)
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

  const { bills, aiSummaries, briefing } = await loadAll()

  if (briefing) renderBriefing(briefing)

  const sectionsHost = document.getElementById('sections')!
  const navHost = document.querySelector<HTMLElement>('.section-nav')!
  const navEntries: { slug: string; label: string }[] = []

  let index = 1
  for (const meta of SECTION_META) {
    const jurisdiction = bills.jurisdictions.find((j) => j.code === meta.code)
    if (!jurisdiction || jurisdiction.bills.length === 0) continue
    const slug = meta.label.toLowerCase().replace(/\s+/g, '-')
    sectionsHost.append(
      renderSection(index, meta.label, slug, jurisdiction.bills, aiSummaries),
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
        'Notable real-estate bills surfacing in other statehouses, found by nationwide scan.',
      ),
    )
    navEntries.push({ slug: 'elsewhere', label: 'Elsewhere' })
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
