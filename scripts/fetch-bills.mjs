#!/usr/bin/env node
/**
 * Fetches real-estate-related legislation from the LegiScan API and writes
 * the site payload to public/data/bills.json.
 *
 * Requires LEGISCAN_API_KEY in the environment (or a local .env file).
 * A change-hash cache in data/legiscan-cache.json keeps daily runs cheap.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_PATH = resolve(ROOT, 'data/legiscan-cache.json')
const OUTPUT_PATH = resolve(ROOT, 'public/data/bills.json')

const API_BASE = 'https://api.legiscan.com/'
const REQUEST_DELAY_MS = 200
const TRACKED = [
  { code: 'US', name: 'Federal' },
  { code: 'NY', name: 'New York' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'FL', name: 'Florida' },
]
const QUERIES = [
  '"real estate"',
  '"housing development" OR "affordable housing" OR zoning',
  'mortgage OR "construction financing" OR "commercial real estate" OR "land use"',
]
const ELSEWHERE_QUERY = '"real estate development" OR "housing development"'
const MIN_RELEVANCE = 60
const MIN_RELEVANCE_ELSEWHERE = 75
const MAX_BILLS_PER_JURISDICTION = 24
const MAX_ELSEWHERE = 15

const STATUS_LABELS = {
  0: 'Prefiled',
  1: 'Introduced',
  2: 'In Progress',
  3: 'Passed Both Chambers',
  4: 'Signed Into Law',
  5: 'Vetoed',
  6: 'Failed',
}

const apiKey = process.env.LEGISCAN_API_KEY ?? readDotEnvKey()
if (!apiKey) {
  console.error('LEGISCAN_API_KEY is not set (env or .env). Aborting.')
  process.exit(1)
}

function readDotEnvKey() {
  const envPath = resolve(ROOT, '.env')
  if (!existsSync(envPath)) return null
  const match = readFileSync(envPath, 'utf8').match(/^LEGISCAN_API_KEY=(.+)$/m)
  return match ? match[1].trim() : null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(params) {
  const url = new URL(API_BASE)
  url.searchParams.set('key', apiKey)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  await sleep(REQUEST_DELAY_MS)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`LegiScan HTTP ${res.status} for op=${params.op}`)
  const body = await res.json()
  if (body.status !== 'OK') throw new Error(`LegiScan error for op=${params.op}: ${JSON.stringify(body).slice(0, 300)}`)
  return body
}

function searchHits(searchresult) {
  return Object.entries(searchresult)
    .filter(([k]) => k !== 'summary')
    .map(([, hit]) => hit)
}

async function search(state, query, pages = 1) {
  const hits = []
  for (let page = 1; page <= pages; page += 1) {
    const body = await api({ op: 'getSearch', state, query, year: 2, page })
    const result = body.searchresult
    hits.push(...searchHits(result))
    if (page >= (result.summary?.page_total ?? 1)) break
  }
  return hits
}

function dedupeByBillId(hits) {
  const byId = new Map()
  for (const hit of hits) {
    const existing = byId.get(hit.bill_id)
    if (!existing || hit.relevance > existing.relevance) byId.set(hit.bill_id, hit)
  }
  return [...byId.values()]
}

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {}
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8'))
  } catch {
    return {}
  }
}

async function getBillDetail(hit, cache) {
  const cached = cache[hit.bill_id]
  if (cached && cached.change_hash === hit.change_hash) return cached.bill
  const body = await api({ op: 'getBill', id: hit.bill_id })
  const bill = body.bill
  cache[hit.bill_id] = { change_hash: hit.change_hash, bill }
  return bill
}

const TITLE_LIMIT = 150

function shortenTitle(title) {
  if (title.length <= TITLE_LIMIT) return title
  const cut = title.slice(0, TITLE_LIMIT)
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`
}

function toRecord(hit, bill) {
  const history = Array.isArray(bill.history) ? bill.history : []
  const lastEvent = history[history.length - 1]
  const summarySource =
    bill.description && bill.description !== bill.title
      ? bill.description
      : bill.title.length > TITLE_LIMIT
        ? bill.title
        : null
  return {
    id: bill.bill_id,
    jurisdiction: bill.state,
    number: bill.bill_number,
    title: shortenTitle(bill.title),
    status: STATUS_LABELS[bill.status] ?? 'Unknown',
    statusDate: bill.status_date || lastEvent?.date || null,
    lastAction: lastEvent?.action ?? hit.last_action ?? null,
    lastActionDate: lastEvent?.date ?? hit.last_action_date ?? null,
    chamber: bill.current_body ?? null,
    session: bill.session?.session_name ?? null,
    relevance: hit.relevance,
    officialSummary: summarySource,
    subjects: (bill.subjects ?? []).map((s) => s.subject_name).slice(0, 6),
    link: bill.state_link || bill.url,
    legiscanLink: bill.url,
    textLink: hit.text_url || null,
  }
}

async function collectJurisdiction(code, cache) {
  const hits = []
  for (const query of QUERIES) hits.push(...(await search(code, query, 2)))
  const selected = dedupeByBillId(hits)
    .filter((h) => h.relevance >= MIN_RELEVANCE)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, MAX_BILLS_PER_JURISDICTION)
  const records = []
  for (const hit of selected) {
    try {
      const bill = await getBillDetail(hit, cache)
      if (!['B', 'CA', 'JR'].includes(bill.bill_type)) continue // skip resolutions/memorials
      records.push(toRecord(hit, bill))
    } catch (err) {
      console.error(`  skipping bill_id=${hit.bill_id}: ${err.message}`)
    }
  }
  return records.sort((a, b) => (b.lastActionDate ?? '').localeCompare(a.lastActionDate ?? ''))
}

async function collectElsewhere(cache) {
  const trackedCodes = new Set(TRACKED.map((t) => t.code))
  const hits = dedupeByBillId(await search('ALL', ELSEWHERE_QUERY, 2))
    .filter((h) => !trackedCodes.has(h.state) && h.relevance >= MIN_RELEVANCE_ELSEWHERE)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, MAX_ELSEWHERE)
  const records = []
  for (const hit of hits) {
    try {
      const bill = await getBillDetail(hit, cache)
      if (bill.bill_type !== 'B') continue // resolutions/appointments are noise here
      records.push(toRecord(hit, bill))
    } catch (err) {
      console.error(`  skipping bill_id=${hit.bill_id}: ${err.message}`)
    }
  }
  return records
}

const WATCHLIST_PATH = resolve(ROOT, 'data/watchlist.json')

function loadWatchlist() {
  if (!existsSync(WATCHLIST_PATH)) return {}
  try {
    return JSON.parse(readFileSync(WATCHLIST_PATH, 'utf8'))
  } catch {
    return {}
  }
}

/** Force-include curated bills by number, regardless of search relevance. */
async function collectWatchlist(code, numbers, existingIds, cache) {
  if (!numbers?.length) return []
  const body = await api({ op: 'getMasterListRaw', state: code })
  const wanted = new Set(numbers.map((n) => n.toUpperCase()))
  const entries = Object.values(body.masterlist).filter(
    (e) => e && typeof e === 'object' && wanted.has(String(e.number ?? '').toUpperCase()),
  )
  const records = []
  for (const entry of entries) {
    if (existingIds.has(entry.bill_id)) continue
    try {
      const hit = { bill_id: entry.bill_id, change_hash: entry.change_hash, relevance: 100 }
      records.push(toRecord(hit, await getBillDetail(hit, cache)))
    } catch (err) {
      console.error(`  watchlist skip bill_id=${entry.bill_id}: ${err.message}`)
    }
  }
  return records
}

const cache = loadCache()
const watchlist = loadWatchlist()
const jurisdictions = []
for (const { code, name } of TRACKED) {
  console.error(`Fetching ${name} (${code})…`)
  const bills = await collectJurisdiction(code, cache)
  const watched = await collectWatchlist(
    code,
    watchlist[code],
    new Set(bills.map((b) => b.id)),
    cache,
  )
  if (watched.length) console.error(`  +${watched.length} watchlist bills`)
  const merged = [...bills, ...watched].sort((a, b) =>
    (b.lastActionDate ?? '').localeCompare(a.lastActionDate ?? ''),
  )
  console.error(`  ${merged.length} bills`)
  jurisdictions.push({ code, name, bills: merged })
}
console.error('Fetching nationwide scan…')
const elsewhere = await collectElsewhere(cache)
console.error(`  ${elsewhere.length} bills`)

writeFileSync(CACHE_PATH, JSON.stringify(cache))
writeFileSync(
  OUTPUT_PATH,
  JSON.stringify({ generatedAt: new Date().toISOString(), jurisdictions, elsewhere }, null, 2),
)
console.error(`Wrote ${OUTPUT_PATH}`)
