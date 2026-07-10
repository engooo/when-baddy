# When Baddy

When Baddy is a badminton court availability aggregator for Sydney venues. It scrapes Alpha Badminton, NBC Badminton, and Pro1 Badminton, combines their open court slots into a single table, and lets users switch dates, compare venues, view prices, and jump out to the official booking sites.

## What It Does

- Aggregates court availability from known Sydney venues
- Supports date-based lookups across the upcoming week
- Shows per-timeslot court counts and pricing
- Provides a manual refresh flow for fresh scrape results
- Opens the official booking page in a new tab after confirmation
- Uses server-side caching and request deduplication to reduce repeated scraping

## Stack

- Frontend: React, Vite, TypeScript, Axios
- Backend: Node.js, Express, TypeScript, Cheerio
- Data source: YepBooking schedule pages for Alpha and NBC, plus Pro1 public booking calendar endpoints

## Project Structure

```text
when-baddy/
├── backend/
│   ├── src/
│   │   ├── scrapers/      # Alpha, NBC, and Pro1 scraping logic
│   │   ├── index.ts       # Express API entrypoint
│   │   ├── service.ts     # Aggregation, cache, and request dedupe
│   │   └── types.ts       # Shared backend types
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/    # Table and UI components
│   │   ├── pages/         # Page-level composition
│   │   ├── styles/        # Component styles
│   │   └── App.tsx        # Fetching and date-selection flow
│   └── package.json
├── alpha-ajax-response.html
├── package.json
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Install

```bash
npm install
```

### Run In Development

```bash
npm run dev
```

This starts:

- Backend API at `http://localhost:3000`
- Frontend app at `http://localhost:5173`

### Run Individual Workspaces

Backend dev server:

```bash
npm run dev -w backend
```

Frontend dev server:

```bash
npm run dev -w frontend
```

Backend production build:

```bash
npm run build -w backend
npm start -w backend
```

Full project build:

```bash
npm run build
```

## API

### `GET /health`

Returns a simple service health response.

### `GET /api/courts`

Returns aggregated availability data.

Optional query params:

- `date=YYYY-MM-DD`

Example:

```bash
curl "http://localhost:3000/api/courts?date=2026-04-13"
```

Example response shape:

```json
{
  "success": true,
  "data": [
    {
      "club": "alpha",
      "location": "Alpha Egerton",
      "locationId": "2",
      "courtName": "Court 1",
      "courtId": "2-0",
      "timeSlot": "7:00pm",
      "status": "available",
      "price": 29,
      "date": "2026-04-13"
    }
  ],
  "count": 875,
  "mode": "real",
  "timestamp": "2026-04-12T04:00:00.000Z"
}
```

### `POST /api/refresh`

Clears cached scrape data and fetches fresh results.

### `POST /api/prewarm`

Runs cache warm-up for today plus optional lookahead days. This endpoint is designed for external schedulers (GitHub Actions cron, cloud scheduler, etc.).

Optional auth:

- Set `PREWARM_WEBHOOK_TOKEN` on the backend.
- Send either header `Authorization: Bearer <token>` or `x-prewarm-token: <token>`.

Optional request params:

- `lookaheadDays` in JSON body or query string (clamped to 0..14)
- `clearExistingCache` in JSON body (`true` to clear before warming)

Example:

```bash
curl -X POST "https://your-api.example.com/api/prewarm?lookaheadDays=1" \
  -H "Authorization: Bearer $PREWARM_WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"clearExistingCache": false}'
```

## External Scheduler Setup

If you want warm cache even when no users visit, call `POST /api/prewarm` on a schedule from an external job.

Recommended environment variables on backend:

- `PREWARM_WEBHOOK_TOKEN=<long-random-secret>`
- `CACHE_PREWARM_ENABLED=false` if you only want external scheduling (turns off in-process interval)

Example scheduler: GitHub Actions cron

- Workflow file: `.github/workflows/cache-prewarm.yml`
- Required secrets:
  - `PREWARM_URL` (for example `https://your-api.example.com/api/prewarm?lookaheadDays=1`)
  - `PREWARM_WEBHOOK_TOKEN`

The workflow is included in this repo and can be adjusted to your preferred cadence.

## Notes

- The app depends on YepBooking HTML structure staying consistent.
- Availability can vary between requests because the source sites are live.
- The backend caches responses by date to reduce unnecessary repeated scrapes.
- Empty transient scrape results are not cached.

## Description

Unified Sydney badminton court finder for Alpha, NBC, and Pro1 venues, with live availability scraping, pricing, date switching, and direct booking links.
