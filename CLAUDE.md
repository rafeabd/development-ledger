# The Development Ledger

Static site tracking real-estate development & lending legislation (federal + NY/PA/FL + a
nationwide scan). Vite vanilla-TS, deployed to GitHub Pages. Raw bill data is refreshed daily
from the LegiScan API by `.github/workflows/refresh-data.yml`.

## Data files (the contract)

- `public/data/bills.json` — machine-written by `scripts/fetch-bills.mjs`. Never hand-edit;
  it is overwritten by the daily Action.
- `public/data/ai-summaries.json` — plain-English summaries, keyed by
  `<JURISDICTION>-<BILLNUMBER with spaces/dots stripped>` (e.g. `PA-HB818`, `US-HB9540`).
  Maintained by the scheduled Claude task.
- `public/data/opportunities.json` — the money layer: same key as `ai-summaries.json`,
  one entry per bill: `{ signal, types, assets, urgency, play, updated }`.
  - `signal`: `opportunity` (creates value/capital for a developer or lender) | `risk`
    (raises cost or constrains) | `neutral` (study, minor, not actionable).
  - `types`: subset of `incentive` (credits/grants/subsidies/TIF/financing), `timing`
    (zoning/density/permitting/deregulation), `risk-cost` (mandates/fees/rent control/disclosure).
  - `assets`: subset of `multifamily`, `commercial`, `lending`, `land`.
  - `urgency`: integer 0–100 (status momentum + how soon to act + dollar magnitude).
    80–100 signed/passed with a near action window; 55–79 actively moving; 30–54 early but
    consequential; 0–29 stalled/minor/neutral. Pure `neutral` ≤ 25.
  - `play`: one operator-facing sentence — the move to make, not a description.
  - `mechanics` (optional): hard specifics extracted from the bill's **full text** for the
    highest-urgency bills — `{ dollars[], rates[], eligibility, deadlines[], authority, source, extracted }`.
    Every figure must be quoted literally from the bill text; never inferred. Empty arrays / null
    fields are correct when the text doesn't state them. `source` cites the LegiScan text doc.
  - Maintained by the scheduled Claude task. Drives the "The Play" ranked feed + card chips
    + signal/asset filters + the per-card "Money mechanics" block on the site.
- `public/data/briefing.json` — the daily editorial briefing shown at the top of the page:
  `{ date, headline, paragraphs: [] }`. Maintained by the scheduled Claude task.
- `public/data/signals.json` — the interpretation layer: `{ generatedAt, regulations[], news[] }`.
  - `regulations`: Federal Register rules/proposed rules/notices from housing & lending agencies
    (HUD, Treasury/IRS, FHFA, USDA, CFPB), each `{ title, type, agencies, date, url, abstract, topics }`.
  - `news`: policy/trade headlines from Google News RSS, each `{ title, source, date, url, query }`.
  - Machine-written by `scripts/fetch-feeds.mjs` (free, keyless). Refreshed by the daily Action.
    Drives the "Regulatory Radar" section. State QAPs have no feed and are not automated here.
- `data/legiscan-cache.json` — change-hash cache; committed so daily runs stay cheap.

## Daily scheduled task (Claude)

The scheduled task should, each run:

1. `git pull`, then read `public/data/bills.json` (the Action refreshes it before this task runs).
2. For every bill whose key is missing from `ai-summaries.json`, write a 2–3 sentence
   plain-English summary. Audience: real-estate developers and lenders. State what the bill
   does and why it matters to them. If a bill's status is Signed/Vetoed/Failed, lead with that.
   No legal advice, no speculation beyond the bill text/official summary.
3. Remove summary keys for bills no longer present in `bills.json` (keep the file tidy).
4. Rewrite `briefing.json` with today's date: a headline plus 2–3 paragraphs covering the most
   consequential movement (status changes since yesterday, newly surfaced bills, upcoming
   deadlines). Use `git log -p public/data/bills.json` to see what changed.
5. Commit (`chore: daily summaries + briefing`) and push. GitHub Pages redeploys automatically.

## Local commands

- `node scripts/fetch-bills.mjs` — refresh bill data (needs `LEGISCAN_API_KEY` in env or `.env`).
- `node scripts/fetch-feeds.mjs` — refresh the Federal Register + news feeds into `signals.json`
  (no API key needed).
- `node scripts/fetch-bill-text.mjs` — fetch + focus the full text of the highest-urgency
  opportunity/risk bills into `.billtext/` (gitignored) for the deep-extract step. Requires
  `LEGISCAN_API_KEY` and `pdftotext` (poppler) on PATH for PDF bill texts. `MIN_URGENCY=40`
  env var widens the set beyond the default urgency ≥ 48.
- `npm run build && npm run preview` — build and serve the production bundle.

## Never

- Never commit `.env` or embed the LegiScan key anywhere in `src/` or `public/`.
- Never hand-edit `bills.json`.
