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

## The four-variant tic-tac-toe run (2026-08-12)

Predates `--label`, so `ab.json` was later overwritten and holds only two of these four.
The full table is kept here because it is the only surviving record, and because two of the
variants it rules out are the obvious things to re-try.

Nine positions, 3 runs each, direct to Gemini. Rate-limited calls excluded.

| position | `current` | `schema-full` | `schema-min` | `perception` |
| --- | --- | --- | --- | --- |
| empty / win-only / block-only / win-or-block / near-full | 100% | 100% | 100% | 100% |
| **quiet** (centre occupied) | 0% *(illegal)* | 0% | **100%** | 67% |
| **block-edge** (block is an edge) | 100% | 100% | 100% | **0%** |
| **fork-create** | 0% | 0% | 0% | **100%** |
| **fork-block** (the documented weakness) | 100% | 100% | 0% | 0% |
| illegal moves | **3/27** | **0** | 0 | 0 |
| output tokens | 535 | 567 | 30 | 50 |

Three findings worth not re-deriving:

- **`schema-full` eliminates illegal moves at no accuracy cost.** Confirmed and shipped —
  see `ab-tic_tac_toe-enum.json` below.
- **Computing the line facts made play worse, not better.** The premise was that the model
  is bad at the arithmetic; it is not — `winMove`/`blockMove` were 100% correct on every
  variant that emitted them. Generating the derivation buys *attention*, not arithmetic:
  writing out all eight lines forces the model to look at all eight. Handed the same facts
  as a table it skims, and `perception` missed an immediate block it had been given
  (*"No winning or blocking moves available, so I am choosing a corner"*).
- **Forks are the one thing the model cannot derive.** Only `perception` ever solved
  `fork-create`. Connect Four independently reproduced the same blind spot: `double-threat`
  is 0/9 across every variant tested there, always answered with centre. Two carts, two
  prompt styles, same failure — treat two-ply sight as a property of the model, not of a
  prompt that needs more work.

## `ab-tic_tac_toe-enum.json` — the confirming run (2026-08-18)

`current` (no schema) against `schema-full`, 9 positions x 3 runs, before shipping the enum.
Decision rule fixed in advance: ship only if illegal reaches 0 **and** no position regresses.

| | current | schema-full |
| --- | --- | --- |
| illegal | 3 | **0** |
| accuracy | 78% | 78% |
| output tokens | 543 | 567 (+4.4%) |

Per-position accuracy was **identical on all nine**, `fork-block` and `block-edge` included.
The 3/27 illegal reproduced exactly six days after the first run, which is the more useful
result: the fixture suite is stable enough to detect a change of this size.

**Ignore the latency columns in that file.** It ran at the old 3s gap — 20 calls/minute,
above the free tier's 15 RPM — so the harness was queueing itself, and variants run
sequentially, so the second one carries more of it. The default gap is now 5s. Use
`bench/latency.ts` for timing questions.

## `ab.json` holds only the variants of its last run

`--variants` filters which of the four in `variants.ts` actually execute. The committed
file covers `current` and `perception`; `schema-full` and `schema-min` are defined but were
not in that run. Check the `rows` array rather than assuming full coverage.
