# PRD — "Prospector": a $0/month intelligent cold-call lead engine

**Status:** Proposal for discussion (2026-07-22). Separate app for a special
project — NOT folded into the portal. No build until the CEO approves the
gating decisions in §7.

**The one-line promise:** click a button — pick a service (website / app / AI
receptionist / ERP / CRM / chatbot), a place (local Pakistan, US, UK, …), and a
business category — and get back a **ranked call sheet**: business name, phone,
city, and *the specific reason to call them*, filtered to businesses we haven't
contacted yet. Runs entirely on free, openly-licensed data. No monthly cost, no
per-lead cost, ever.

---

## 1. Why this can be free when the paid tools charge $100–1,000/mo

Cold **calling** removes the expensive requirement. Paid databases
(Apollo, ZoomInfo, Hunter) charge for *person-level verified emails* — the hard,
perishable part. To cold-call, we only need the **business's public phone
number** and a reason to call. That data is openly licensed and downloadable in
bulk:

| Free source | What it gives | License / cost | Verified |
|---|---|---|---|
| **OpenStreetMap** (Geofabrik country extracts) | Business name, category, address, **phone**, website, lat/long — per country, updated daily | ODbL, commercial use OK with attribution, **free bulk download** | Jul 2026 |
| **Foursquare Open Source Places** | 100M+ global POIs: names, categories, coords, contact info | Open dataset, free Parquet download (Hugging Face / S3) | Jul 2026 |
| **OSM Overpass API** (live top-ups) | Same OSM data, live queries by category+area | Free, keyless, ~10k req/day soft cap, community-run | Jul 2026 |
| **Google PageSpeed Insights API** | Performance / mobile / Core Web Vitals score of any URL | Free (key, generous quota) | prior research |
| **Direct website fetch** (our own code) | Is there a site? SSL? booking form? chat widget? phone in the footer? tech stack? | Free | — |

**Deliberately NOT used** (all went paid or are ToS-hostile): Yelp Fusion
(free trial only now), Google Places (paid per-call), Apollo/Hunter (gutted free
tiers), Google Maps scraping (ToS violation + account-ban risk). We don't need
any of them.

## 2. Architecture — bulk import, local query, zero ongoing cost

```
   [ one-time / monthly refresh ]
   Geofabrik OSM extract (per country)  ─┐
   Foursquare OS Places (Parquet)        ─┼─►  import + normalize  ──►  local `businesses` table
                                          │        (dedup by phone/domain across both sources)
   [ per click, live, free ]             │
   Overpass API (fresh top-ups)         ─┘

   businesses ──► QUALIFY (free website fetch + PageSpeed) ──► score + reason ──► ranked call sheet
                                                                     │
                                              dedup vs contacted ────┘
```

The heavy data lives in **our own Postgres**, so a "search" is a local SQL query
— instant, unlimited, no API bill. Overpass is only for freshness top-ups and
stays under its free cap.

## 3. The intelligence layer (this is the whole product)

A raw POI list is worthless; a *reason to call* is gold. For every candidate the
engine derives a **service fit + score + one-line pitch**, all from free checks:

1. **No website at all** (no `website` tag, nothing found) → **HIGH** — website
   creation lead. Pitch: "you've got great reviews but no website — customers
   can't find you."
2. **Website exists → fetch it (free):**
   - Down / 404 / broken SSL → **HIGH**, rebuild lead.
   - PageSpeed mobile score low / not mobile-friendly → **MED-HIGH**, redesign.
   - No booking/contact form → app / booking-system lead.
   - No live-chat widget detected → **chatbot / AI-receptionist** lead.
   - Stale footer year / outdated stack → **MED**, refresh lead.
3. **Category → service mapping** (drives the "what type" filter you asked for):
   - clinics / salons / restaurants → booking app + AI receptionist
   - retail / wholesale → e-commerce / website
   - professional services (law, accounting, agencies) → CRM / website / ERP
   - logistics / manufacturing → ERP / custom app
4. **Callable filter:** must have a phone (from OSM tag, Foursquare, or scraped
   from its own site). No phone → deprioritized, not shown on the call sheet.
5. **Freshness / "actually new":** dedup against a `contacted` table so a
   business we've already called never resurfaces — the thing external tools
   can't do because they don't know our history.

**Output per lead:** company · phone · city · category · **service fit** ·
**score** · **reason to call** · **suggested opening line**. Sortable,
exportable to CSV, printable as a call sheet.

## 4. Separate app, not in the portal

- Different resource profile (imports GB-scale datasets, runs background
  qualification jobs) — keep that off the production portal.
- Same familiar stack (React + Express + Postgres) so it's not a new thing to
  learn.
- Internal-only, single-user (CEO) — minimal auth, no multi-tenant complexity.
- **Bridge to the portal:** a "send to pipeline" button pushes a chosen lead
  into the portal via the planned `POST /api/leads/capture` endpoint (source
  `prospector`), so qualified leads flow into the real sales pipeline without
  copy-paste. The two systems stay decoupled but connected.

## 5. Honest limitations of "free" (so there are no surprises)

- **Coverage varies by region.** OSM + Foursquare are excellent in US/UK/Europe,
  **more variable in Pakistan** — major cities (Lahore, Karachi, Islamabad) are
  decently mapped, smaller towns sparse. We mitigate with website-scrape phone
  recovery and Overpass top-ups, but I won't pretend coverage equals a paid US
  database. This is the real trade for $0.
- **Business-level, not person-level.** You get the business's main line, not
  the owner's mobile or name. For cold calling that's correct — you call and ask
  for the decision-maker. (Person-level would require paid tools.)
- **Snapshot freshness.** Bulk extracts are daily/weekly snapshots; a business
  phone rarely changes, so this is fine for SMB, but a business that closed last
  week may still appear until the next refresh.
- **Phone coverage isn't 100%.** Not every POI has a phone tag; the site-scrape
  step recovers many, but some candidates will be website-only (still useful for
  a form-fill or email, just not the call sheet).

## 6. Legal / compliance for cold calling

- Calling a business's **public main line** for B2B is broadly permitted in the
  US, UK, and Pakistan. **UK caveat:** screen numbers against the **CTPS**
  (Corporate Telephone Preference Service) before calling — required for B2B
  cold calls there. US: business-to-business calls are generally exempt from the
  national DNC registry, but keep an internal do-not-call list and honor
  opt-outs. We bake a `do_not_call` flag into the schema and screen on export.
- OSM data use requires **attribution** ("© OpenStreetMap contributors") —
  trivial, added to any exported sheet.
- Using open business data (name/phone/category a business chose to publish) for
  B2B outreach is legitimate-interest territory; a business main line is not
  "personal data" the way an individual's mobile is.

## 7. Decisions needed before build

1. **Region priority for the first data import** — Pakistan first, US/UK first,
   or all three? (Determines which Geofabrik extracts we pull first; each is
   independent and free, so "all three" only costs import time.)
2. **Hosting** — run it on the same server/infra as the portal (simplest), or a
   separate small instance (cleaner isolation, the GB-scale import won't touch
   production)?
3. **Bridge now or later** — build the "send to pipeline" link to the portal in
   v1, or ship Prospector standalone first and wire the bridge once the sales
   pipeline (Phase 1 of the other PRD) exists?

## 8. Build phases (all $0)

| Phase | Scope | Done means |
|---|---|---|
| 1 | Data pipeline: import one Geofabrik extract + Foursquare OS into `businesses`, normalized + deduped | A city's businesses queryable locally by category |
| 2 | Search UI: service + region + category filters → results table | Click → ranked raw list in the browser |
| 3 | Qualify engine: website fetch + PageSpeed + scoring + reason-to-call | Each lead shows service fit, score, pitch |
| 4 | Call-sheet UX: dedup vs contacted, CSV/print export, do-not-call flag + CTPS/DNC screening | Printable, deduped, compliant call sheet |
| 5 | Freshness: Overpass live top-ups + scheduled monthly re-import | Fresh candidates without manual re-download |
| 6 | Portal bridge: "send to pipeline" → `/api/leads/capture` | Chosen lead lands in the sales pipeline |

Same engineering bar as the portal: tests for the qualifier and dedup logic,
live verification before each phase closes.
