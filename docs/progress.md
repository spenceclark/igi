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

**Gate A: passed** (27 Oct, against Cairn Dev)

- The six-step milestone passed against Cairn Dev, run on the Cairn side and confirmed here on 27 Oct. IGI may now rely on the read-back for committee-pack publication (spec §17.1); the contingency is not needed.
- The candidate-status read-back is merged in Cairn (27 Oct), with the decision record and guardrail amendment, and deployed to Cairn Dev.
- Checked from the Cairn code (read only): the route, field names, wire values, the 1–100 id limit, omission of unknown and others' ids, `evidence: null` for restricted or pre-extension filings, and record details only with "Look up records" all match spec §12.5. Two details added to §12.5: audit entries record counts only, and evidence on a later-cancelled record still reads `active`.
- IGI has not yet called the deployed route itself: every `/api/intake` path returns `401` without a key. Its first call comes with the Cairn client (Fri 30 – Sat 31 Oct), using the "IGI" agent's key for Cairn Dev.

**Spec v0.4** (`1816716`, written outside this session)

- Database and file storage move from Supabase to DigitalOcean Managed PostgreSQL and Spaces: a separate IGI database, user and private bucket on the existing Cairn Dev subscription, never Cairn's own.
- A submitted material finding is publication-ready only when both its assertion and its investigation-package file are filed and active for the same finding version; an incomplete pair blocks the final pack, and voiding either item makes a pack stale.
- No impact on the Gate B code: the ledger, snapshot and pack are not built yet.

**Spec v0.5**

- Issues found in v0.4 and resolved: a finding the reviewer rejected in Cairn blocked the final pack permanently, nothing let the operator clear an abandoned or voided submission, "material finding" was undefined, and a "no exceptions" pack could omit potential exceptions the operator never submitted.
- Resolved by: a material finding is any submitted finding; each finding version has a state (not submitted, pending, publication-ready, rejected, incomplete, withdrawn) with a precedence order (§6.7); a discarded assertion means rejected, excluded and counted; operator withdrawal in IGI with a mandatory reason; a pack with no findings needs every potential exception from the latest run rejected or withdrawn (§6.8).

**Spec v0.6** (`b220fd0`, written outside this session)

- Adds cross-review memory as the first priority stretch: logical agent definitions, run, review, handover and agent memory scopes, human-confirmed operational knowledge, clarifications that start a new run, and IGI-owned generated files. Cairn platform ideas are recorded as post-hackathon candidates only.

**Spec v0.7**

- Issues found in v0.6 and resolved:
  - a generic `RunArtifact` index and agent and company ids had entered the MVP;
  - with one company and one agent definition, knowledge approved in a demo review would have been supplied to holdout runs;
  - the memory text in §1–2 was not labelled stretch;
  - one open question ended the whole run;
  - the handover's derivation and "relevance" were undefined, and nothing said where remembered knowledge enters the prompt;
  - giving Spark last month's pack invited stale values;
  - the continuity fixture needed source data the generator does not have;
  - the public spec named a private Cairn component.
- Resolved by:
  - MVP files are referenced from the rows that already own them, and the index moved to the stretch;
  - evaluation runs use an empty knowledge store, and the freeze records whether the memory tools are on;
  - open questions use the existing `open_question` note kind while the run continues;
  - the handover is derived in code, and knowledge goes in a delimited data block, never in `instructions`;
  - the priority slice is narrowed to one clarification, `propose_knowledge` and the October-to-November reuse, using a `source` column on look-through rows.

**Open**

- Register the "IGI" agent in Cairn Dev (spec §12.2) and put its key in `server/.env` before the Cairn client is built.
- Create the IGI database, database user and private Spaces bucket with scoped keys (spec §10.1), and put the connection details in `server/.env`.
- Choose the investigation-package file format by how it previews in Cairn (spec §12.2). Gate A tested an assertion only, and the file is now mandatory for publication.
- Gate B observations for later: Spark sweeps every catalogue check across every portfolio before forming hypotheses, so the checks, not Python, do most of the discovery. The holdout therefore needs at least one issue type no catalogue check covers; the overdue-action findings show Spark can find those. Classifications for the notification trigger vary between runs (observation, outstanding action).
- The leak scan is a throwaway script; make it part of the evaluation harness so it runs before every evaluation.
- Cairn demo environment to confirm (default: Cairn Dev).
- Re-run the Monty smoke test on the DigitalOcean service at first deploy.

