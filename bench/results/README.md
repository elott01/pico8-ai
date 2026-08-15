# bench results

Generated files. Each is overwritten by the run that produces it, so treat them as the
record of one measurement, not as a checked-in fixture.

| file | produced by | comparable to |
| --- | --- | --- |
| `ab.json` | `node bench/ab.ts` | other `ab.json` runs, and `*.json` from `baseline.ts` |
| `before.json` | `node bench/baseline.ts before` — **pre-fix runner** | nothing (see below) |

## `before.json` latency is not comparable to anything

It was gathered by a version of `baseline.ts` that had its own inlined copy of the
transport, with **no 429/503 retry** and a 750ms gap that sat under the free tier's
per-minute ceiling. Throttled calls were therefore timed and scored as if they were model
responses. It reports a p95 of **11023ms** where `ab.json` measures the same prompt on the
same model at **5494ms** — that gap is throttling, not the prompt.

Its per-sample records also predate the `status` field, so the bad calls cannot be filtered
out after the fact. The file is kept only as the historical record of that run.

**Use the `current` row of `ab.json` as the production-prompt baseline.** It runs the same
`buildPrompt`, retries transient failures, and scores HTTP 200 samples only.

Both runners now share `_shared.ts` and apply the same rules, so anything generated from
here on can be compared directly. Every summary carries `valid`, `trustworthy` and `gapMs`
so the methodology travels with the numbers.

## `ab.json` holds only the variants of its last run

`--variants` filters which of the four in `variants.ts` actually execute. The committed
file covers `current` and `perception`; `schema-full` and `schema-min` are defined but were
not in that run. Check the `rows` array rather than assuming full coverage.
