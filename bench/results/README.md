# bench results

Generated files. Each is overwritten by the run that produces it, so treat them as the
record of one measurement, not as a checked-in fixture.

| file | produced by | comparable to |
| --- | --- | --- |
| `ab.json` | `node bench/ab.ts` (tic-tac-toe) | other `ab.json` runs, and `*.json` from `baseline.ts` |
| `ab-connect_four.json` | `node bench/ab.ts --suite connect_four` | other Connect Four runs |
| `ab-connect_four-parity.log` | an earlier Connect Four run — **console log only** | see below |
| `before.json` | `node bench/baseline.ts before` — **pre-fix runner** | nothing (see below) |
| `talk.json` + `talk.md` | `node bench/talk.ts` (gem-in-eye's dialogue) | other `talk` runs with the same `--variants` and fixtures |

Runs of the same suite with different `--variants` are different measurements. Pass
`--label <name>` to give one its own file; without it the suite's default file is replaced,
and the runner prints a NOTE when it is about to do that.

## `*-flash-lite-3.5` files are the model switch

Every file without that suffix was measured on `gemini-3.1-flash-lite`. The
`-flash-lite-3.5` runs repeat only the shipping variant of each suite on
`gemini-3.5-flash-lite`, with the same run counts, to check the switch: compare
`ab-tic_tac_toe-flash-lite-3.5.json` with the `schema-full` row of `ab-tic_tac_toe-enum.json`,
`ab-connect_four-flash-lite-3.5.json` with its `facts+threats` row, and
`talk-flash-lite-3.5.json` with `talk-ab-v4.json`. Accuracy held in both games. Latency fell
sharply, the talk p95 from 13.0s to 1.2s. The speeches garbled or invented a number in
about 7 of 45 (`forty-one sixteen` for agent 4016 with 41 new prunes), which 3.1 did not.

## `talk-digits` and `talk-agent-digits` chose the agent-number rule

Two fixes for those numbers, measured with the `stray(speech/notice)` column, which flags
any number in a line that the fixture's stats don't support. Both variants are at commit
`936982a`; the winner is now part of `current`.

| run | variant | stray speeches | stray notices | opens with a number |
| --- | --- | --- | --- | --- |
| `talk-flash-lite-3.5` | `current` (words) | 7/45 | 3/45 | 0 |
| `talk-digits` | `current` (words) | 6/45 | 1/45 | 0 |
| `talk-digits` | `digits`: every number as digits | 3/45 | 2/45 | 15 |
| `talk-agent-digits` | `agent-digits`: only the agent's own number | 3/45 | 0/45 | 2 |

`digits` halved the strays but cost the voice: a third of its speeches opened with the
agent's number against an owner rule, and the lines read as stat readouts ("agent 4014,
depth 8 with 140 pruned and only 2 rollbacks"). `agent-digits` matched it on strays and read
like the control. Its one remaining fusion was the agent's number used as a count, spelled
out: "forty-one hundred agents" for agent 4014. `talk-agent-digits` has no control of its
own; compare it with both `current` rows above, which ran on the same model the same day.

## The `talk` runs measured prompts that are no longer in the code

`current` always means the shipping prompt. The four runs here are how it was chosen, and
three of the variants they name have since been removed from `api/_talk_prompt.ts`:

| file | variants | what they are |
| --- | --- | --- |
| `talk.json` | `current` | the first prompt, v1, which was shipping at the time |
| `talk-ab-v2.json` | `current`, `v2` | v1 again, against v2 |
| `talk-ab-v3.json` | `v3`, `v3-notice`, `v3-temp-1.3` | v3 three ways |
| `talk-ab-v4.json` | `v4` | v4 with the notice step: the prompt that shipped, before it was renamed `current` |

To re-run an old version, its prompt and variant list are at commit `e3b5902`:
`git show e3b5902:api/_talk_prompt.ts`. The A/B ideas that were never run (`rates`,
`examples`, and temperatures 0.8 and 1.2) are there too.

## `talk` runs are read, not just scored

A speech has no right answer, so most of `talk.json`'s columns are flags rather than grades:
`specific` (does it point at this agent's numbers or purchase), `saysPrice` (it recites the
price the shop already shows), `memRepeat` (it rewords a line from its memory), and variety
within a fixture (distinct speeches, reworded pairs). Only two fixtures carry an expected
verdict, the owner's own praise and mockery examples, and the price is checked for being in
band. `talk.md` is the same run as a list of every speech, paged the way the cart would show
it. Reading that file is the actual review; the numbers only say where to look.

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
