import type { AiSummaries, BillsPayload, Briefing } from './types'

const base = import.meta.env.BASE_URL

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${base}${path}`)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export async function loadAll(): Promise<{
  bills: BillsPayload
  aiSummaries: AiSummaries
  briefing: Briefing | null
}> {
  const [bills, aiSummaries, briefing] = await Promise.all([
    fetchJson<BillsPayload>('data/bills.json'),
    fetchJson<AiSummaries>('data/ai-summaries.json'),
    fetchJson<Briefing>('data/briefing.json'),
  ])
  if (!bills) throw new Error('Could not load bill data.')
  return { bills, aiSummaries: aiSummaries ?? {}, briefing }
}
