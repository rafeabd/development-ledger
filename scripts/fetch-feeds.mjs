#!/usr/bin/env node
/**
 * Fetches the "interpretation layer" that sits above the bills:
 *   - Federal Register rules, proposed rules & notices (regulations / IRS &
 *     Treasury guidance) touching housing, real-estate and lending.
 *   - Real-estate-policy news headlines (Google News RSS).
 *
 * Both sources are free and keyless. Output: public/data/signals.json.
 * Run daily alongside fetch-bills.mjs. Failures on any single query are
 * logged and skipped so a partial outage never blocks the file.
 */
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT_PATH = resolve(ROOT, 'public/data/signals.json')

const FR_API = 'https://www.federalregister.gov/api/v1/documents.json'
const FR_TERMS = [
  'low-income housing tax credit',
  'opportunity zone',
  'affordable housing',
  'FHA mortgage insurance',
  'manufactured housing',
  'real estate settlement',
  'community development block grant',
  'housing finance',
]
// Agencies whose housing/lending actions are relevant to developers & lenders.
const FR_AGENCIES = new Set([
  'Housing and Urban Development Department',
  'Internal Revenue Service',
  'Treasury Department',
  'Federal Housing Finance Agency',
  'Rural Housing Service',
  'Rural Business-Cooperative Service',
  'Agriculture Department',
  'Consumer Financial Protection Bureau',
  'Comptroller of the Currency',
  'Federal Deposit Insurance Corporation',
  'Federal Reserve System',
  'Community Development Financial Institutions Fund',
])
const REG_LIMIT = 32

// High-signal: specific incentive / legislation / deal-mechanic queries.
const NEWS_TIGHT = [
  '"low-income housing tax credit"',
  '"opportunity zone" (development OR housing OR investment)',
  '"office to residential" conversion',
  '"housing tax credit" legislation',
  '"property tax abatement" development',
  '"tax increment financing" development',
  '"density bonus" housing',
  '"affordable housing" (tax credit OR bill OR legislation)',
  '"HUD" (rule OR funding OR program) housing',
  '"construction loan" OR "development financing" commercial real estate',
]
// Wider watch: broad real-estate-policy coverage (relevance-filtered).
const NEWS_BROAD = [
  'real estate legislation',
  'housing bill',
  'opportunity zone real estate',
  'zoning reform',
  'rent regulation',
  'affordable housing development',
  'construction financing',
  'property tax exemption housing',
  'office to residential conversion',
  'mortgage lending rule',
]
const NEWS_PER_QUERY = 6
const TIGHT_LIMIT = 20
const BROAD_LIMIT = 26
// A headline must touch one of these to survive the wider (untrusted) tier.
const NEWS_RELEVANT =
  /\b(housing|real ?estate|realty|mortgage|rent|renter|tenant|landlord|zoning|apartment|multifamily|develop|construct|homebuild|affordable|LIHTC|tax credit|opportunity zone|property tax|abatement|foreclos|HUD|FHA|Fannie|Freddie|land use|permit|condo|commercial real estate|warehouse|industrial|lending|loan|REIT)\b/i

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'development-ledger/1.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url))
}

function frUrl(term) {
  const u = new URL(FR_API)
  u.searchParams.set('per_page', '12')
  u.searchParams.set('order', 'newest')
  u.searchParams.set('conditions[term]', term)
  for (const t of ['RULE', 'PRORULE', 'NOTICE']) u.searchParams.append('conditions[type][]', t)
  for (const f of ['title', 'type', 'agencies', 'publication_date', 'html_url', 'abstract', 'document_number'])
    u.searchParams.append('fields[]', f)
  return u.toString()
}

const TYPE_LABEL = { Rule: 'Final rule', 'Proposed Rule': 'Proposed rule', Notice: 'Notice' }

async function collectRegulations() {
  const byDoc = new Map()
  for (const term of FR_TERMS) {
    try {
      const body = await fetchJson(frUrl(term))
      for (const r of body.results ?? []) {
        const agencies = (r.agencies ?? []).map((a) => a.name).filter(Boolean)
        if (!agencies.some((a) => FR_AGENCIES.has(a))) continue // relevance guard
        if (byDoc.has(r.document_number)) {
          byDoc.get(r.document_number).topics.add(term)
          continue
        }
        byDoc.set(r.document_number, {
          title: r.title,
          type: TYPE_LABEL[r.type] ?? r.type,
          agencies: agencies.slice(0, 2),
          date: r.publication_date,
          url: r.html_url,
          abstract: (r.abstract ?? '').slice(0, 260) || null,
          topics: new Set([term]),
        })
      }
    } catch (err) {
      console.error(`  FR term "${term}": ${err.message}`)
    }
  }
  return [...byDoc.values()]
    .map((r) => ({ ...r, topics: [...r.topics] }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, REG_LIMIT)
}

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim()
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))
  return m ? decodeEntities(m[1]) : null
}

async function collectNews(queries, tier, { guard } = { guard: false }) {
  const byUrl = new Map()
  for (const query of queries) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
    try {
      const xml = await fetchText(url)
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, NEWS_PER_QUERY)
      for (const [, block] of items) {
        const link = tag(block, 'link')
        const rawTitle = tag(block, 'title')
        if (!link || !rawTitle) continue
        // Google News titles are "Headline - <full publisher>" and <source> holds that
        // exact publisher (often with a tagline). Strip the publisher off the title end.
        const rawSource = tag(block, 'source') ?? ''
        let title = rawTitle
        if (rawSource) {
          const esc = rawSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          title = rawTitle.replace(new RegExp(`\\s*-\\s*${esc}\\s*$`), '').trim()
        }
        if (title === rawTitle) title = rawTitle.replace(/\s*-\s*[^-]*$/, '').trim() || rawTitle
        if (guard && !NEWS_RELEVANT.test(title)) continue // drop off-topic wider-tier items
        // Keep just the publisher head ("ABC News" from "ABC News - Breaking News…").
        const source = (rawSource || rawTitle).split(/\s+[-–|:]\s+/)[0].slice(0, 40)
        const pub = tag(block, 'pubDate')
        const date = pub ? new Date(pub).toISOString().slice(0, 10) : null
        if (byUrl.has(link)) continue
        byUrl.set(link, { title, source, date, url: link, query, tier })
      }
    } catch (err) {
      console.error(`  News "${query}": ${err.message}`)
    }
  }
  return [...byUrl.values()].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}

async function main() {
  console.error('Fetching Federal Register…')
  const regulations = await collectRegulations()
  console.error(`  ${regulations.length} regulatory items`)
  console.error('Fetching news (high signal)…')
  const tight = (await collectNews(NEWS_TIGHT, 'tight', { guard: true })).slice(0, TIGHT_LIMIT)
  console.error(`  ${tight.length} high-signal items`)
  console.error('Fetching news (wider watch)…')
  const tightUrls = new Set(tight.map((n) => n.url))
  const broad = (await collectNews(NEWS_BROAD, 'broad', { guard: true }))
    .filter((n) => !tightUrls.has(n.url))
    .slice(0, BROAD_LIMIT)
  console.error(`  ${broad.length} wider-watch items`)
  const news = [...tight, ...broad]

  writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), regulations, news }, null, 2) + '\n',
  )
  console.error(`Wrote ${OUTPUT_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
