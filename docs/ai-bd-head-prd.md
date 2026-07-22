# PRD — "Rainmaker": An Autonomous AI Business-Development & Marketing Head

**Product type:** A separate, standalone software product (own repo, own database,
own deployment). Not part of the LA Tech company portal, though it can hand
finished leads to the portal's pipeline via a simple webhook.

**Status:** Baseline specification for build. Version 1.0 — 2026-07-23.

---

## 0. The concept in one paragraph

Rainmaker is an **AI that plays the role of the company's Business Development
Head and Marketing Head.** You give it the company's profile (what LA Tech sells,
where, at what price) and a weekly time/attention budget. It then **devises its
own free client-acquisition strategy, executes the parts it safely can, and hands
the human a prioritized action queue for the parts that need a person.** Its
single mandate: *find real, high-intent potential clients at zero cost, and get
them into a first conversation.* It treats "we have no marketing budget" as the
core constraint to design around, not a blocker — it only ever uses free tools,
free data, free channels, and free APIs.

The guiding principle throughout: **intercept active demand, don't interrupt
strangers.** Rainmaker never blasts unsolicited bulk anything. It finds people
and companies who are *already asking* for what LA Tech sells, and it makes
reaching them fast, personal, and compliant.

---

## 1. Why this exists (the problem it solves)

A small software house with no marketing budget faces two failures:
1. **Cold lists don't convert** — scraped/bought business databases are resold,
   saturated, and target people with no current need. Timing is wrong, not data.
2. **Founders don't have time** to manually watch a dozen job boards, forums,
   and communities every day for the handful of "I need a developer" moments
   that actually convert.

Rainmaker fixes both: it continuously watches **free, public, high-intent
signals**, qualifies them with **free automated checks**, and turns them into a
short daily list of *warm, reasoned, ready-to-contact* opportunities — the work
a good BD hire would do, minus the salary and minus the burnout.

## 2. The AI's operating role and autonomy model

Rainmaker is framed as an employee with a job title, not a button. It has:

- **A mandate** (§0): find free, high-intent leads and open conversations.
- **A strategy brain**: an LLM planning loop that, given the company profile and
  the signals available this week, *decides* what to pursue and drafts the
  approach. It writes a short weekly "BD plan" the human can read and approve.
- **Three autonomy tiers** (the human sets each channel's tier):
  - **Auto** — Rainmaker does it end to end (e.g. watch feeds, qualify, score,
    draft outreach, file to the queue).
  - **Draft-and-approve** — Rainmaker prepares everything (the message, the
    target, the reasoning) and waits for one human click to send/post.
  - **Advise** — Rainmaker only surfaces the opportunity and a suggested play;
    the human does it manually (used for anything on a third-party platform
    whose ToS forbids automation, e.g. bidding on Upwork, posting in a Facebook
    group).
- **A hard safety boundary it cannot cross** (§7): no unsolicited bulk email, no
  ToS-violating scraping/automation, no impersonation, no sending without a
  compliant footer + opt-out. These are enforced in code, not left to the LLM.

**Design stance on the LLM:** the model is the strategist and copywriter; it is
*not* trusted with irreversible actions. Every send/post is either gated behind a
human click or a hard-coded compliant path. The LLM proposes; deterministic code
disposes.

## 3. What it uses — the free arsenal (all verified July 2026)

### 3.1 High-intent signal sources (the core — free, no/low auth)
- **RemoteOK, Jobicy, Himalayas, Arbeitnow** — free public JSON job APIs, no
  key. Companies hiring web/app/dev roles = outsourcing candidates.
- **Hacker News** Firebase API (free, keyless) + monthly "Who is Hiring?" thread;
  **HNHIRING** as an index.
- **Remotive** — free remote-jobs RSS.
- **Reddit** — free per-subreddit/search `.rss`/`.json` endpoints (light polling,
  no auth): r/forhire, r/jobbit, r/slavelabour, and searches like "need a
  developer", "looking for a website", "recommend a dev agency".
- **Freelance-platform public feeds** (Freelancer/PeoplePerHour RSS where
  available) — surfaced for the human to bid (Advise tier; platforms forbid
  auto-bidding).

### 3.2 Free discovery / firmographic data (for the partnership + audit plays)
- **OpenStreetMap** (Geofabrik bulk extracts, ODbL, free) + **Foursquare Open
  Source Places** (free dataset) — to find agencies/studios (partnership targets)
  and local businesses, with name/phone/website/category.

### 3.3 Free qualification tools (turn a name into a *reason to contact*)
- **Google PageSpeed Insights API** (free) — performance/mobile/Core Web Vitals.
- **Direct website fetch** (our own code, free) — has a site at all? SSL ok?
  booking form? live-chat widget? stale footer year? detectable tech stack?
- Result → a specific, honest hook ("your site scores 31/100 on mobile", "no
  online booking", "no live chat").

### 3.4 Free reach / content channels (for inbound + presence)
- The company's own website (SEO pages, a public free "website checker" tool as
  a lead magnet + link magnet).
- LinkedIn / X posting drafts, community-answer drafts — produced by the AI,
  posted by the human (Advise/Draft-and-approve).

### 3.5 The LLM itself
- Any model with a free/low-cost tier for the planning + copywriting loop; the
  system is model-agnostic (config-driven endpoint + key). Rainmaker's *data* is
  free; the reasoning layer is the one place a small token spend may occur, and
  it's bounded by a configurable monthly cap (can be set to a free-tier model).

## 4. The five strategies Rainmaker runs (its playbook)

Rainmaker doesn't do one thing; it runs a portfolio and reports which pays. Each
strategy is a module with its own autonomy tier.

1. **Intent Interception (primary, Auto→Draft).** Continuously watch §3.1 feeds,
   filter to LA Tech's service genres (website / app / AI receptionist / ERP /
   CRM / chatbot), dedupe against everyone already contacted, qualify each hiring
   company with §3.3, score, and draft a tailored opener. Output: daily
   ranked queue of *fresh, high-intent* leads with a ready message.
2. **Partnership Finder (Draft).** Use §3.2 to find marketing/design agencies &
   studios that sell but don't build software; draft a white-label partnership
   pitch. Highest value, least competition.
3. **Audit-Hook Outreach (Draft/Advise).** For a chosen niche + city, find
   businesses whose sites fail the §3.3 checks; generate a branded one-page audit
   as the opener ("three things costing you customers"). Value-first, not a pitch.
4. **Inbound Engine (Auto content-gen, human publish).** Draft case studies from
   finished projects, SEO pages, and the public free-checker tool copy;
   structured-data + sitemap ready. Compounds over time; makes outreach optional.
5. **Community & Referral Radar (Advise).** Watch Reddit/relevant public
   communities for "who can build X" questions and surface them with a drafted,
   genuinely-helpful answer for the human to post; track past clients for
   referral nudges.

The **strategy brain** (§2) decides each week how to weight these based on what's
converting (from the outcome data in §5), and writes a short human-readable plan.

## 5. Data model (its memory)

```
company_profile     -- what LA Tech sells, regions, price bands, ideal client, tone
                       (the AI's brief; editable by the human)

signals             -- raw items pulled from feeds: source, url, company, raw_text,
                       captured_at, signal_type ('job','forum_post','freelance_post','business')

leads               -- a qualified opportunity derived from a signal (or discovery):
                       company, contact_channel (url/phone/email/handle), region,
                       service_fit, score, reason_to_contact, suggested_opener,
                       strategy ('intent','partnership','audit','community'),
                       status ('new','queued','contacted','replied','won','lost','dnc'),
                       dedupe_key (domain/phone/handle), created_at

qualifications      -- per-lead free-check results: has_website, ssl_ok,
                       pagespeed_mobile, has_booking, has_chat, tech_stack, stale_year

outreach_drafts     -- AI-written message/post per lead, channel, status
                       ('draft','approved','sent','skipped'), sent_at

activities          -- timeline per lead: watched, qualified, drafted, contacted,
                       replied, note (the audit trail)

strategy_runs       -- each weekly plan the AI wrote + which strategies it weighted
                       + outcomes, so it (and the human) can see what's working

suppression         -- do_not_contact list + honored opt-outs, screened on every send
```

Dedupe is first-class: `dedupe_key` + the `suppression`/`status` history mean a
company already worked never resurfaces — the "actually new leads" requirement.

## 6. Screens (single internal user — the founder/CEO)

1. **Command deck** — this week's AI-written BD plan, headline numbers (new
   leads, queued, contacted, replied by strategy), and "approve plan" / adjust
   weights.
2. **Lead queue** — the daily ranked list: company · channel · region · service
   fit · score · reason-to-contact · the drafted opener; actions: approve &
   send / open platform / dismiss / mark DNC / push to portal pipeline.
3. **Lead detail** — signal it came from, qualification breakdown, activity
   timeline, editable draft.
4. **Strategy board** — the five modules, each with its autonomy tier toggle and
   its own conversion stats (revenue-per-strategy so effort follows results).
5. **Content studio** — AI-drafted case studies / posts / audit reports awaiting
   human publish.
6. **Settings** — company profile/brief, region + niche targets, autonomy tiers,
   LLM endpoint + monthly token cap, suppression list, compliance footer/address.

## 7. Safety, legality, and "non-bannable" honesty (hard-coded, not optional)

Rainmaker is explicitly designed to be **safe-by-construction**, because the
failure mode of "aggressive free outreach" is a blacklisted domain and legal
exposure that would cost far more than any tool saves.

- **No unsolicited bulk email, ever.** There is no "blast" feature to build. Email
  is only ever: (a) a bounded sequence (initial + at most 2 follow-ups) that
  auto-stops on reply/bounce/opt-out, (b) to a business/partnership contact, (c)
  from a **dedicated sending domain** (never the company's primary domain), (d)
  with SPF/DKIM/DMARC, a real postal address, and one-click unsubscribe. "Keeps
  sending forever" is intentionally impossible — that pattern is what gets
  domains banned, and no scheduler is "non-bannable"; the honest engineering
  answer is bounded + compliant + separate-domain.
- **No ToS-violating automation.** Anything a platform forbids automating
  (Upwork/Fiverr bidding, Facebook-group posting, LinkedIn DMs) is **Advise
  tier** — the AI drafts, the human acts. Feeds are consumed only via official
  free APIs/RSS or public endpoints within their rate limits.
- **No impersonation, no fake reviews, no deception** in any generated content.
- **Compliance screening** on every outbound: suppression/DNC list, and for UK
  B2B calling, a CTPS-check reminder before a call sheet is exported.
- **The LLM cannot trigger an irreversible external action on its own** — every
  send/post is gated by a human click or a hard-coded compliant path.

These are enforced in code and surfaced in the UI, so the AI's "creativity"
can never wander into behavior that harms the business.

## 8. Build phases (each ships working; all $0 to run except a capped LLM spend)

| Phase | Scope | Done when |
|---|---|---|
| 1 | Foundation: schema, company-profile brief, one intent feed (RemoteOK) → `signals` → `leads`, dedupe | A real hiring signal becomes a deduped lead |
| 2 | Qualification engine: PageSpeed + website-fetch checks → score + reason-to-contact | Leads show service fit, score, honest hook |
| 3 | Lead queue UI + activity timeline + statuses + DNC/suppression | Founder can triage a daily ranked queue |
| 4 | Strategy brain: LLM weekly-plan loop + AI-drafted openers (Draft tier) | AI writes a plan and a tailored message per lead |
| 5 | Multi-source: add HN, Jobicy, Himalayas, Remotive, Reddit feeds | Several fresh intent streams flowing, deduped |
| 6 | Partnership Finder + Audit-Hook modules (OSM/Foursquare + audit report gen) | Two more strategies producing leads |
| 7 | Content studio (case studies/SEO/checker copy) + Community radar | Inbound + community drafts awaiting publish |
| 8 | Compliant outreach: bounded email sequences, separate domain, SPF/DKIM/DMARC, one-click unsubscribe, suppression | A safe, auto-stopping follow-up sequence |
| 9 | Portal bridge: push a won lead to the company portal pipeline via webhook | Chosen lead lands in the sales pipeline |
| 10 | Strategy analytics: revenue-per-strategy, weekly self-adjusting weights | AI reallocates effort toward what converts |

## 9. Success metrics

- Fresh high-intent leads surfaced per week, by strategy and by source.
- Queue→contacted→replied→won conversion, per strategy (so the AI learns).
- Cost per booked conversation (target: ~$0 data + a small capped LLM spend).
- Inbound: checker-tool runs, case-study impressions, organic conversations.
- Time saved: opportunities surfaced automatically vs. found manually.

## 10. Non-goals (explicit)

- Not a mass cold-email cannon (§7 — impossible by design).
- Not a scraper of ToS-protected platforms (LinkedIn, Google Maps live).
- Not a person-level email/phone database (that's a paid product; Rainmaker is
  free-by-mandate and business/opportunity-level).
- Not a full CRM — it feeds the company portal's pipeline for closing/finance.

## 11. Attribution & data-licensing notes

- OpenStreetMap-derived data requires "© OpenStreetMap contributors" attribution
  on any exported list.
- Foursquare OS Places used under its open-data terms.
- All feed usage stays within each source's free rate limits and terms;
  non-commercial-only sources (e.g. Reddit's free tier) are used within that
  scope or via their public RSS.
