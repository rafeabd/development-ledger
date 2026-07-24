import type { AiSummaries, BillsPayload, Briefing, Opportunities } from './types'

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
  opportunities: Opportunities
  briefing: Briefing | null
}> {
  const [bills, aiSummaries, opportunities, briefing] = await Promise.all([
    fetchJson<BillsPayload>('data/bills.json'),
    fetchJson<AiSummaries>('data/ai-summaries.json'),
    fetchJson<Opportunities>('data/opportunities.json'),
    fetchJson<Briefing>('data/briefing.json'),
  ])
  if (!bills) throw new Error('Could not load bill data.')
  return {
    bills,
    aiSummaries: aiSummaries ?? {},
    opportunities: opportunities ?? {},
    briefing,
  }
}
