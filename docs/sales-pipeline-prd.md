# PRD — Sales Pipeline Tracker + Free Lead Generation Engine

**Status:** Approved for build (2026-07-22). Build phases in order; each phase ships
working, tested (isolation suite), and live-verified before the next starts.

**Decisions locked with the CEO:**
- Access: **CEO + sales delegates** (a `sales_access` flag granted per-user by the
  CEO, exactly like the existing `finance_access` delegate pattern).
- Target market: **global + local (Pakistan) equally** — both watcher sets, both
  directory strategies, both SEO keyword families.
- Email: **send from the portal** via the existing SMTP setup (`server/email.ts`),
  with deliverability guardrails (see §2.4) since latechs.org's domain reputation
  is on the line.
- Lead magnet: **free website checker, no email gate** — maximize usage and
  backlinks; capture leads via a prominent optional "get the full report / talk to
  us" CTA on the results page instead.

---

## 1. Why

The portal already runs the company (org, tasks, projects, finance, payroll,
attendance). The missing front half of the business is *how work arrives*: no
system tracks who we're talking to, what stage they're at, why deals die, or
which marketing channel actually produces revenue. Bolting on an external CRM
would fracture the data — a won deal would have to be re-entered as a project.
Building it into the portal closes the loop: **lead → deal → project → finance
ledger → case study → new leads**, all in one schema.

## 2. Part A — Sales Pipeline Tracker

### 2.1 Data model

```
leads
  id, company, contact_name, email, phone, website,
  stage        CHECK IN ('new','contacted','qualified','proposal_sent','negotiation','won','lost')
  est_value    REAL          -- deal size estimate
  currency     TEXT          -- PKR / USD per deal (both markets)
  source       TEXT          -- 'website','referral','clutch','job_board','audit_tool','manual',...
  utm_source / utm_medium / utm_campaign  -- attribution from inbound capture
  lost_reason  TEXT          -- mandatory when stage = 'lost'
  next_follow_up TEXT        -- date; drives notifications
  owner_id     -> users      -- who's working this lead
  project_id   -> projects   -- set on won-conversion
  notes, created_at, created_by

lead_activities
  id, lead_id, actor_id, type CHECK IN ('note','call','email','meeting','stage_change'),
  body, created_at            -- the lead's timeline; emails sent from the portal log here automatically
```

Access: every `/sales/*` route gated by `requireSales` (CEO or `sales_access`),
mirroring `requireFinance`. CEO grants/revokes from the same Departments/People
surface as finance access.

### 2.2 Screens (new "Sales" nav section)

1. **Pipeline board** — kanban, one column per stage, drag to advance (drag to
   `lost` prompts for the mandatory lost reason; drag to `won` opens the
   conversion dialog). Column headers show count + total value. Same board
   interaction patterns as the Tasks board.
2. **Lead detail** — contact block, editable fields, activity timeline,
   compose-email panel (§2.4), next-follow-up picker. Fast keyboard entry for
   logging a call/note.
3. **Follow-up discipline** — leads past their follow-up date, or in an active
   stage with *no* follow-up scheduled, are flagged on the board and surface in
   the owner's Dashboard "Today" strip + notifications. Silence is the enemy.
4. **Won → Project conversion** — dialog pre-filled from the lead: project name,
   dates, deal value as the opening `budget` entry in Finance. Lead keeps
   `project_id` so reports can trace revenue back to source.
5. **Reports tab** — win rate, average deal size, time-in-stage, pipeline value
   forecast (stage-weighted), **revenue by source** (the money chart: which
   channel pays), lost-reason breakdown.

### 2.3 Inbound capture (public endpoint)

- `POST /api/leads/capture` — public, no auth, heavily rate-limited per IP,
  honeypot field for spam (silently accept + discard when tripped).
- latechs.org contact/quote forms post here with hidden UTM fields (populated
  from the landing URL's query params, persisted in localStorage across pages so
  the attribution survives navigation).
- New inbound lead → notification to CEO + all sales delegates.

### 2.4 Email from the portal (with guardrails)

- Compose/send from the lead detail via existing SMTP; sent mail auto-logs as an
  `email` activity.
- **Guardrails (non-negotiable):** individual sends only (no bulk/blast feature),
  a per-day send cap, mandatory unsubscribe-style footer for cold outreach, and
  plain personal-format emails (no HTML marketing templates — they trip filters).
  Rationale: one spam-flagged domain would hurt every proposal we send forever.
- Templates: a small snippets library (audit-report outreach, follow-up nudge,
  proposal cover) with variables filled from the lead.

## 3. Part B — Free Lead Generation

### 3.1 Website audit generator (the outreach weapon)

Internal tool: paste any company URL →
- Google **PageSpeed Insights API** (free): performance, Core Web Vitals, mobile.
- Own checks (plain fetch of their public homepage): SSL, title/meta description,
  h1 structure, Open Graph tags, structured data presence, favicon, viewport.
- Output: a branded, scored one-page report (portal view + printable PDF) with
  plain-English "what this is costing you" framing.
- One click: "file as lead" → creates the lead with source `audit_tool` and the
  report attached to its timeline; compose-email panel pre-loads the audit
  outreach template.

### 3.2 Public self-serve checker (lead magnet, free, ungated)

- Public page on latechs.org: visitor enters their URL, gets the same scored
  report instantly, free, no email required (locked decision).
- Prominent CTA on results: "Want these fixed? Get a free consultation" → the
  §2.3 capture form, pre-tagged source `audit_tool`.
- Free-tier PageSpeed API limits handled with per-IP daily caps + result caching.
- This page is itself an SEO asset: interactive free tools earn organic links.

### 3.3 Prospect inbox (watchers — signals, not scraping)

Background jobs surface *signals* into a review queue; a human approves before
anything becomes a lead. One key per row: file as lead / dismiss.
- **Global:** job boards with free APIs / RSS (companies hiring web/app devs are
  candidates for outsourcing), Hacker News "Who's Hiring" monthly threads.
- **Local:** RSS of Pakistani business news/startup coverage; new-business
  signals.
- **Explicitly out of scope:** LinkedIn and Google Maps scrapers — ToS
  violations, fragile, account-ban risk. The portal instead makes *manual*
  prospecting fast: paste a company URL → auto-extract public contact info +
  tech stack from their own site → one keypress files the lead.

### 3.4 Directory presence (checklist, manual, free)

Tracked as a one-time setup checklist inside the Sales section: Clutch,
GoodFirms, DesignRush (global); Google Business Profile + local directories
(Pakistan). Each drives referral traffic *and* is a quality backlink.

## 4. Part C — Rank in Google

1. **Case-study engine** — CEO/delegates write case studies + blog posts in the
   portal; published to latechs.org as static-served pages with proper titles,
   meta descriptions, Open Graph, `Article`/`Organization` structured data, and
   automatic sitemap inclusion (extends the existing sitemap generator). Every
   completed project should become a case study — they rank for
   "[industry] web development" queries and double as proposal collateral.
2. **Keyword families** — global ("react development agency", "outsource web
   development", niche/industry terms) and local ("web development Lahore",
   "software house Pakistan" + city variants). Each case study/tool page targets
   one query.
3. **Technical hygiene** — Core Web Vitals pass on latechs.org (the 889 KB
   HeroScene bundle is the known offender: lazy-load/defer it), image
   compression, canonical tags.
4. **Free tools as link magnets** — the §3.2 checker first; later candidates: a
   project cost calculator, a tech-stack detector.

## 5. Build order

| Phase | Scope | Done means |
|---|---|---|
| 1 | Pipeline core: schema, `requireSales`, board, lead detail, activities, follow-up reminders, won→project conversion | Suite green + live click-through of full lead lifecycle |
| 2 | Inbound: capture endpoint, site forms with UTM, spam guard, new-lead notifications | Test submission from latechs.org lands on the board with attribution |
| 3 | Email: compose from lead, auto-logged activities, templates, send caps | Sent mail appears in timeline; caps enforced server-side |
| 4 | Audit generator (internal) + file-as-lead + outreach template wiring | Paste URL → report → lead → email, end to end |
| 5 | Public checker page + CTA capture + PageSpeed caching/caps | Live on latechs.org, mobile-clean, capture verified |
| 6 | Case-study/blog engine + structured data + sitemap + Core Web Vitals fixes | New case study indexed-ready; Lighthouse pass on key pages |
| 7 | Prospect inbox watchers + directory checklist + source-ROI reports | Signals flowing; revenue-by-source chart live |

Isolation-test coverage required per phase (delegate boundaries, public-endpoint
rate limits/spam handling, capture validation, send caps), same bar as the rest
of the portal.

## 6. Success metrics (visible in Reports)

- Leads/week by source; inbound vs outbound split
- Win rate and average deal size, trailing 90 days
- Revenue attributed to source (the chart that decides where effort goes)
- Public checker runs/week; checker→consultation conversion
- Indexed case-study pages and their impressions (manual Search Console check)
