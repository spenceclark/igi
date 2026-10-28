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
- IGI has not yet called the deployed route itself: every `/api/intake` path returns `401` without a key. Its first call comes with the Cairn client (Fri 30 – Sat 31 Oct), using the "IGI" agent's key for Cairn Dev. (Done 27 Oct; see the Cairn client below.)

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

**Spec v0.8**

- The "IGI" agent is registered in Cairn Dev and its key is in `server/.env`.
- The investigation package is a Markdown file, which Cairn previews as formatted text (spec §12.1).
- Removed §20 (post-hackathon direction and Cairn platform candidates): a Cairn strategy document now covers it.
- The end-to-end build uses a local Postgres; the DigitalOcean database and bucket wait until deployment.

**Cairn client and test double** (spec §12, §17.3 item 3)

- `server/src/cairn.ts`: the intake v1 client (`findSubject`, `listStartableProcedures`, `startRecord`, `findRecords`, `getRecordSteps`, `submitAssertion`, `submitFile`, `getCandidateStatus`). It never retries. A problem with a `code` throws `CairnRefused` (nothing was created); a timeout, dropped connection or response without a usable body throws `CairnUncertain`, which the ledger will record as `uncertain` (§12.4). Status requests go 100 ids at a time; file bodies are bytes, so Content-Length is exact; the source-reference header is always percent-encoded, because Cairn always decodes it.
- `server/src/cairn-fake.ts`: the test double (§12.6) is a `fetch` serving the same routes, shapes, problem codes and limits (60 requests per 10 minutes with `Retry-After`, 100 unfiled, 25 untouched records, 4,000-character assertions, 200-character one-line references, unsupported file types), seeded with the §12.2 subject and five-step procedure. Hooks stand in for people in Cairn: file, discard, void, restrict a record, act on a record, and a response lost after the request was handled.
- `test/cairn.test.ts` runs the real client against the double: repeated starts, every candidate state the pack depends on (unfiled, filed and active, discarded, voided, restricted with `evidence: null`, unknown ids left out), refused versus uncertain, and the limits. `npm test` now runs every test file (10 pass).
- `npm run probe:cairn` asks Cairn Dev for the status of one random id, using `CAIRN_BASE_URL` and `CAIRN_AGENT_KEY` from `server/.env`. First run on 27 Oct: `200` with no items in 309 ms, so the IGI agent's key works against the deployed read-back. Nothing was created in Cairn.

## 2026-10-28

**Persistence** (spec §11, §17.3 item 5)

- A local PostgreSQL 18 container, `igi-postgres` on port 5434 (`npm run db:up`), separate from Cairn's. The DigitalOcean database replaces it at deployment through `DATABASE_URL`. Client: `postgres` 3.4.9, the server's second dependency.
- `server/src/schema.sql`, applied idempotently on start: `review`, `analysis_run`, `trace_event`, `code_execution`, `check_result`, `note`, `finding` (one row per version, with withdrawal and the investigation-package file and hash) and `cairn_submission` (the §12.4 ledger, `sending` by default, plus an `abandoned` outcome added to §12.4). `analysis_run` holds the constant agent-definition id and records `memory_enabled: false` and `knowledge_ids: []` (§15.2).
- `server/src/db.ts`: `migrate`, `saveReview`, `saveRun` and `loadRun`. The agent loop saves the run after every turn and at the end, so a run in progress can be read; it never passes the encrypted reasoning. `scripts/investigate.ts` saves the scenario as a review first and no longer writes `server/runs/`.
- Not yet: source documents and domain rows (sources are still read from the scenario folder until uploads, §6.2), snapshots and packs (§13). One schema file and no migration tool until a deployed database holds data worth keeping.
- `test/db.test.ts` (in the `igi_test` database, skipped when the container isn't running): a run saved mid-loop and again at the end reads back whole, including array and string values in jsonb; ledger entries start `sending` and must reference an existing finding version; a withdrawal needs a reason. `npm test`: 12 pass.
- End to end on dev-01 (`run-dev-01-20261028T103251`, prompts and tools unchanged): `completed_with_uncertainties`, 18 turns, 37 tool calls, $0.150. Saved: 55 trace events (18 model turns, 37 tool calls), 2 executions, 20 checks, 6 findings. The three planted issues were found again (F1 look-through equity, F2 single holding under the 1 July limit, F3 overdue Fenwick action), plus the Growth notification trigger (F4).

Issues found and resolved:
- jsonb columns only take an array or string through `sql.json`; a bare array is sent as a Postgres array. Every jsonb value is wrapped.
- Under Docker Desktop on Windows, connections to `localhost:5434` sometimes timed out when several opened at once (`CONNECT_TIMEOUT` in `loadRun`). The local URLs use `127.0.0.1`; three consecutive test runs passed.

**Strong types**

- `server/tsconfig.json` (strict, erasable syntax only, `verbatimModuleSyntax`) with `@types/node`, and `npm run typecheck` (TypeScript 7.0.2). AGENTS.md now asks for precise types, with `any` only where no type can be written.
- Every explicit `any` in `server/src` and `test/` replaced: the Responses API items and usage (`model.ts`), the model's tool arguments, which must now be a JSON object (`agent.ts`, `tools.ts`, with `FindingArgs` matching `propose_finding`'s schema), Cairn responses and problem details (`cairn.ts`), the test double's request bodies, and database rows (`db.ts`). `scripts/meta-probe.ts` and `scripts/monty-smoke.ts`, one-off probes, still use `any`.
- Issues the type check found and resolved: the Cairn client passed a `Uint8Array<ArrayBufferLike>` where `fetch` needs `Uint8Array<ArrayBuffer>`; `saveRun` passed `undefined` for an unfinished run's end time and an unrevised finding's `superseded_by` (the `undefined: null` transform covered it at runtime); the database test's finding had no `explanation`, which `propose_finding` requires. Type check clean; `npm test`: 12 pass. No paid run: the loop's only behavioural change is refusing tool arguments that are not a JSON object.

**Submission ledger, status read-back and finding states** (spec §6.1, §6.5–§6.7, §12.3–§12.5)

- `server/src/package.ts` composes what is submitted for a finding version, deterministically and only from IGI's records of the run: the plain-text assertion (title, classification and validation, statement, key figures with their checks, policy rule and version, IGI finding, version, run and review ids; at most 4,000 characters, a long statement cut with a pointer to the package) and the Markdown investigation package (finding, explanation, validation, assumptions, uncertainties, methodology, source files with SHA-256, cited rows, cited checks with arguments and results, cited executed code with outputs, run versions). Spark's text and outputs sit in code fences longer than any backtick run they contain. On dev-01's F1 the package is about 10 KB.
- `server/src/files.ts` keeps generated files, written once, in `server/files/` (gitignored) until the Spaces bucket replaces it at deployment. A package is composed and stored at its version's first submission; a resend sends the stored bytes, so the ledger's file hash always equals the finding's `package_sha256`.
- `server/src/ledger.ts`:
  - `openRecord` lists the subject's startable procedures, picks the configured one by name, starts the record with the source reference `IGI review <id>` and stores the record and its steps on the review; it returns the stored record after that.
  - `submitFinding` sends whichever of the assertion and package has no live entry (never sent, refused or abandoned), writing each ledger row as `sending` before its request and outside any transaction. A refusal records its code; a lost response records `uncertain` and is never resent until the operator abandons it (`abandonEntry`). Placement follows the classification: data quality and missing information to step 1, outstanding actions to step 4, everything else to step 2, with the assertion and document slots found by kind; a step missing from the record means no proposal. Fee findings therefore go to step 2, not step 3.
  - `refreshStatus` reads back every submitted candidate in the review in one batched call and records each status, or `not-reported` when Cairn leaves an id out.
  - `findingState` derives each version's state from its latest entry per item, in the §6.7 order. A send that never finished reads as uncertain, so pending.
  - A finding Spark revised (`superseded_by`) is refused; its revision is submitted instead. Spec §6.1 amended: the startable-procedures call also confirms the subject exists, so there is no separate subject lookup.
  - `withdrawFinding` requires a reason and is final; `newVersion` puts a withdrawn finding forward again as the next version, with the same content and its own package.
- `test/ledger.test.ts`: 19 finding-state cases, the assertion limit, and the whole flow on the test double (record opening; placement on the mapped step and slots; pending, publication-ready, voided; a lost response that landed anyway, not resent until abandoned; a rejected finding; a package refused by the rate limit and resent alone with the same bytes; withdrawal and version 2). Test files now use their own databases (`igi_test_db`, `igi_test_ledger`) because `node --test` runs them in parallel. `npm test`: 15 pass; type check clean.
- Not yet: the once-a-minute polling (with the server; the refresh before a snapshot came with the pack), and a real submission to Cairn Dev, which needs the governance subject's reference and the procedure's name.

**Reviewed snapshot and committee pack** (spec §6.8, §13; spec v0.10)

- `server/src/committee-pack.ts`:
  - `generatePack` reads back every candidate in the review, re-checks earlier packs, and resolves each finding by its latest version. It returns what blocks a final pack instead of generating one: a pending or incomplete finding (with both items' states), a pack with no findings that §6.8 doesn't allow (the latest run not completed, or a potential exception neither submitted nor withdrawn), or source files whose hashes differ from the latest run's. A Cairn read that fails throws, so no pack comes from an old read-back.
  - The snapshot holds everything the pack shows: both accepted items of each publication-ready finding (candidate id, Cairn evidence, hash submitted), the finding's statement, explanation, figures, policy comparisons and uncertainties, the counts of rejected, withdrawn and not-submitted findings, the source register with hashes and validation issues, the run's versions, policy rules in force, open committee actions, and each portfolio's look-through allocation at the last two period ends, computed with the `lookthrough_exposure` check. Its SHA-256 is over its JSON with keys sorted, so it verifies after the jsonb round trip.
  - `renderPack` is a pure function of the snapshot: executive overview, portfolio overview with bars, material findings, outstanding governance items, appendix (source register, rules, method, references, accepted evidence manifest, snapshot hash). Every string is escaped; `@media print` for the browser's PDF. The HTML is stored once under a key that includes the snapshot hash.
  - `markStalePacks` marks a pack stale, with the reason, when an included item is no longer filed and active on the record or an included finding is withdrawn; `checkPacks` reads back first and is what polling and opening a pack will call. `listPacks` marks every pack but the latest as superseded.
- `committee_pack` table: one row per version with its snapshot, the snapshot and HTML hashes and the stale columns, which are the only ones that change.
- `test/pack.test.ts` on the test double: pending findings and an unsent exception block; v1 holds only the accepted finding, its hash verifies after storage, the HTML is reproducible from the snapshot, escapes model text, and shows rejected and unsent findings only as counts; v2 supersedes v1; withdrawal marks both stale; a voided assertion marks v3 stale and blocks regeneration; a pack with no findings is blocked by a failed run and allowed once every potential exception is rejected or withdrawn; changed sources block. `npm test`: 16 pass; type check clean.
- Rendered from dev-01's real run (six findings, filed in the test double, on a copy of the local database): the overview, allocation tables, findings with their policy comparisons and the evidence manifest read correctly.
- Issues found and resolved: the not-submitted count included the earlier run's findings, which the later run replaced; it now counts the latest run only. The overview items were wrapped in list items twice. The spec named "points for committee discussion" and "charts from reviewed information", which the pack can't supply without inventing content or presenting source data as reviewed; §13.4 now says what the pack shows instead.
- Not yet: the once-a-minute polling loop and the pack view's re-check, which call `checkPacks`, and the withdraw route calling `markStalePacks` after `withdrawFinding` so a withdrawal marks a pack stale at once (all with the server); a preview of a blocked pack, which the spec allows but doesn't require.

**Real Cairn: setup checked, run script** (spec §12)

- Cairn Dev is set up for IGI (§12.2): the governance subject, the published review procedure and an IGI agent in the same workspace, configured in `server/.env` as `CAIRN_SUBJECT_REFERENCE` and `CAIRN_PROCEDURE_NAME`. Read-only checks with the agent's key: the status read-back answers, the subject is found and the configured procedure is startable for it. The step and slot names can only be checked once a record starts.
- `server/scripts/cairn-run.ts` (`npm run cairn -- <command> <review>`) drives a review against real Cairn until the UI does: `open` starts the record and checks its steps; `submit` submits the latest run's findings, or the ones named; `status` reads back and shows each finding's state; `pack` generates the next pack or lists what blocks it. `open` and `submit` write to Cairn.
- `placementGaps` in the ledger lists where a record doesn't fit the classification-to-step mapping (a missing step, or a step without an assertion or a document slot) and the classifications whose evidence would wait in the Tray; tested on the test double. `npm test`: 16 pass; type check clean.
- Issues found and resolved: the first agent key belonged to another Cairn Dev workspace, so the subject lookup answered `subject.not-found`; a new agent in the subject's workspace fixed it. An older `CAIRN_AGENT_KEY` in the user's Windows environment overrode `server/.env`, because Node's `--env-file` never overrides a variable that is already set; until it is removed, run with that variable unset.
- First real submission: `open` started dev-01's record on Cairn Dev; all five steps matched the mapping, each with a statement slot (assertions), a documents slot and Cairn's "Additional evidence" slot, which IGI never proposes since it comes last. `submit` sent the latest run's six findings: 12 candidates, every one `placed` on its proposed step and slot. The read-back shows all six pending with both items unfiled, and Cairn's record page shows them as proposed.
- Seen on Cairn's record page: the statement slots are marked "single item only" but take four and two proposed assertions. Cairn doesn't return that setting to agents and, as far as its code shows, only displays it; filing anywhere on the record satisfies IGI. The assertions' key figures read as bare fractions ("0.3697") beside a statement in percent, against §12.3's "key figures with units": the figure description invited it with "0.1234" as its first example. It now asks for each figure with its unit (12.34%, 0.5pp, £1,000,000), with other units in the label; validation already matched those against a check's fractions, and the figures test now covers negative and small percentages. A Spark run on a copy of dev-01 (review `dev-01-units`, so dev-01's latest run stays the submitted one; completed, $0.23) stated every figure with its unit, such as 36.97%, -8.70%, 0.42% and £42148542.00, and all nine findings validated.
- Filing in Cairn: four findings were filed whole and read back `publication_ready`; F3's package and both of F5's items were filed then voided (F5 on a step other than the one proposed, which IGI accepts since it checks only the record). `pack` was blocked by F3 and F5 as incomplete, naming the voided items. The script gained `withdraw <review> <id> <reason>` and `new-version <review> <ids>`; F3 and F5 v1 were withdrawn with reasons, put forward as v2 and submitted (all four candidates placed), and read back pending. F3 v1's accepted assertion stays active evidence in Cairn, since IGI changes nothing there; whether to void it is for the person filing.
- First final pack from real Cairn: once F3 and F5 v2 were filed, every finding read back `publication_ready` and `pack` generated v1 with all six. Each finding's assertion and package are active Cairn evidence on the review's record; the snapshot and file hashes verify and the HTML re-renders identically from the snapshot; none of the voided or withdrawn v1 items appear, and the withdrawn v1s count as history, not as withdrawn findings.
- Comments for reading the code: every function in `server/src` has a header saying what it does and why, and the non-obvious blocks (validation rules, decimal rounding, the agent loop's stopping rules, figure matching, the ledger's due items, `distinct on` and the window function, the pack's blockers) have a comment. Only comment lines changed, checked against a copy taken before; type check clean, 16 tests pass.
- Noticed in the real pack, not yet changed: the portfolio overview's Change column shows a difference of two percentages as "+3.38%" where "pp" is meant; the evidence manifest shows step and slot ids where their names (on the review's stored record) would read better.

**First end-to-end review: fixes** (spec v0.11)

Reviewing the first real pack (dev-01 v1) beside the Cairn record's printout.

- Root causes confirmed:
  - **F3's earlier version still active.** The ledger and the status read-back were right: they record and read back every version's items, and showed F3 v1's assertion filed and active. The gap was the pack. `resolveFindings` looks only at each finding's latest version, and §6.7 called a withdrawn earlier version "history" that "neither counts nor blocks". So the pack included F3 v2 while the record still held v1's assertion beside it. F5 differed only because a person happened to void both of its v1 items.
  - **Misleading comparisons in F3 and F4.** The pack showed every comparison in every check a finding cited. C4 (concentration) is cited for Fenwick's weight, but its comparison is about the largest holding. C15 is cited for Growth's return, but its comparison is the relative-performance tolerance.
  - **Run status said "uncertainties" while every finding said "None stated."** The run had no notes at all. Its status came only from F6 being "unvalidated", which here meant an observation with no figures to validate. The genuine open matters (whether the notification was given, the remediation plans) were only in Spark's free-text summary.
  - **F5 placed in allocation and risk.** IGI chose that step from the classification ("observation"); the person filed it where proposed. Classification can't tell a fee matter from an allocation one.
  - **Wrong primary subject.** An operator setup choice in `server/.env`, not code. The record can't be moved to another subject.
  - **"Single item only" with four items.** The procedure's author set the slots to one item. Cairn displays that setting but enforces it nowhere, and doesn't return it to agents. So it is a procedure configuration error with misleading wording, not a cardinality defect in submission versus active evidence.
  - **Build `98157a6-dirty`.** The run recorded a short hash with a dirty marker, and the pack printed it like a release.
  - **Hashes without sources.** The register's hashes pointed at files in a scenario folder that IGI does not keep.
- Not confirmed:
  - a defect in the ledger's version tracking or in the read-back;
  - a cardinality bug in Cairn;
  - an IGI cause for the Cairn printout's overlap at a page break. Cairn's browser print view is a convenience view with a print stylesheet that keeps evidence items whole inside nested grids, and the likeliest cause lies there. That is Cairn's, and not changed from this repository.
- Changes:
  - **Evidence of excluded versions.** `excludedItems` lists every submitted item of a withdrawn or rejected version with its state. An item still filed and active on the record blocks `generatePack` and makes existing packs stale. The blocker names the evidence, why the version is out, and the reason a person should give when voiding it ("Superseded by IGI finding F3 v2"). IGI voids nothing.
  - **Tray leftovers.** Items left unfiled in the Tray don't block. `status` and `withdraw` tell the operator to discard them, and filing one later makes the pack stale.
  - **Excluded versions in the pack.** The appendix lists the excluded versions' items by evidence reference and state, without content.
  - **Pack content:**
    - the overview groups findings as policy exceptions, actions outstanding or newly triggered, data quality (when any), and lower-priority observations, and counts open committee actions;
    - comparisons are shown only on the measure of the rule a finding names, including the same limit for its other portfolios, and not at all for a finding that names no rule;
    - each comparison reads "Maximum 35.00% | 2026-09-30 | 36.97% | Exceeded by 1.97 percentage points";
    - an outstanding action shows the committee actions it cites, as the action log records them;
    - a "Matters the analysis could not resolve" section, labelled unreviewed, holds the latest run's open questions and blockers and any downgraded exception;
    - the allocation change is in pp, and the manifest names steps and slots;
    - the note now says that Cairn, not the pack, records whether a package was opened before filing.
  - **Spark:**
    - propose_finding requires a `review_area` (source data, allocation and risk, funds and fees, committee actions), which picks the step;
    - the instructions ask Spark to separate what the records show from what they don't establish, putting the gaps in the finding's uncertainties, and to record each unresolved matter as an open question;
    - a run completes with uncertainties for open questions, blockers or a downgraded exception, not for an observation with no figures.
  - **Build and sources.** `igiBuild` records the full commit hash, and the pack calls a dirty build a development build that the repository cannot reproduce; it also records the code that generated it. Sources are kept under `sources/<SHA-256>/<file>` when a run starts and when a pack is generated.
  - **Cairn operator commands:**
    - `open` shows the subject's name and starts nothing without `--start`;
    - `submit-pack` submits the latest non-stale pack as a candidate document for the committee pack step, recorded on the pack before the request and read back by `status`;
    - `investigate --review <id>` starts a fresh review on the same sources.
- Tests:
  - A new pack test on the test double covers:
    - a revised finding blocked by both v1 items, then by the assertion alone once the package is voided;
    - a pack after both are voided that references exactly v2's evidence and lists v1's as voided;
    - a rejected finding whose package was filed, which blocks and makes the pack stale;
    - withdrawn items left in the Tray, which don't block but get discard advice and make the pack stale when filed later;
    - placement by review area;
    - the overview groups, the unresolved section, only the named rule's comparison in words, the committee action instead of comparisons, pp, step names, the build and retained sources;
    - submitting the pack, filing it and reading it back, and refusal once it is stale.
  - Also: the earlier pack test now voids v1's evidence before a v2 pack; a core test covers `review_area`.
  - `npm test`: 18 pass; type check clean.
- Verification run (review `dev-01-fixup`, completed with uncertainties, $0.22, nothing sent to Cairn). Nine findings:
  - **Review areas:** the fee finding went to funds and fees, the two overdue or triggered actions and a completed action to committee actions, and a reconciliation observation to source data.
  - **Uncertainties:** whether the notification was given is now an open question. The equity breach and the notification finding list what the records don't establish as uncertainties. One of these merely repeated the instruction's wording, so the instruction now asks for the specific fact each uncertainty leaves open; the demo run will show whether that holds.
  - **Preview pack:** a pack rendered from the run, with every finding filed in the test double on a copy of the local database, showed one more misleading table. A completed-action observation that names no rule showed a June largest-holding comparison from a check it cited. So comparisons now need a named rule. The cash finding names one portfolio's rule but covers three, so comparisons match the rule's measure rather than the rule alone, and each shows its date.
- Demo run (review `2026-q3`, built from commit 2d670a0, completed with uncertainties, $0.22, nothing sent to Cairn). Nine findings with sensible review areas, three open questions (the notification, the cause of the equity rise, the remediation plans), and uncertainties that name the facts left open. Two weaknesses:
  - The notification trigger was classified as an observation again, so the overview would list it with lower-priority observations. The outstanding-action classification read "overdue or unfulfilled", which a newly triggered standing instruction is neither; it now reads "overdue, unfulfilled or newly triggered".
  - The overdue-action finding stated no figures, so its assertion read "outstanding action (unvalidated)", which suggests a failed check. Assertions now say "figures validated", "figures not validated" or "no figures to validate".
  - A new run is needed to pick these up; this run's record was not started.
- Demo re-run on review `2026-q3` (built from commit 260d775, completed with uncertainties, $0.20). Seven findings, all with figures validated:
  - the two breaches under allocation and risk;
  - the overdue replacement and the notification trigger as outstanding actions under committee actions, with a completed action there too;
  - the fee rise under funds and fees, and the reconciliation under source data.
  - One open question, whether the notification was given; the findings' uncertainties name the facts the records leave open.
- The demo record was started on Cairn Dev on the re-published procedure (version 2), for the subject set in `server/.env`. Every review area's step has its assertion and document slots, and the pack step has its document slot.
- Submitted: 14 candidates, each placed on its area's step. Once a person had filed them, all seven findings read back publication-ready, nothing needed reconciling, and `pack` generated v1. It printed its generator as a development build: an uncommitted note in this log made the tree dirty, though the code was the commit. With the note set aside, v2 was generated from a clean tree and names commit 260d775 for both the analysis and the pack; v1 is superseded.
- `submit-pack` sent v2 to the record as a candidate document, placed on the committee pack slot. A person filed it, and the read-back shows it as active evidence. The pack is not stale, and all seven findings are still publication-ready. That completes the chain: investigation, validated findings, candidates, human filing, status read-back, reviewed pack, and the pack filed in the procedure.
- Against real Cairn (read-only): `status dev-01` names F3 v1's assertion, by its evidence reference, for a person to void, `pack dev-01` is blocked by it, and pack v1 is now marked stale for it. The old record is left as it is.
- Needs a person in Cairn:
  - a subject for the whole review, set in `server/.env`;
  - the review procedure re-published with multiple-item assertion and document slots, and, if wanted, additional subjects allowed;
  - for the fresh demo record, meaningful void reasons.
- Whether Cairn should enforce its single-item setting, return it to agents, or reword the label is a Cairn product decision, outside this repository. So is the print layout.

**Model traffic through Vessel** (spec §10.1)

- `--vessel` on `npm run investigate` and `npm run probe:meta` sends the model requests through the local Vessel proxy instead of to Meta directly. The address is `VESSEL_URL`, default `http://127.0.0.1:4550`, using its `meta` backend at `/b/meta/v1`.
- The two IGI clients are both plain `fetch`:
  - `respond` in `model.ts`, used by the Spark loop: requests are tagged `spark`, with the analysis run id as the Vessel session;
  - the Meta probe: requests are tagged `probe`, in the session `meta-probe`.
- `route` gates the base URL and the Vessel headers together. Without the flag, requests go to Meta's base URL with no extra headers.
- Checked: a core test covers routing both ways (19 pass; type check clean). The probe through Vessel made four calls, all 200, for $0.006. One Spark turn through the agent loop (review `vessel-check`, one-turn budget, $0.003) also returned 200. Vessel captured all five requests on backend `meta` with the expected tags and no warnings, and listed the sessions `meta-probe` (4 requests) and the run's id (1 request).
- Vessel keeps whole requests and responses, encrypted reasoning included, on the developer's machine; the spec now says so and limits the flag to development runs.

**Finding validation and revisions** (spec v0.12, §6.4)

- The problem, from a reviewed run whose principal calculations were right but whose "validated" labels overstated what had been checked:
  - a material figure passed if its digits appeared anywhere in a cited check's result, whatever it measured, for whichever portfolio, period or rule;
  - figures in the statement or explanation that were never declared went unchecked: excesses over limits, an action's threshold, an action's target;
  - deviations described as pp passed as %;
  - claims about every fund or every holding rested on evidence that missed one, or on a Python sum;
  - a revision replaced its predecessor whatever its own validation.
- New `server/src/evidence.ts` covers the following.
  - **Typed facts:** a fact for each figure of each check result (measure, unit, exact value, portfolio, period, instrument, asset class, rule version). Check results now carry instrument ids.
  - **The claims contract**, with four kinds of source:
    - a fact;
    - a structured rule version in force;
    - a quote from a committee action or a policy section, checked word for word and labelled an extract;
    - a difference, relative change or comparison of two claims.
  - **Unit-aware matching** at the stated precision.
  - **A text scan** requiring every %, pp, bps or £ figure to be a verified claim, and population wording to have coverage.
  - **Coverage claims**, checked against populations computed from the sources: weights reconcile (consistency), look-through complete (completeness), charges unchanged, limits met.
  - **`isCurrent`**, used wherever findings are counted, submitted or packed.
- `run_check` returns each result's facts; `propose_finding` takes claims and coverage instead of `material_numbers` and keeps every finding with feedback on what failed.
- Revisions:
  - Only a current finding can be replaced.
  - A revision that is not validated is kept, but doesn't retire a validated finding.
- `run_python` warns on typed-in figures. The instructions now treat:
  - period-end snapshots as showing neither trades nor causes;
  - a met trigger as an obligation arising, not one missed;
  - an action's aim as no evidence of its other effects.
- The assertion, package and pack show each figure's basis and scope, population statements, and revision history, and say that the explanation and conclusion were not checked. Rule limits on return deviations show in pp. Older findings render as stored.
- Tests:
  - `test/validation.test.ts`, 11 deterministic cases on dev-01 and edited copies, with no model or database: the clean breach, an unclaimed excess, wrong portfolio/period/measure/rule version, % against pp, action thresholds and a met trigger with no delivery evidence, a fund missing from "all funds", a holding without look-through data despite 100% groups, document against rule, a completed action missing its target, and the three revision cases with the refusals.
  - A pack test: rejected revisions and revised findings are not current, can't be submitted, and the package and pack render the checks and history.
  - The figures test now covers parsing, units and prose extraction.
  - `npm test`: 31 pass; type check clean; `eval/verify-checks.ts` ok for both scenarios.
- Live run (review `dev-01-claims`, through Vessel, completed with uncertainties, $0.26, a development build) produced nine current findings, all validated.
  - Two first attempts failed with specific feedback: an exposure claim without its asset class, and an earlier period's charge claimed for the review date. Spark fixed both as accepted revisions, and the first attempts are kept as history.
  - Coverage proved reconciliation and look-through completeness for all three portfolios, and "all other limits met" with the two breaches excepted.
  - Three open questions were recorded. One says period-end positions don't show the trades behind a weight change.
- Issue found and resolved: "per policy 2.4" was flagged as an unclaimed figure. A bare decimal now needs two or more places to count, and "policy" joins the reference words.

**Open**

- Create the IGI database, database user and private Spaces bucket with scoped keys (spec §10.1), and put the connection details in `server/.env`. Needed at first deploy.
- Gate B observations for later: Spark sweeps every catalogue check across every portfolio before forming hypotheses, so the checks, not Python, do most of the discovery. The holdout therefore needs at least one issue type no catalogue check covers; the overdue-action findings show Spark can find those. Classifications for the notification trigger vary between runs (observation, outstanding action).
- The leak scan is a throwaway script; make it part of the evaluation harness so it runs before every evaluation.
- Re-run the Monty smoke test on the DigitalOcean service at first deploy.
- Source references name the review and finding id but not the run, so two runs of one review that both submit an F1 send the same reference to Cairn, and the pack labels findings by id alone. Include the run (or a short form of it) before a review has a second submitted run.
