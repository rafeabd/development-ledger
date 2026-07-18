export interface Bill {
  id: number
  jurisdiction: string
  number: string
  title: string
  status: string
  statusDate: string | null
  lastAction: string | null
  lastActionDate: string | null
  chamber: string | null
  session: string | null
  relevance: number
  officialSummary: string | null
  subjects: string[]
  link: string
  legiscanLink: string
  textLink: string | null
}

export interface Jurisdiction {
  code: string
  name: string
  bills: Bill[]
}

export interface BillsPayload {
  generatedAt: string
  jurisdictions: Jurisdiction[]
  elsewhere: Bill[]
}

export interface AiSummaries {
  [key: string]: { summary: string; updated: string }
}

export interface Briefing {
  date: string
  headline: string
  paragraphs: string[]
}

/** Stable key used by ai-summaries.json: e.g. "PA-HB818" */
export function billKey(bill: Bill): string {
  return `${bill.jurisdiction}-${bill.number.replace(/[\s.]/g, '')}`
}
