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
- `public/data/briefing.json` — the daily editorial briefing shown at the top of the page:
  `{ date, headline, paragraphs: [] }`. Maintained by the scheduled Claude task.
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
- `npm run build && npm run preview` — build and serve the production bundle.

## Never

- Never commit `.env` or embed the LegiScan key anywhere in `src/` or `public/`.
- Never hand-edit `bills.json`.
