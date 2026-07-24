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

export type OpportunitySignal = 'opportunity' | 'risk' | 'neutral'
export type OpportunityType = 'incentive' | 'timing' | 'risk-cost'
export type AssetClass = 'multifamily' | 'commercial' | 'lending' | 'land'

export interface MechanicsSource {
  url: string
  type: string
  date: string
}

/** Structured "money mechanics" extracted from a bill's full text. */
export interface Mechanics {
  dollars: string[]
  rates: string[]
  eligibility: string | null
  deadlines: string[]
  authority: string | null
  source: MechanicsSource
  extracted: string
}

export interface Opportunity {
  signal: OpportunitySignal
  types: OpportunityType[]
  assets: AssetClass[]
  urgency: number
  play: string
  updated: string
  mechanics?: Mechanics
}

export interface Opportunities {
  [key: string]: Opportunity
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
