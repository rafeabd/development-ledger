#!/usr/bin/env node
/**
 * Fetches full bill text for the highest-urgency opportunity/risk bills and
 * writes focused, plain-text extracts to .billtext/<billKey>.txt for the
 * deep-extract step to read. Only the "money mechanics" regions of each bill
 * are kept (dollar amounts, rates, deadlines, eligibility, authorities), so
 * large statutes stay within a bounded size.
 *
 * Requires LEGISCAN_API_KEY in the environment (or a local .env file).
 * Source of truth for doc IDs is data/legiscan-cache.json (written by
 * fetch-bills.mjs), so this never re-fetches bill metadata.
 *
 * Usage:
 *   node scripts/fetch-bill-text.mjs            # urgency >= 48 opp/risk bills
 *   MIN_URGENCY=40 node scripts/fetch-bill-text.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_PATH = resolve(ROOT, 'data/legiscan-cache.json')
const BILLS_PATH = resolve(ROOT, 'public/data/bills.json')
const OPPS_PATH = resolve(ROOT, 'public/data/opportunities.json')
const OUT_DIR = resolve(ROOT, '.billtext')

const API_BASE = 'https://api.legiscan.com/'
const REQUEST_DELAY_MS = 250
const MIN_URGENCY = Number(process.env.MIN_URGENCY ?? 48)
const WINDOW = 1200 // chars of context to keep around each keyword hit
const MAX_CHARS = 26000 // hard cap on focused text per bill

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
const billKey = (b) => `${b.jurisdiction}-${b.number.replace(/[\s.]/g, '')}`

async function api(params) {
  const url = new URL(API_BASE)
  url.searchParams.set('key', apiKey)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  await sleep(REQUEST_DELAY_MS)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`LegiScan HTTP ${res.status} for op=${params.op}`)
  const body = await res.json()
  if (body.status !== 'OK') {
    throw new Error(`LegiScan error for op=${params.op}: ${JSON.stringify(body).slice(0, 200)}`)
  }
  return body
}

/** Strip HTML to readable plain text. */
function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const KEYWORD =
  /\$[\d,]+|\b\d+(\.\d+)?\s*(percent|per\s?cent|%)|\b\d{1,3}(,\d{3})+\b|\b(million|billion)\b|\b(credit|tax abatement|exemption|deduction|grant|subsid|appropriat|fund|loan|financ|deadline|sunset|expire|effective|eligib|qualif|allocat|cap(ped|s)?|threshold|per unit|square (foot|feet)|acre|application|apply|administer|authority|commissioner|department|agency)\b/i

/** Keep only regions near money/deadline/eligibility keywords, capped. */
function focus(text) {
  if (text.length <= MAX_CHARS) return text
  const spans = []
  const rx = new RegExp(KEYWORD.source, 'gi')
  let m
  while ((m = rx.exec(text)) !== null) {
    const start = Math.max(0, m.index - WINDOW)
    const end = Math.min(text.length, m.index + WINDOW)
    const last = spans[spans.length - 1]
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else spans.push([start, end])
    if (spans.reduce((a, [s, e]) => a + (e - s), 0) > MAX_CHARS) break
  }
  if (spans.length === 0) return text.slice(0, MAX_CHARS)
  return spans.map(([s, e]) => text.slice(s, e)).join('\n\n[…]\n\n')
}

/** Extract plain text from a PDF buffer via poppler's pdftotext. */
function pdfToText(buf, key) {
  const tmp = resolve(tmpdir(), `dl-${key.replace(/[^A-Za-z0-9-]/g, '')}.pdf`)
  writeFileSync(tmp, buf)
  try {
    const out = execFileSync('pdftotext', ['-q', '-nopgbrk', tmp, '-'], {
      maxBuffer: 64 * 1024 * 1024,
    })
    return out.toString('utf8').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  } finally {
    try {
      unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
}

async function getText(doc, key) {
  const body = await api({ op: 'getBillText', id: doc.doc_id })
  const t = body.text
  if (!t?.doc) return null
  const buf = Buffer.from(t.doc, 'base64')
  const mime = (t.mime || doc.mime || '').toLowerCase()
  if (mime.includes('pdf')) {
    try {
      return { text: pdfToText(buf, key), mime }
    } catch (err) {
      return { text: null, mime, error: `pdftotext failed: ${err.message}` }
    }
  }
  if (mime.includes('word') || mime.includes('octet')) {
    return { text: null, mime } // unsupported binary format
  }
  return { text: htmlToText(buf.toString('utf8')), mime: mime || 'text/html' }
}

async function main() {
  const cache = JSON.parse(readFileSync(CACHE_PATH, 'utf8'))
  const billsPayload = JSON.parse(readFileSync(BILLS_PATH, 'utf8'))
  const opps = JSON.parse(readFileSync(OPPS_PATH, 'utf8'))
  const all = [
    ...billsPayload.jurisdictions.flatMap((j) => j.bills),
    ...billsPayload.elsewhere,
  ]

  const targets = all
    .map((b) => ({ bill: b, opp: opps[billKey(b)] }))
    .filter((x) => x.opp && x.opp.signal !== 'neutral' && x.opp.urgency >= MIN_URGENCY)
    .sort((a, b) => b.opp.urgency - a.opp.urgency)

  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })

  const manifest = []
  for (const { bill, opp } of targets) {
    const key = billKey(bill)
    const cached = cache[bill.id]
    const texts = cached?.bill?.texts ?? []
    if (texts.length === 0) {
      console.error(`  ${key}: no text docs in cache — skipping`)
      manifest.push({ key, status: 'no-doc' })
      continue
    }
    const doc = texts[texts.length - 1] // latest version
    try {
      const result = await getText(doc, key)
      if (!result?.text) {
        console.error(`  ${key}: text unavailable (${result?.mime ?? 'unknown'}) — skipping`)
        manifest.push({ key, status: 'binary', mime: result?.mime ?? null, url: doc.url })
        continue
      }
      const focused = focus(result.text)
      const header =
        `BILL_KEY: ${key}\n` +
        `NUMBER: ${bill.number} (${bill.jurisdiction})\n` +
        `TITLE: ${bill.title}\n` +
        `STATUS: ${bill.status} (as of ${bill.statusDate ?? 'n/a'})\n` +
        `SIGNAL: ${opp.signal}  URGENCY: ${opp.urgency}\n` +
        `SOURCE_DOC: ${doc.url} (${doc.type}, ${doc.date})\n` +
        `NOTE: Text below is HTML-stripped and focused to money/deadline/eligibility regions. […] marks omitted spans.\n` +
        `${'='.repeat(70)}\n\n`
      writeFileSync(resolve(OUT_DIR, `${key}.txt`), header + focused)
      manifest.push({
        key,
        status: 'ok',
        chars: focused.length,
        doc_url: doc.url,
        doc_type: doc.type,
        doc_date: doc.date,
      })
      console.error(`  ${key}: wrote ${focused.length} chars`)
    } catch (err) {
      console.error(`  ${key}: ${err.message}`)
      manifest.push({ key, status: 'error', error: err.message })
    }
  }

  writeFileSync(resolve(OUT_DIR, '_manifest.json'), JSON.stringify(manifest, null, 2))
  const ok = manifest.filter((m) => m.status === 'ok').length
  console.error(`\nDone. ${ok}/${targets.length} bills with usable text (min urgency ${MIN_URGENCY}).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
