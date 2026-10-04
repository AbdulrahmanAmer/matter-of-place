# Audit YYYY-MM-DD

Run id: audit-YYYY-MM-DD
Site: <SITE_URL>
Previous report: <workspace/audits/YYYY-MM-DD.md or none>
Tools: <node version, tool names>
Sources configured: <names from front.sources_configured in the sidecar, never a value>

## Summary

<Line 1: the one thing that matters most this week.>
<Line 2: what moved since the last report.>
<Line 3: what is blocked or not measured.>
<Line 4: the top proposed change.>
<Line 5: the next check.>

## Scorecard

Every number in a table cell is a number of `data/YYYY-MM-DD.json`, in its unit. A source that was not read prints `Not measured`, never `0`.

| Area | Value | Previous | Delta | Status |
|---|---|---|---|---|
| Performance | <score, LCP ms, CLS, INP ms per page; field p75 beside it> | | | |
| Technical SEO | <failed check-seo rows> | | | |
| AEO and GEO | <pages failing JSON-LD; llms.txt present, valid, linked> | | | |
| Keywords | <keywords.covered of keywords.total; Bing queries, impressions, clicks> | | | |
| Channels | | | | |
| Security | | | | |
| Uptime | <30 day percent for the three monitors, interval> | | | |
| Caching | <edge hit ratio or Not measured; headers present; never-cached routes; Set-Cookie; stale> | | | |

## Free-tier gauges

| Line | Used | Limit | Percent | Previous percent | Source | Status |
|---|---|---|---|---|---|---|
| <line id from tools/limits.json> | | | | | | |

## KPIs

| KPI | Value | Previous week | Delta |
|---|---|---|---|
| <label from definitions.ts> | | | |

## Inquiries by source

| Source | Last 7 days | Previous 7 days | Delta |
|---|---|---|---|
| <utm_source or (none)> | | | |

Not measured while `inquiries.attribution` does not exist.

## Analytics trend

| Event | <13 months, oldest first> | Change |
|---|---|---|
| <not_found, web_vitals, csp_report, analytics events> | | |

Not measured while `analytics_daily` holds no row.

## Not found (404)

| Path | Count | Top referrer host | Redirect or slug history |
|---|---|---|---|
| <path> | | | |

## Findings

Ranked by score = impact / effort (impact 1 to 5, effort S = 1, M = 2, L = 3), highest first.

### A-YYYYMMDD-01 Title

- Evidence: <URL, metric, response excerpt or screenshot path>
- Impact: <1 to 5>
- Effort: <S, M or L>
- Score: <impact divided by effort>
- Fix: <the proposed change and the file it touches>
- PR: <link, or proposal only>

## Proposed changes

- <link to each pull request, or "none">

## Not measured

- <source>: <reason>, <what would unblock it>
