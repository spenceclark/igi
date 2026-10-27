# Progress Sheet

## 2026-10-27

**Completed**

- Specification rewritten to v0.2, then v0.3 (`9068693`): Cairn read-back extension, Gates A and B, seven agent tools, submission ledger, dev/holdout evaluation.
- Candidate-status read-back contract (spec §12.5) approved as the API boundary, with its defaults.
- Cairn change proposal drafted for a Cairn-repository session. Not yet applied in Cairn.
- Monty smoke test (`npm run smoke:monty`): all required checks pass on Windows 11 x64 (Node 26.8.2) and Linux x64 Debian trixie (Node 24.22.1, Docker).
- Meta Model API probe (`npm run probe:meta`) from the UK: tool calling works on Chat Completions and the Responses API. Cost $0.006.
- Decided: the agent loop uses the Responses API, stateless, with encrypted reasoning held in memory only (spec §10.1, §8.5).

**Issues found and resolved**

- Monty 1.3.0 (npm `latest`) has no `decimal` module. Pinned 1.4.0 (npm `next`, published 26 Oct). Fallback if 1.4.0 misbehaves: 1.3.0 with money as integer minor units.
- Monty's Linux binary needs glibc 2.38 or later and fails on Debian bookworm (`undefined symbol: __isoc23_sscanf`). Deployment will be a Debian trixie or Ubuntu 24.04+ container.
- Chat Completions does not carry the model's reasoning between turns. Resolved by choosing the Responses API.
- Monty's `CollectString` output cap rejects a whole burst rather than truncating. Resolved: the Monty adapter truncates in its own print callback.
- The v0.1 spec linked to the private Cairn repository. Removed in v0.3; the links remain in the pushed history of `2727b6c`.

**Gate B build (started)**

- `fixtures/generate.ts`: seeded scenario generator. `dev-01` and `dev-02` each plant a look-through equity breach hidden behind multi-asset funds, a single-holding breach that only exists under the limit in force from 1 July 2026, an overdue committee action, and a large but market-driven fall. `dev-02` adds a policy document/rules disagreement. The generator evaluates every rule at every period end and refuses to write a scenario whose breaches differ from the planted ones or that has a borderline case. Answer keys go to `eval/answer-keys/`.
- `server/src/`: importer and §7.3 validation (`sources.ts`), BigInt decimal arithmetic (`decimal.ts`), five trusted checks (`checks.ts`), Monty adapter (`sandbox.ts`), Responses API client (`model.ts`), the seven tools with the finding validation gate (`tools.ts`), and the agent loop with budgets and a JSON trace in `server/runs/` (`agent.ts`).
- `server/scripts/investigate.ts` runs an investigation from the command line. The trace goes to a JSON file only; the database arrives with persistence.
- Tests: `node --test test/core.test.ts` in `server/` (decimal, CSV, import validation, figure matching); `node eval/verify-checks.ts` from the root cross-checks the trusted checks against the generator's independent figures (48 facts, both scenarios agree).

**Gate B runs** (`muse-spark-1.3`, reasoning effort medium, prompts and tools unchanged between runs)

| | dev-01 (clean re-run, `run-dev-01-20261027T121004`) | dev-02 (unseen until dev-01 passed) |
|---|---|---|
| Status | completed, 17 turns, 34 tool calls, $0.164 | completed, 21 turns, 46 tool calls, $0.176 |
| Python runs | 2, both first time, both follow-ups to the check results: prior-period exposures, and the weight changes driving the breaches | 4; X1 failed with a TypeError and X2 corrected it |
| Planted issues found | 3 of 3: look-through equity breach (F1), single-holding breach under the 1 July limit (F2), overdue Fenwick action (F3) | 4 of 4: look-through equity breach (F1), single-holding breach under the 1 July limit (F2), overdue Mardale action (F3), policy document 8% vs rules 10% (F5) |
| Benign anomaly | Growth -8.7%: notification trigger, deviation within the 1.5pp tolerance (F4, outstanding action) | Balanced -6.2%: notification trigger, "tracked its benchmark closely" (F4, outstanding action); also the completed Brackley exit explained (F8, explained anomaly) |
| Unsupported breach claims | none | none |

Gate B criteria met on both, with one caveat: dev-01 used Python twice in both of its runs, leaning on the trusted checks, so "several times" is borderline there; dev-02 used it four times. The look-through joins happen inside the `lookthrough_exposure` check; the overdue actions (F3 in both) are the findings Spark joined itself, with no check covering them.

Issues found and resolved during the build:
- The first dev-01 run (`run-dev-01-20261027T120335`, same results) used a `propose_finding` description whose example figures were dev-01's planted value (0.3697, 36.97%), copied in from testing. Replaced with neutral figures and dev-01 re-run. dev-02 was unaffected (not one of its figures). A scan of every answer-key figure, fund name and id against the instructions and tool definitions now finds none.
- Monty passes Python keyword arguments to host functions as a trailing null-prototype object and dicts as `Map`; the adapter's `hostFunction` tells them apart.
- Figure matching compares at the precision stated, so "37%" and "0.37" both validate 0.3697; "38%" does not.

**Open**

- Gate A: under way in a separate Cairn-repository session.
- Gate B observations for later: Spark sweeps every catalogue check across every portfolio before forming hypotheses, so the checks, not Python, do most of the discovery. The holdout therefore needs at least one issue type no catalogue check covers; the overdue-action findings show Spark can find those. Classifications for the notification trigger vary between runs (observation, outstanding action).
- The leak scan is a throwaway script; make it part of the evaluation harness so it runs before every evaluation.
- Cairn demo environment to confirm (default: Cairn Dev).
- Re-run the Monty smoke test on the DigitalOcean service at first deploy.

