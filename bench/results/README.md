# bench results

Generated files. Each is overwritten by the run that produces it, so treat them as the
record of one measurement, not as a checked-in fixture.

| file | produced by | comparable to |
| --- | --- | --- |
| `ab.json` | `node bench/ab.ts` (tic-tac-toe) | other `ab.json` runs, and `*.json` from `baseline.ts` |
| `ab-connect_four.json` | `node bench/ab.ts --suite connect_four` | other Connect Four runs |
| `ab-connect_four-parity.log` | an earlier Connect Four run — **console log only** | see below |
| `before.json` | `node bench/baseline.ts before` — **pre-fix runner** | nothing (see below) |

Runs of the same suite with different `--variants` are different measurements. Pass
`--label <name>` to give one its own file; without it the suite's default file is replaced,
and the runner prints a NOTE when it is about to do that.

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

## The parity run survives only as a log

`ab-connect_four-parity.log` is the console output of the first Connect Four A/B, comparing
`facts` against `facts+parity`. Its samples JSON was overwritten by the next run before
`--label` existed — that clobber is why `--label` exists now. The log is kept rather than a
reconstructed JSON, because reconstructing one would imply per-sample fields (`status`,
`attempts`, `reasoning`) that were never captured.

The result it records, over 42/42 valid samples:

| variant | p50 | tokens | illegal | accuracy |
| --- | --- | --- | --- | --- |
| facts | 680ms | 45 | 0 | 71% (15/21) |
| facts+parity | 652ms | 46 | 0 | 57% (12/21) |

**Adding odd/even threat parity to the prompt made it worse.** It never improved a position
and degraded two (`block-across` 33%→0%, `avoid-gift` 67%→0%). At n=21 the aggregate gap is
only 3 samples, so the number is not an effect size — but the direction was consistent, and
the variant was dropped on that basis. Kept as a record so the idea is not re-tried blind.

## `ab.json` holds only the variants of its last run

`--variants` filters which of the four in `variants.ts` actually execute. The committed
file covers `current` and `perception`; `schema-full` and `schema-min` are defined but were
not in that run. Check the `rows` array rather than assuming full coverage.
