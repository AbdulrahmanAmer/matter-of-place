# Audits

The weekly audit of the live site: what it measured, what it could not, what it proposes. A routine runs it on Saturday mornings through the `mop-auditor` agent; a person can run it by hand.

## What is here

| Path | What it is |
|---|---|
| `YYYY-MM-DD.md` | The report of that run, from `REPORT-TEMPLATE.md`. |
| `data/YYYY-MM-DD.json` | The sidecar: every number of the report, and the input of the next run's deltas. |
| `REPORT-TEMPLATE.md` | The report sections, in order. `scripts/audit/lint-report.mjs` checks a report against them. |
| `ROUTINE-PROMPT.md` | The exact prompt the routine runs, with its PR flow. |
| `keywords.json` | The terms Search Console coverage is measured against (`terms`). |
| `tools/` | One script per source. Everything a script can measure is a script (zero tokens); the model only ranks, explains and writes patches. |
| `tools/fixtures/` | Recorded or documented-shape answers the tests read. Replace one with a real recorded answer when a live run has produced it. |
| `monitoring/uptime.json` | The three uptime monitors the owner sets up, and what the collector expects. |
| `monitoring/cost-alerts.md` | The vendor usage notifications to switch on, and who confirmed them. |

## Running it

Run from the repository root.

```
node workspace/audits/tools/run-all.mjs --check-credentials
node workspace/audits/tools/run-all.mjs --manual
node workspace/audits/tools/run-all.mjs
```

- No flag: the scheduled run. It reads `schedule_settings.audit` first; when `enabled` is false it prints `skipped, disabled`, writes nothing and exits 0. If the read fails the run goes on and records it under `not_measured`.
- `--manual`: a person's run. It skips that check and records `schedule: manual` in the sidecar. The routine never passes it.
- `--check-credentials`: one `ok` or `missing` line per name, never a value. Exits 1 when a required name is missing.
- `--collect-only`: writes the sidecar and stops, with no `record_run` call. For the collector workflow only.
- `--from-data <branch>`: takes the vendor numbers (PSI, Search Console, Bing, GA4, uptime) from the sidecar on that branch and runs the rest. A missing branch or file is recorded as `from_data` and the vendor collectors run as usual.

Each run that gets past the schedule check records itself once through `POST /api/admin/audit/record-run`, after the last collector and before the sidecar is written. A failed call is recorded and never stops the run.

Each collector also runs alone: `node workspace/audits/tools/<name>.mjs [--url <site>]`. It prints what it found and exits 0 whatever it finds.

## The sidecar

`data/YYYY-MM-DD.json` is one object. A source that gave a number is a key; a source that did not is a reason under `not_measured`, never a missing report.

```
front             date, run_id, schedule (scheduled or manual), site_url, previous, tools, sources_configured
psi               pages: path, score, lcp_ms, cls, inp_ms, weight_bytes (median of three runs, mobile)
seo, aeo          failed checks; JSON-LD failures by path; llms.txt present, valid, linked
gsc, keywords     Search Console queries; covered, total and missing terms of keywords.json
bing              queries, impressions, clicks over 28 days
ga4               sessions and events over 7 days
uptime            monitors (url with the ops-health token redacted, interval_s, status, uptime_30d), rows
cache             edge_hit_ratio (null with a reason where the Cache API does nothing), headers, never-cached, checks
record_run        status of the record-run call
not_measured      key: reason
```

An uptime URL holds a secret path segment (`/api/hooks/ops-health/<token>`). The collector writes it as `<redacted>`, and the lint refuses any other value.

## Reading a report

1. `## Summary` is five lines. Read it first.
2. `## Scorecard` shows each area with its value, the previous value, the delta and a status. `Not measured` means the source was not read; it never means zero.
3. `## Findings` is ranked by score, impact divided by effort, highest first. Each names its evidence and the file a fix would touch.
4. `## Not measured` lists every source that failed or was not configured, with what would unblock it.

## Credentials

Set in the routine's environment, never in the repository. `run-all.mjs --check-credentials` lists the names. A name that is not set is a source under `not_measured`.
