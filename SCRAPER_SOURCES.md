# Scraper Sources Overview

This document explains where each scraper gets data from, what the upstream response looks like, and how the backend parses it into the normalised court model.

## Normalised Output Shape

All scrapers normalize upstream data into the backend court model:

- `club`
- `date`
- `locations[]`
- `locations[].courts[]`
- `locations[].courts[].availability[]`
- `availability[].timeSlot`
- `availability[].status`
- `availability[].price`

The API then aggregates this through `GET /api/courts`.

## Source Summary

| Source | Upstream Endpoint(s) | Method | Upstream Format | Parser Strategy |
|---|---|---|---|---|
| Alpha (YepBooking) | `https://alphabadminton.yepbooking.com.au/ajax/ajax.schema.php` | POST | HTML | Parse timetable table, status classes, and price row |
| NBC (YepBooking) | `https://nbc.yepbooking.com.au/ajax/ajax.schema.php` | POST | HTML | Parse timetable table, slot status classes, and prices |
| Pro1 | `.../public/venues`, then `.../public/calendar-widget` | GET | HTML | Parse calendar widget table for available class tokens |
| Roketto | `.../public/show`, then `.../public/calendar-widget` | GET | HTML | Obtain session context then parse calendar widget table |
| PicklePoint (ClubSpark) | `https://clubspark.net/v0/VenueBooking/Picklepoint/GetVenueSessions` | GET | JSON | Read `Resources -> Days -> Sessions` and map available sessions |
| Mindbody (Ryde/Camellia/Galuwa) | `.../widgets/appointments/view/{widgetId}/services|staff|schedule` | GET | HTML/script payload | Extract staff IDs and schedule time blocks from embedded payloads |
| TennisVenues (Southend) | `https://www.tennisvenues.com.au/booking/southend-tc/fetch-booking-data` | GET | HTML | Parse court buttons and slot links, extract `t=HHMM` |

## Detailed Notes By Source

### 1) Alpha (YepBooking)

- Endpoint: `ajax.schema.php`
- Request includes:
  - `id_sport`
  - `day`, `month`, `year`
  - `event=init`
- Upstream response is HTML containing a timetable table (`schema schemaIndividual`).

Parsing steps:
1. Load HTML with Cheerio.
2. Locate timetable table.
3. Extract times from header row (`tr.times`).
4. Extract prices from `tr.prices` if present.
5. Iterate court rows (`trSchemaLane_*`).
6. Mark availability from cell/anchor classes (`empty`, `booked`, `old`).
7. Emit normalized slots with `timeSlot`, `status`, `price`.

### 2) NBC (YepBooking)

- Endpoint: `ajax.schema.php`
- Request shape is similar to Alpha.
- Response is HTML timetable.

Parsing steps:
1. Parse table headers and handle `colspan` to expand time slots.
2. Parse prices row and expand by `colspan`.
3. Parse each court row (`trSchemaLane_*`).
4. Infer status from class/title:
  - `old` => past
  - `empty` => available
  - `booked`/`closed` => booked
5. Emit normalized slot entries.

### 3) Pro1

- Endpoints:
  - Public venues page
  - Calendar widget endpoint for selected date
- Response consumed by scraper is HTML.

Parsing steps:
1. Request venues page and resolve session context.
2. Request calendar widget HTML for date.
3. Parse `#calendar_view_table`.
4. Parse hour headers.
5. For each court row, keep cells whose class token includes `available`.
6. Construct 1-hour `timeSlot` strings.
7. Apply project pricing logic by day/time.

Notes:
- Direct widget access may return an error page if session context is missing.

### 4) Roketto

- Endpoints:
  - Public show page
  - Calendar widget endpoint for selected date
- Response consumed by scraper is HTML.

Parsing steps:
1. Request show page to obtain cookie/session token.
2. Request calendar widget HTML using that context.
3. Parse `#calendar_view_table`.
4. Parse header hours and per-court row cells.
5. Keep cells with `available` token.
6. Build 1-hour `timeSlot` values and apply configured pricing rules.

### 5) PicklePoint (ClubSpark)

- Endpoint: `GetVenueSessions`
- Response is JSON with these important fields:
  - `Resources[]`
  - `Resources[].ResourceGroupID`
  - `Resources[].Days[]`
  - `Days[].Sessions[]`
  - `Sessions[].StartTime`, `EndTime`, `Capacity`, `Cost`, `CostFrom`, `CourtCost`

Parsing steps:
1. Attempt unauthenticated request first.
2. If needed, perform sign-in flow and retry authenticated request.
3. Filter resources to target resource groups (casual/show courts).
4. For each session, keep only available sessions (`Category === 0`, `Capacity > 0`).
5. Convert minute-based times to display time strings.
6. Choose price from `Cost`/`CostFrom`/`CourtCost`.

### 6) Mindbody (Ryde/Camellia/Galuwa)

- Endpoints:
  - `services`
  - `staff`
  - `schedule`
- Response is HTML/script payload (not clean JSON API).

Parsing steps:
1. Read `services` payload and extract `includedStaffIds`.
2. Call `staff` endpoint to get staff/resource list per service.
3. For each staff member, call `schedule` endpoint.
4. Extract per-date time blocks from payload text.
5. Build derived slots from consecutive 30-minute starts.
6. Apply venue-specific pricing functions.

### 7) TennisVenues (Southend)

- Endpoint: `fetch-booking-data`
- Request includes:
  - `client_id`
  - `venue_id`
  - `date=YYYYMMDD`
  - `view=v3`
- Response is HTML containing court buttons and slot links.

Parsing steps:
1. Parse court list under `#v3_courts`.
2. Keep only courts whose label contains `Pickleball`.
3. For each court, parse slot links under `#v3_slots_{courtId}`.
4. Extract `t=HHMM` from each booking URL.
5. Convert to half-hour `timeSlot` text.
6. De-duplicate and emit `available` slots with current configured price.

## Operational Notes

- Upstream formats are mostly HTML and can break if providers change markup/classes.
- The scrapers intentionally normalize diverse formats into one consistent model.
- Empty scrape results are treated carefully to avoid caching transient bad snapshots.
- Source-specific pricing logic is implemented in scraper code when upstream does not provide reliable price values.

## Relevant Code

- `backend/src/service.ts`
- `backend/src/types.ts`
- `backend/src/scrapers/alphaScraper.ts`
- `backend/src/scrapers/nbcScraper.ts`
- `backend/src/scrapers/pro1Scraper.ts`
- `backend/src/scrapers/rokettoScraper.ts`
- `backend/src/scrapers/picklepointScraper.ts`
- `backend/src/scrapers/mindbodyScraper.ts`
- `backend/src/scrapers/tennisVenuesScraper.ts`
