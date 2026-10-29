# Investment Governance Intelligence
## Product & Technical Specification — v0.13

**Date:** 28 October 2026  
**Status:** Working implementation specification. Gates A and B passed on 27 October. The progress log records a working Cairn submission/read-back/pack round trip and the v0.12 validation changes. v0.13 specifies the next IGI work: generated PDFs, readable plain-text assertions, realistic document imports and the operator review journey. These requirements are not claims of completed implementation. Cross-review memory remains the first priority stretch (§6.9); the committee slide deck is a subsequent stretch (§13.6). Neither changes the gates or the evaluation freeze.  
**Organisation:** Cairn River Ltd  
**Project:** Standalone AI-first investment-governance application, built on Cairn  
**Hackathon:** Meta Global AI Developer Hackathon 2026, Startup track, theme "Build for Your World"  
**Submission deadline:** 4 November 2026, 9:00 pm US Eastern Time (02:00 GMT, 5 November 2026)

---

## How to read this document

Every capability in this specification belongs to exactly one of these categories. Section headings carry the label where it matters.

| Label | Meaning |
|---|---|
| **[Existing Cairn]** | Built and running in Cairn before the hackathon. Privately maintained. IGI uses it; the entry does not claim it. |
| **[Cairn extension]** | The candidate-status read-back (§12.5). Built and deployed to Cairn Dev on 27 October through Cairn's own decision and development process; Gate A passed. This is not new public IGI code. |
| **[New IGI]** | Built during the hackathon in the public IGI repository. This is the entry. |
| **[MVP]** | Required for the hackathon submission. |
| **[Stretch]** | Only after the complete MVP works. |
| **[Post-hackathon]** | Deliberately out of scope for the event. |

---

## 1. Executive Summary

Investment Governance Intelligence (IGI) is an AI investment-governance analyst for small and mid-sized UK discretionary investment managers.

It helps an investment team prepare for its periodic investment committee. It examines information from several sources, investigates discrepancies on its own initiative, identifies potential policy exceptions and produces findings backed by reproducible evidence.

The AI is not given a predetermined series of calculations and expected conclusions. **The agent acts as an investigator.** It inspects unfamiliar data, forms hypotheses, chooses analyses, writes and runs Python, inspects the results and decides whether to dig further.

Three responsibilities are kept apart:

1. **Intelligence:** Meta Muse Spark investigates, reasons and interprets. It proposes findings. It holds no Cairn credentials and takes no privileged action.
2. **Computation:** agent-written Python runs in a Pydantic Monty sandbox. Tested deterministic calculations validate the material numbers.
3. **Accountability:** the IGI backend submits proposed evidence to Cairn under IGI's registered agent identity. A named person accepts or discards it in Cairn. IGI confirms what was accepted through Cairn's API before it publishes anything.

IGI owns the investment data, the investigation and the committee materials. Submitted findings pair a readable, structured plain-text assertion with a generated PDF investigation package. The final committee pack is a directly downloadable PDF; an optional presentation uses the same reviewed snapshot (§13.6). Cairn remains the authoritative system for evidence acceptance.

**[Stretch]** Once the MVP works, IGI may also let Spark propose firm-specific operational knowledge, such as which source is authoritative for look-through data, for an operator to confirm and later reviews to reuse (§6.9). Any such memory stays inside IGI. Shared company memory on Cairn is a possible future platform capability, not part of this project.

The project tests Cairn as a foundation for independently developed, industry-specific AI applications. Building IGI exposed one genuine platform gap: an outside agent cannot learn what happened to evidence it submitted. That gap was closed with a small, generic Cairn extension (§12.5) rather than a workaround in IGI.

## 2. Product Philosophy

### 2.1 An investigator, not a scripted workflow

The agent's objective is to discover and substantiate material issues in investment information.

It is not told which anomalies exist, where they are or what it should conclude. It is given:

- the overall investment-governance objective;
- the firm's policies, in human-readable and structured form;
- descriptions and schemas of the available data;
- tools for reading, querying and analysing that data;
- the scope of the review.

It decides which investigations to perform.

Ordinary data validation and known policy calculations are implemented deterministically. Those checks are tools the agent may choose to use. They do not dictate the investigation, and they are not a substitute for it.

**This is not a deterministic workflow with an LLM writing the report.** A successful agent must be able to discover a material problem the developer did not explicitly anticipate.

### 2.2 Evidence before conclusions

Every material finding must carry enough supporting information for another person to examine and challenge it. A finding without adequate evidence is an unresolved observation, not a confirmed exception.

IGI distinguishes:

- source facts;
- calculated results;
- agent interpretations;
- potential exceptions;
- evidence accepted in Cairn;
- committee decisions.

### 2.3 Human accountability

Spark proposes findings. The IGI backend, acting under IGI's registered Cairn agent identity, submits them as candidate evidence. Cairn attributes every submission to that agent.

A named person in Cairn decides whether each candidate becomes evidence. Cairn records the originating agent and the accepting person.

**Filing a candidate admits it into Cairn's record. It does not endorse every conclusion the agent expressed, approve an investment recommendation or record a committee decision.**

### 2.4 Platform boundaries

IGI owns its domain data, importers, agent orchestration, calculations, investigation trace, generated files, UI and report generation, and, in the memory stretch, its operational memory.

Cairn owns procedures, records, evidence acceptance, record history, permissions and audit.

- IGI reaches Cairn only through Cairn's authorised API. It never touches Cairn's database.
- IGI does not reproduce Cairn's evidence review or acceptance interface.
- IGI does not change Cairn. Cairn changes go through Cairn's own decision record, guardrails and development rules in the Cairn repository.

### 2.5 Specialist responsibility and durable knowledge [Stretch]

The Investment Governance Agent is responsible for preparing and investigating periodic investment-governance reviews. It may produce committee packs, exception analyses and follow-up materials as outputs of that **one responsibility**. Another responsibility, such as client suitability or compliance assurance, warrants a separate logical agent definition, not merely a different document template.

Long-lived knowledge is scoped to the company and the **logical agent definition**, not to the model name, agent process, prompt version or Cairn API key. Replacing Muse Spark with a new model must not erase learned operational knowledge.

The agent may decide what is worth retaining. **It may not unilaterally make that material an authoritative business rule or share it with other agents.** Run/review notes are automatically retained as history; cross-review operational knowledge requires explicit human confirmation. Scope, provenance, effective dates, supersession and access restrictions are part of the data model (§8.6–8.7).

The MVP has one agent definition, held as a constant id, and builds none of the knowledge handling described here.

### 2.6 Business process versus execution run

A Cairn procedure defines accountable business checkpoints and a Cairn record represents an instance of that business process. One monthly review record can span several IGI `AnalysisRun` executions, accepted evidence items and later committee decisions, and, in the memory stretch, operator clarifications. Cairn does **not** execute the agent, orchestrate its tool calls or store its transient reasoning state.

Cairn's existing candidate review is the hackathon's human-in-the-loop boundary. Clarifications in the memory stretch are answered in IGI. A generic agent-requested clarification/approval mechanism inside Cairn is a **post-hackathon platform candidate**, not an existing feature or part of this build.

## 3. Fictional Customer and Business Problem

### 3.1 Customer

A fictional UK discretionary investment manager:

- about 20 employees;
- three model portfolios in the prototype;
- a monthly investment committee;
- information supplied by several providers and systems;
- little internal software capacity;
- human oversight of every consequential investment decision.

This is a deliberately realistic hypothetical, not a validated paying customer.

### 3.2 Current process

Each month an investment analyst:

1. collects holdings, allocation reports and performance figures;
2. reconciles information from different reporting systems;
3. reviews investment policies, portfolio limits and manager information;
4. investigates discrepancies and possible breaches;
5. checks changes to fund charges, allocation assumptions and other relevant information;
6. reviews outstanding actions from previous committee meetings;
7. produces the committee materials;
8. records decisions and follows up.

The information is spread across spreadsheets, PDFs, emails, minutes and proprietary systems. The goal is less manual preparation and investigation, with more reproducible and traceable results.

The fictional firm also has changing conventions for interpreting provider classifications and obtaining look-through exposure data. The current month's input may contain new or incompatible categories. A human may clarify which source or methodology is valid; subsequent months should be able to reuse **confirmed, still-applicable** operational knowledge, without carrying forward stale portfolio values.

### 3.3 Users

- **Investment Analyst:** starts a review, supplies data, watches the investigation and prepares committee material.
- **Head of Investments / CIO:** reviews proposed findings and their calculations, and accepts evidence in Cairn.
- **Investment Committee Member:** reads the pack and takes part in decisions.

For the hackathon one operator plays all three roles. IGI has a single operator login and no role management.

## 4. Scope

### 4.1 Hackathon MVP [MVP]

The end-to-end flow:

**Create review → Import and validate sources → Start investigation → Propose findings → Submit assertion/PDF pairs → Human acceptance in Cairn → Verify acceptance through Cairn's API → Generate committee PDF**

The core experience:

1. Create a review and import realistic synthetic XLSX, PDF and DOCX sources, with CSV retained for development and interchange.
2. Watch Spark investigate it using Monty.
3. Inspect findings and their reproducible calculations.
4. Submit findings to Cairn and follow their acceptance status.
5. Download the reviewed committee PDF without configuring browser print settings.

It includes:

- synthetic investment datasets and source documents;
- file import with deterministic validation and original-file locations for extracted data (§7.5);
- one autonomous Muse Spark investigation agent;
- sandboxed Python execution with Monty;
- a persisted investigation trace of real tool calls, code, inputs and outputs, scoped to the review and run;
- evidence-backed findings, readable plain-text assertions and generated PDF investigation packages from the same finding version;
- operator-triggered Cairn record start and evidence submission, with a submission ledger;
- human acceptance in the existing Cairn UI;
- acceptance read-back through the Cairn candidate-status extension;
- committee PDF generation from a fixed snapshot of verified, accepted, active evidence, with versioned downloads and stale marking;
- an evaluation suite with development and holdout scenarios and independent answer keys.

### 4.2 Excluded

The MVP will not include:

- live trading, dealing instructions, rebalancing or optimisation;
- personalised investment recommendations or suitability assessments;
- real customer or financial data;
- live custody, trading or market-data integrations;
- automated acceptance of evidence, in Cairn or anywhere else;
- autonomous committee decisions;
- any evidence review or acceptance UI in IGI;
- Cairn webhooks, subscriptions or a general Cairn read API;
- a delegated-authentication framework between IGI and Cairn;
- multi-tenant operation of IGI;
- multiple collaborating agents or an agent framework;
- a general-purpose investment management platform.

Muse Image, Muse Voice and SAM are not used. Muse Spark is the central Meta capability.

### 4.3 Stretch goals [Stretch]

Only once the complete MVP works. **The first priority stretch is a narrow cross-review memory demonstration** (§6.9); it must not delay the already agreed evidence and committee-pack flow:

- one clarification: Spark records an open question about an ambiguous source and carries on; the operator answers in IGI and starts a new run with the answer, rather than pretending to resume encrypted reasoning;
- approved, generic agent-scoped operational knowledge, proposed by Spark and confirmed by the operator in IGI;
- an October-to-November scenario covering incompatible valuation classifications and conflicting exposure sources: reuse the confirmed interpretation with current-period values, and ask about a new, uncovered instrument (§7.4).

**Next presentation stretch:** a six-to-eight-slide committee briefing, downloadable as PPTX and PDF, derived from the same reviewed snapshot as the final pack (§13.6). It follows the complete MVP and the priority clarification/memory slice; it must not displace the investigation or Cairn review in the demo.

Other stretch goals:

- a review handover derived from the previous review, carrying unresolved items forward;
- `search_history` over approved knowledge, handovers, earlier notes and an index of generated files, without a general-purpose RAG service;
- re-investigation of a single finding, started by the operator from IGI with a note;
- investigation of a second, previously unseen dataset during the demo;
- additional portfolio and performance analytics and richer charts;
- recording committee decisions and carrying actions into the next cycle;
- a second agent reviewing the first agent's findings;
- comparing investigations across model configurations.

### 4.4 Post-hackathon [Post-hackathon]

Includes multi-tenant isolation, role management, production deployment and anything needing real client data. Scheduled or external review-start triggers, broad legacy `.xls`/`.doc` import, arbitrary document layouts and OCR of scanned PDFs are also deferred; the hackathon uses explicit operator actions and supported source layouts (§6.10, §7.5). Company-wide shared knowledge, cross-specialist promotion, FDE knowledge onboarding, Cairn-hosted memory/artifact APIs and generic Cairn human-intervention requests are all **post-hackathon candidates**, not IGI MVP work.

## 5. What Exists, What Is New

### 5.1 Existing Cairn functionality used by IGI [Existing Cairn]

Cairn's candidate intake surface, authenticated with an agent key issued by a Workspace Admin:

- finding subjects and the procedures a record could be started on;
- starting a record for an existing subject, with conditional repeat handling;
- looking up a record's incomplete steps and their evidence slots;
- submitting file, link and assertion candidates into the workspace's Tray;
- proposing a step and evidence slot for a candidate;
- per-agent limits, rate limiting and audit of every submission, lookup and start.

Inside the Cairn application, for people:

- filing a candidate onto a record step as evidence, or discarding it;
- voiding evidence;
- provenance on filed evidence: "Originally from {agent}" with the submitter's reference, and the accepting person;
- record history, as-at views and PDF reports.

§12.1 summarises the contract IGI relies on.

### 5.2 Cairn candidate-status extension [Cairn extension]

A new read-only intake operation that lets an agent learn what happened to candidates it submitted: still unfiled, discarded, or filed as evidence that is active or voided. §12.5 gives the approved contract.

It is generic. Any outside system that submits candidates has the same need. It is not designed around investment governance.

It was authorised by a dated founder decision and an amendment to Cairn's product guardrails, then built with tests in the Cairn repository under its own rules. It was deployed to Cairn Dev and passed the Gate A milestone (§17.1) on 27 October 2026, so IGI relies on it for publication.

### 5.3 New IGI functionality [New IGI]

Everything in this repository: the synthetic data and scenario generator, importers and validation, the Spark investigation loop and its tools, the Monty adapter, deterministic checks, the investigation trace, findings, the Cairn client and submission ledger, status polling, snapshots, PDF rendering, the committee pack, the UI, the evaluation harness, the Cairn test double and the documentation. The optional slide deck is also IGI-owned. IGI also stores its source files and the files it generates (investigation packages and committee packs). The memory stretch adds clarifications, agent-scoped knowledge proposals and confirmation, then review handovers and historical lookup, entirely within IGI.

### 5.4 Hackathon disclosure

The organisers' participant guide allows Startup entries to build on existing products, provided newly developed functionality is clearly identified.

- The IGI repository is public. Its README states that all IGI code was written during the hackathon and separates it from Cairn.
- Cairn is existing, privately maintained infrastructure. Its source is not public. Public IGI documentation must not link to private Cairn repositories or documents as though judges could follow them.
- This specification and the IGI repository must explain the Cairn dependency well enough to understand IGI on its own: the contract summary in §12, a diagram of the flow, and a Cairn test double that implements the contract IGI uses, including the status extension.
- The status extension is new Cairn platform work done during the hackathon window to support IGI. **Default position:** disclose it as such, publish its contract here, and claim only IGI repository code as entry work. Whether demonstrating it requires more under the public-code rules must be checked against the participant guide before submission.
- The demo video identifies which parts are existing Cairn, the new Cairn extension and new IGI.

## 6. Functional Workflow

### 6.1 Create a review [New IGI]

The operator selects a reporting period and creates a review. IGI creates a `Review`.

Creating a review does not touch Cairn. Starting the Cairn record is a separate, explicit operator action ("Open Cairn record"), so development runs don't create records nobody needs.

On that action the backend:

1. lists the procedures startable for the governance subject, by the subject's configured Cairn reference (`GET /api/intake/v1/subjects/{subjectReference}/procedures`, which answers `subject.not-found` for an unknown subject, so no separate subject lookup is needed), and picks the configured review procedure by name;
2. starts the record (`POST /api/intake/v1/records`) with a source reference naming the review, such as `IGI review 2026-10`;
3. stores the returned Cairn reference and step and slot ids on the `Review`.

Retries follow Cairn's documented rules (§12.4).

### 6.2 Import the information [New IGI]

The operator uploads the review's source files. Each file is:

- stored as an immutable input version for the review;
- given a unique source identifier;
- hashed with SHA-256;
- parsed into typed domain data where applicable;
- validated structurally (§7.3);
- recorded with reporting dates, units, extraction/mapping versions and original-file locations (§7.5).

The sources are read for the review's own period end, never the latest date found in them: positions dated after it are reported, and a review whose sources hold no positions at it cannot be investigated. Missing or invalid data is reported, never silently repaired. Import issues distinguish unreadable or structurally invalid inputs from unresolved interpretation of readable data. An unresolved mapping blocks calculations and conclusions that depend on it; other valid review areas may proceed. The MVP operator can resolve an import mapping before starting the affected analysis, with the answer and source version recorded. The memory stretch also allows Spark to discover an ambiguity, ask a focused question and continue unrelated work (§6.9, §8.8). Neither route guesses a mapping or silently drops affected holdings.

### 6.3 Investigate [New IGI]

The operator presses **Start investigation** in IGI to start an `AnalysisRun` against a recorded source manifest. Uploading files, opening a Cairn record or receiving a Cairn status change does not start a model run. Spark receives a broad instruction: review the supplied data against the applicable governance policies, identify matters that need attention and substantiate them.

Spark has no access to evaluation answer keys or to anything revealing planted anomalies (§15.2).

It may repeat this cycle as often as its budget allows:

1. formulate a question;
2. decide what information it needs;
3. retrieve data through its tools;
4. write Python or call a deterministic check;
5. run it;
6. inspect the result;
7. challenge the result or investigate further;
8. record an observation or propose a finding.

An investigation need not produce findings. Concluding that a suspected issue has a legitimate explanation is a valid outcome.

### 6.4 Propose findings [New IGI]

Spark calls `propose_finding` with a structured finding (§8.2). The backend checks that every cited source row, execution and check exists in this run, then validates the finding's figures and scope as below. Every finding is stored, whatever the outcome, and the result tells Spark what failed and how to fix it. A potential exception that is not validated is stored as an unvalidated observation.

**Evidence.** Each `run_check` result yields typed **facts**. A fact has an id (`C7:exposure`), a measure, a unit, an exact decimal value and a scope (portfolio, period, and where it applies an instrument, an asset class or a rule version). Units are explicit: fractions shown as %, differences between fractions shown in pp, pounds, counts. Margins against a limit, changes in charges and differences between returns are pp. So is a rule limit on a deviation between returns; every other rule limit is a fraction.

**Claims.** Every figure a finding relies on is a claim: a key, a label, the value as the reader sees it, a measure, a scope (defaulting to the finding's portfolios and period) and one source:

- a fact, for a computed or reported figure. It must have the claim's measure and scope: the right portfolio, period, instrument and asset class;
- a structured rule version, for a numerical limit. It must be in force at the claim's period and apply to its portfolio. Numerical limits come only from the structured rules;
- a quote from a committee-action row or a policy-document section, for a threshold or target written only in text. The quote is checked word for word and must hold exactly one figure. It is labelled as an extract a person reads in context, never as a verified rule;
- a calculation on two other verified claims: a difference, a relative change, or a comparison with a relation (above, below, at or above, at or below, equal), which IGI evaluates.

The value must equal the evidence in the same unit, at the precision stated, so a percentage never passes for a pp difference.

**Text.** Every %, pp, bps or £ figure in the statement and explanation must equal a verified claim. So must every bare decimal with two or more places that is not a clause, section or version reference; a bare number with one place reads as a reference. Dates, identifiers and plain counts are left out. Wording about a whole population ("all portfolios", "every holding", "no other fund", "full coverage") needs a verified **coverage claim** of the kind its sentence states (limits met, charges unchanged, look-through complete, weights reconciled), over the population it names: every portfolio in the review for wording about portfolios, otherwise the finding's portfolios. A sentence that can't be tied to a kind stays unsupported. Coverage claims are checked against the population computed from the sources:

- every holding's weights reconcile, which shows internal consistency only;
- every holding has look-through data, which shows completeness;
- every fund held has an unchanged charge, apart from named exceptions;
- every rule in force is met, apart from named exceptions.

Coverage is accepted only from cited check results, never from a Python result.

**Outcome.** A finding is validated only when every claim and coverage claim checks out and nothing in its text is left unsupported. Validation covers the figures and populations only. The explanation and conclusion are Spark's interpretation, and the assertion, package and pack say so wherever they show the checks. Older findings carry `material_numbers` instead of claims and are shown as they were stored.

**Revisions.** `replaces` names a current finding of the same run; an unknown, already revised or rejected one is refused, which also rules out self-reference and cycles. The revision becomes current, and the earlier finding is kept with its own evidence as history, when the revision is validated or the earlier finding was not. Otherwise the revision is stored as a rejected revision and the earlier finding stays current. A revision may change classification, materiality, portfolios and conclusion. Only current findings are submitted, counted and packed.

### 6.5 Submit to Cairn [New IGI]

The operator chooses which findings to submit. The backend, not Spark, submits each one:

- an **assertion** stating the finding, as structured plain text within the 4,000-character intake limit, readable as Cairn shows it;
- a **PDF file** holding the investigation package: a concise finding and evidence summary first, followed by methodology, input locations and hashes, executed code, outputs, check results, assumptions and uncertainties (§12.3).

Both are rendered by IGI from one immutable finding-version payload. Presentation does not call the model to recalculate or rewrite claims. Their exact submitted text/bytes and hashes are retained; changing a submitted package creates a new version requiring its own review.

**Every submitted finding needs both.** For publication, a *material finding* is any finding the operator submits to Cairn, whatever its classification. It is publication-ready only when its assertion and its investigation-package file are each confirmed as filed, active evidence in Cairn for the same finding version. Accepting the assertion alone is not enough.

Each submission proposes a step and slot on the review's record. If the proposal doesn't fit, the candidate waits in the Tray unplaced. Every attempt is recorded in the submission ledger (§12.4).

Submission is not acceptance.

### 6.6 Human review in Cairn [Existing Cairn]

The operator opens the record in Cairn from a link in IGI. There a person files each candidate onto a step as evidence or discards it. They may later void evidence. Discarding a finding's assertion is how the reviewer rejects the finding.

Cairn has no "request further investigation" action. If the operator wants more investigation, they start it in IGI: a new analysis run on the review (MVP), or re-investigation of a single finding ([Stretch]). The status API does not return rejection/void reasons or reviewer comments. IGI links to the Cairn record and asks the operator for the explanation needed for a follow-up; it never invents feedback from a status code.

### 6.7 Follow acceptance [Cairn extension, New IGI]

IGI polls the candidate-status operation for candidates in its ledger and shows each candidate's state: unfiled, filed and active, filed and voided, discarded, unverifiable, or uncertain. From the two candidates, and the operator's own actions, it derives each finding version's state:

| Finding state | When | Effect on the final pack |
|---|---|---|
| Not submitted | The operator has not submitted it | Not in the pack; see the rule for a pack with no findings (§6.8) |
| Pending | Either item is unfiled, or either submission is uncertain | Blocks |
| Publication-ready | Both items filed and active on the review's record, for the same version | Included |
| Rejected | The assertion was discarded in Cairn | Excluded and counted |
| Incomplete | Any other combination: the file discarded, either item voided or unverifiable, filed on another record, or an item missing because its submission was refused or abandoned | Blocks |
| Withdrawn | The operator withdrew it in IGI, with a reason | Excluded and counted |

When more than one description fits, the first in this order applies: withdrawn, rejected, publication-ready, incomplete, pending. For example, a discarded assertion makes a finding rejected whatever its file's state. Each finding counts once, by its latest version: an earlier version, withdrawn before the matter was put forward again, is history and does not count. A finding Spark revised within its run counts only through its revision; a revision that was not accepted (§6.4) never counts, and the finding it tried to replace stands.

**Evidence of excluded versions.** The record must not hold active evidence of a version the pack leaves out. Any item of a withdrawn version, earlier versions included, or of a rejected one, that is filed and active on the review's record blocks a final pack and makes an existing pack stale (§13.3). IGI cannot void evidence and never tries: the blocker names the evidence reference, and a person voids it in Cairn, giving a reason such as "Superseded by IGI finding F3 v2". An item still unfiled in the Tray does not block; IGI lists it for a person to discard there, and if someone files it later the pack goes stale. The pack's appendix lists the excluded versions' items by evidence reference and state, without content.

**Withdrawal.** The operator can withdraw any finding version in IGI, submitted or not, and must give a reason. IGI records when and why. Withdrawal is final for that version and changes nothing in Cairn: a person discards any of its candidates still unfiled there, and voids any of its items already filed. To put the matter forward again, the operator submits a new version. Withdrawal is how a pending, incomplete or voided finding stops blocking the pack. It is the operator's decision about what IGI puts forward, not a review decision, which belongs to Cairn.

IGI shows status, when it was last checked, any blocker and a link to Cairn. It offers **Refresh Cairn status**, but no evidence accept or reject controls. A Cairn status change updates eligibility and staleness in backend code; it does not by itself start Spark or generate a replacement finding. Clarification and publishing triggers are specified in §6.10.

### 6.8 Generate the committee pack [New IGI]

Immediately before generation, IGI makes a fresh status call and resolves every finding's state (§6.7). A **final committee pack** is generated only when no submitted finding is pending or incomplete, and the record holds no active evidence of a withdrawn or rejected version (§6.7). Its immutable `ReviewedSnapshot` (§13.2) holds the publication-ready findings. Rejected and withdrawn findings are excluded, and the pack states how many there were. The pack is generated from that snapshot only, never from unreviewed agent output or live, mutable source data. IGI also confirms that the review's source files still have the hashes the latest analysis run recorded; if any differs, it generates nothing and asks for a new investigation.

While any submitted finding is pending or incomplete, IGI lists what remains to be done and generates no final pack. It may show a preview, clearly marked incomplete, in which no unaccepted finding is presented as reviewed.

**A pack with no findings** is valid only when the review's latest analysis run ended `completed` or `completed_with_uncertainties`, and every finding that run proposed or stored as a potential exception (in its latest version) has been rejected in Cairn or withdrawn. An unvalidated exception stored as an observation therefore still counts. A potential exception the operator neither submitted nor withdrew blocks a pack with no findings.

The operator presses **Generate committee PDF** once the review is eligible. The backend renders and stores the PDF directly, with a readable preview and download; no manual browser printing or scale selection is required (§10.4, §13.4). The optional slide deck is derived from the same snapshot, with the same evidence eligibility checks (§13.6).

If the verified evidence later changes, the pack and any derived deck keep their versions and are marked stale; newly generated materials supersede them (§13.3).

### 6.9 Cross-review knowledge and clarifications [New IGI; priority Stretch]

The MVP persists each run's notes in its investigation trace (§8.5), attached to the originating `Review` and `AnalysisRun`. Nothing in the MVP passes them to a later run, and they never become global agent memory.

The priority memory slice extends the workflow without changing Cairn:

1. When Spark meets a classification, source-of-truth or methodology question it cannot resolve from the sources or approved knowledge, it records an `open_question` note with the exact ambiguity and its source references, then carries on with the rest of the review. The run ends `completed_with_uncertainties` with its open questions listed, or `blocked` only if nothing else could proceed (§8.8).
2. The operator answers inside IGI, seeing the affected instruments, original labels, candidate interpretations and source locations. **Use for this review** records an answer without approving future reuse; it is separate from **Confirm for future reviews** on a knowledge proposal. Record the question/answer versions, responder, time, rationale and source references.
3. The operator starts a new `AnalysisRun` on the same review with the answers, the earlier run's findings and notes as recorded in its trace, and approved applicable knowledge. The earlier run's encrypted reasoning is **not resumed**; IGI rebuilds the context from its own stored records.
4. If Spark sees future value in an answer, it calls `propose_knowledge` with applicability, provenance and an explanation of what the knowledge should *not* imply. The operator explicitly confirms or rejects the proposal. Confirmation makes it available to later reviews for the **same logical agent and company**. It does not certify a financial fact or change the authoritative policy table.
5. When the next period's review starts, approved knowledge applicable to that period is supplied to Spark as data (§8.6).

**Later stretch,** only once that slice works:

6. On completion of a review, IGI derives a `ReviewHandover` in code, without a model call, from the review's unanswered open questions, findings not yet publication-ready and outstanding committee actions, each with references to its sources. The next review receives every unresolved item, including older ones carried forward; there will be a handful, so there is no relevance ranking. Raw historical notes remain searchable through `search_history`, not injected wholesale.
7. IGI indexes its generated investigation packages and committee packs (§10.3) so `search_history` can find earlier output by reference, without the operator uploading it again. Retrieval is bounded to IGI's own company and agent context. Earlier packs carry period-specific values, so their text is never supplied automatically and older values are never treated as current.

**Example:** October's valuation workbook uses provider sector labels that do not match the model portfolio's taxonomy. For some multi-asset funds the provider export and the fund manager's report also disagree. Spark identifies the affected instruments and asks which classification or source should govern. The analyst confirms a scoped mapping where a direct mapping is justified, and a current-period fund-manager look-through rule for multi-asset holdings. Spark separately proposes retaining those interpretation rules. November applies only confirmed, still-applicable rules to November's values, and asks about a newly held fund or uncovered label. A broad label such as "Managed" is not automatically assigned to one asset class. October's holdings, returns and exposure percentages are never carried forward as current values.

This is **learning with human supervision**, not automatic self-modification of policies. Company-level knowledge shared with other specialist agents is deliberately excluded from the hackathon.

### 6.10 Triggers, waiting and recovery [New IGI]

IGI owns execution and waiting. Cairn records human evidence decisions; it neither runs the agent nor supplies a general workflow engine.

| Trigger | IGI action | Model call? |
|---|---|---|
| Create review / upload sources | Store review and immutable source versions; validate and show import issues | No investigation call |
| Start investigation | Start one bounded `AnalysisRun` against the chosen manifest | Yes |
| Open Cairn record / submit findings | Explicit backend actions through the ledger | No |
| Poll, return to the review, or Refresh Cairn status | Reconcile candidate states, eligibility, blockers and existing output staleness | No |
| Answer clarification, then Start follow-up run [Stretch] | Record the answer and start a new run with persisted context and source references | Yes, a new run |
| Generate committee PDF | Fresh status/source checks, then render the final PDF from an immutable reviewed snapshot | No |
| Generate slides [Stretch] | Recheck eligibility and render the briefing from the pack's existing snapshot | No |

The review may display **Needs clarification** or **Waiting for Cairn review** without adding an `awaiting_input` model-run status. No model request stays open while a person considers an item. Open questions remain in the trace and the run finishes under §8.4; a follow-up has its own run id and a link to the earlier run.

Persist submission attempts, pending operator work, source versions, clarification answers and generation job state. A process restart restores pending review/status work, but does not claim to resume an interrupted encrypted model conversation. Mark an interrupted investigation clearly and let the operator start a new run. Repeated button clicks and concurrent workers must not duplicate a run or generation job. Use an IGI operation id and persisted ownership within the existing service; no new orchestration platform is required. This does not make Cairn submissions idempotent: uncertain submissions retain §12.4's manual reconciliation rule.

Routine status reconciliation and successful generation update the UI. Rejection or voiding never automatically resubmits a finding or overrides a person's decision. Scheduling and external review-start triggers are post-hackathon work; Cairn webhooks are not a dependency.

## 7. Demonstration Data [New IGI]

### 7.1 Dataset structure

An entirely synthetic, internally coherent investment-governance dataset with fictional entities:

- three model portfolios with different objectives;
- two consecutive reporting periods;
- positions, values and reported weights;
- instrument identifiers and fund classifications;
- underlying fund asset-class exposures (look-through);
- investment mandates and risk limits;
- performance history and benchmarks;
- provider fee information;
- the previous committee's minutes, decisions and outstanding actions.

Supported demo formats: CSV, XLSX, text-based PDF and DOCX. Each supported format must actually be imported; converting a CSV into a visually different file while the agent reads a hidden CSV is not the demo.

| Source material | Demo format |
|---|---|
| Portfolio valuations and holdings | XLSX |
| Model allocations and authoritative structured limits | XLSX; CSV also supported for development/interchange |
| Human-readable investment policy | PDF |
| Previous committee minutes and recorded actions | DOCX |
| Fund-manager exposure reports and fee schedules | PDF or XLSX |

Use fictional provider names and realistic headers, units, dates, sheets and document sections. Keep the documents small enough for fast iteration and neutral about planted issues. Formats and provenance are specified in §7.5.

### 7.2 Governance policies: two representations

Each policy is supplied twice:

- **A human-readable document** (PDF), as the firm would write it. Spark uses it for interpretation, investigation and explanation.
- **An authoritative structured table** of the same rules: limit, threshold, unit, portfolio scope, effective-from date, effective-to date, calculation methodology and a reference back to the clause in the document.

Deterministic checks use only the structured table. Spark must not extract or invent authoritative numerical limits from policy prose.

If the document and the table disagree, Spark records the disagreement as a finding in its own right and does not silently choose one. This matters most for allocation, concentration, exposure, fee and other numerical thresholds.

### 7.3 Input validation

Deterministic checks at import:

- missing or duplicate records;
- invalid identifiers;
- inconsistent valuation dates;
- weights that do not reconcile;
- missing look-through coverage;
- exposure rules naming an asset class the look-through data does not use (a differently written label is reported, never matched);
- unit and percentage ambiguity;
- reporting-period mismatches;
- portfolios with no applicable policy;
- invalid or inconsistent financial values.

These establish whether data is safe to analyse. They are not the investigation.

### 7.4 Two-period memory demonstration [Stretch]

Prepare a **separate** synthetic October-to-November continuity fixture using realistic XLSX valuations, a model taxonomy and PDF/XLSX exposure sources. Source sector/classification labels differ from the model taxonomy. Look-through rows carry an optional `source` column (provider export or fund-manager report), with conflicting values for some multi-asset funds; `lookthrough_exposure` accepts the selected source. Keep raw labels and locations alongside normalized values and the rule version used. The main investigation scenarios retain a single look-through source and do not gain hidden mapping instructions.

The demonstration has six observable stages:

1. October import preserves incompatible labels and conflicting sources; it neither guesses nor silently omits affected holdings.
2. Spark records a focused question identifying the affected instruments, candidate interpretations, source locations and conclusions it cannot establish, while continuing unrelated work.
3. The operator supplies the authoritative source or scoped classification rule inside IGI. The answer is initially for this review only.
4. A new run uses the answer and current sources. Spark may propose the reusable interpretation; a separate named human confirmation permits later reuse.
5. November contains changed values and reuses only approved rules whose source/provider, instrument scope, taxonomy version and effective dates still apply. Its trace records the exact knowledge version used.
6. November introduces a new fund or label outside that scope, including a fund covered only by the provider export. Spark asks again. It does not extend a mapping by similarity or reuse October's exposure percentages.

A mapping can be an explicit classification correspondence or a rule to obtain current-period look-through data; a multi-asset label does not imply a single asset class. Include variants where confirmation is declined, the mapping expires or is revoked, the taxonomy changes, and authoritative current data conflicts with remembered knowledge. Corrections create new versions and identify dependent findings and outputs; prior evidence and artifacts remain immutable.

Keep this scenario out of the primary Gate B evaluation. It tests clarification and scoped reuse, not discovery of planted exceptions. Its answer key remains inaccessible to Spark; November sees only knowledge explicitly approved during its own October exercise.

### 7.5 Import formats and source-location provenance [MVP]

The importer supports documented, bounded layouts for the demo sources, not arbitrary financial documents. The layouts are defined in `server/src/formats.ts`: each worksheet's or table's header labels, the minutes' meeting-date paragraph, the fee schedule's period columns and the policy document's numbered sections. Preserve original bytes and SHA-256, media type, filename, reporting period, import/extraction version, original values and any normalization or operator correction. Every normalized row has a stable row id and a link back to its immutable source version. Field-level locations are retained where a row draws on multiple places.

| Format | Supported input and location reference |
|---|---|
| CSV | Named columns, explicit delimiter/encoding and units; source row and column |
| XLSX | Documented worksheets/tables and headers; workbook version, sheet and cell/range; retain original labels and formula/cached-value provenance where present |
| PDF | Text-based policy sections and documented report/table layouts; page plus section, table/row or text span, preserving the source quote |
| DOCX | Document paragraphs and tables for minutes/actions; heading, paragraph or table/row/cell locator, rather than unstable page numbers |

Numbers enter the domain model as decimal strings with explicit units. Document dates and valuation dates are separate. Import must expose unknown units, conflicting dates, missing identifiers, duplicated rows, uncertain extraction and unsupported layouts. Missing/stale formula results must not be silently treated as authoritative values. IGI does not execute macros, workbook external links or embedded document code.

A parser or model may propose extracted fields, but confidence alone does not make an uncertain value authoritative. Show the original passage or cells and require a recorded operator correction when necessary before using the affected value in a check. Preserve both extraction and correction with provenance. Policy prose does not overwrite the authoritative structured limits (§7.2).

An import or mapping issue blocks dependent calculations and findings, not unrelated review areas. Checks must identify incomplete coverage and cannot present a partial denominator as the full portfolio. Exporting the same facts in different supported formats must produce equivalent normalized values, with format-specific provenance. The review UI can open the retained original and show its locator even where deep linking into the file is unavailable.

Scanned/image-only PDFs, general OCR, password-protected files and legacy `.xls`/`.doc` are outside the required demo support. Refuse or explain unsupported inputs; do not return empty data as a successful import. Do not introduce a general document-ingestion platform to support this slice.

## 8. Agent Architecture [New IGI]

### 8.1 Design

One Muse Spark agent in a bounded loop run by the TypeScript backend. No agent framework and no workflow engine: a loop that sends messages, executes the tool calls Spark makes, records them and stops on completion or budget exhaustion.

Spark's context holds the review objective, the list of available sources, the policy summaries and the tool descriptions. It does not load every document into its prompt. It retrieves data as the investigation develops, through repeated tool calls.

### 8.2 Tools

The **MVP retains seven tools covering five capabilities**. Every core tool is read-only except the two that write to IGI's own investigation record. All are scoped to the current review. Do not require the memory tools until the core investigation, Cairn round trip and pack publication work.

| Capability | Tool | What it does |
|---|---|---|
| Discover sources | `list_sources` | Lists the review's sources with schema, field definitions, units, reporting period, provenance and import validation issues. |
| Retrieve data and policies | `read_data` | Returns a bounded selection from one source: chosen columns, filters, sort and row limit. Numbers come back as decimal strings. Previous committee actions are a source like any other. |
| | `get_policy` | Returns a policy's document text by section, and its structured rules for a portfolio and date, with effective versions. |
| Execute Python | `run_python` | Runs Python in Monty (§9). The code can call read-only data functions with the same scope and bounds as `read_data`. Returns values, standard output and errors. |
| Trusted calculations | `run_check` | Runs a named, tested deterministic calculation, such as weight reconciliation, look-through exposure against a limit, concentration, fee change between periods, or performance recomputation. The catalogue is in the tool description; Spark decides whether and when to call them. Each result lists its typed facts, the ids a finding's claims cite (§6.4). |
| Record work | `record_note` | Records an observation, hypothesis, assumption, open question or missing-information blocker. |
| | `propose_finding` | Creates a structured finding: statement, classification, review area (source data; allocation and risk; funds, managers and fees; committee actions), portfolios, policy rule and version, cited source rows, execution and check ids, claims and coverage claims with their evidence (§6.4), explanation, assumptions and uncertainties, and the current finding it replaces, if any. The review area decides the procedure step its evidence is proposed for (§12.3). |

**Memory tools [Stretch].** The priority slice adds one tool, `propose_knowledge`, which writes a **proposal**, never approved knowledge; the operator confirms it in IGI. Clarification requests use `record_note`'s existing `open_question` kind, so they need no new tool. The later stretch adds `search_history`, which searches approved knowledge, review handovers, earlier notes and the index of generated files, and returns only bounded, source-attributed results. No unrestricted object-store tool or cross-agent access is implied.

Spark has no Cairn tools and no Cairn credentials. Record start, submission, status polling, snapshots and pack generation belong to the backend.

### 8.3 Agent behaviour

The system prompt asks Spark to:

- explore the data rather than assume known problems;
- test hypotheses with executable analysis;
- compare against the correct policy version and effective date;
- flag disagreement between a policy document and its structured rules;
- explain why something is or is not material;
- investigate contradictory evidence;
- identify results that depend on uncertain assumptions;
- keep what the records show apart from what they do not establish, since the absence of a record proves nothing either way, and put such gaps in the finding's uncertainties;
- record each matter it could not resolve as an open question, saying what it affects;
- cite the sources, executions and checks behind each finding;
- state every figure in a finding as a claim with its evidence, and prove any statement about a whole population with coverage, or leave it out;
- treat period-end positions as snapshots that do not show trades or causes, a met trigger as an obligation arising rather than one missed, and an action's stated aim as no evidence of its other effects;
- read values with `read_data` in generated code rather than typing them in;
- avoid inventing absent values or unsupported explanations;
- stop when coverage is sufficient or the budget runs out.

Spark cannot change investment data or anything in Cairn.

### 8.4 Budgets and final status

Each run has configured limits on model tokens and estimated cost, wall-clock time, tool calls, Python executions, and rows and bytes returned by data tools.

A run ends as `completed`, `completed_with_uncertainties`, `blocked`, `failed` or `budget_exhausted`. Budget exhaustion is never reported as completion: a run in which any budget refused a tool call ends `budget_exhausted`, even if Spark then writes its summary. An open question does not end a run: Spark records it and carries on, and the run ends `completed_with_uncertainties` with its open questions listed. A run also ends `completed_with_uncertainties` when a potential exception it proposed was stored as an observation because its figures were not validated; an observation with no figures to validate is not an uncertainty. `blocked` means nothing else in the review could proceed. In the memory stretch, an operator's answer starts a new run with context rebuilt from IGI's records and a reference to the earlier run, never a resumed Meta Responses conversation (§8.8).

### 8.5 Investigation trace

Every model turn, tool call, argument, result, Python source, execution result, note and finding is persisted in order with a correlation id. The trace is the record of what the agent did.

Spark's visible message text, including any short message it writes before a tool call, is shown as labelled model output.

Spark's reasoning is never visible to IGI. The Responses API returns it only as encrypted items, which IGI sends back to Meta on each turn of the same run so Spark keeps its line of thought between tool calls (§10.1). IGI holds those items in memory for the run only. It never decrypts, logs, persists or displays them, and the trace records only reasoning token counts. The trace is not presented as the model's complete internal reasoning.

### 8.6 Memory scopes and persistence [Existing trace MVP; persistent knowledge Stretch]

| Scope | Owner / key | Persistence and delivery |
|---|---|---|
| **Run** | `analysisRunId` | Ephemeral model context; visible `TraceEvent` and code/execution data persisted for reproducibility. Encrypted reasoning is not persisted. |
| **Review** | `agentDefinitionId` + `reviewId` | Investigation notes and their sources are attached to the review and run, never treated as global facts. In the memory stretch, a follow-up run receives the earlier run's findings and notes as recorded (§6.9), not a model-written summary. |
| **Cross-review handover** [later Stretch] | `agentDefinitionId` + originating `reviewId` | Derived in code from unresolved items and versioned. Every unresolved item is included when the next review begins, until resolved or superseded; original history remains accessible. |
| **Agent knowledge** | stable `agentDefinitionId` + `knowledgeId` | Reusable company-specific knowledge for this specialist. Spark proposes; a human confirms. Scoped, versioned, attributed and validity-checked. Approved, unsuperseded entries effective for the review's period are supplied automatically as data; deeper history through `search_history` in the later stretch. |
| **Company-wide knowledge** | Company and access scopes, independent of an agent | **Post-hackathon only.** Sharing or promotion between specialist agents requires explicit authority and appropriate source permissions. |

For the hackathon there is one fictional company and one logical agent definition, `investment-governance`. Both are constants. The agent-definition id is stored as a plain string on `AnalysisRun` and on knowledge records; it must stay stable across runs and model upgrades, and the schema must not depend on `muse-spark-1.3`, a transient chat ID or Cairn's agent-key identifier. The company is implicit in every scope above: there is no `Company` table and no `companyId` column until a second company exists, and an `AgentDefinition` table only if the stretch needs one.

Do not automatically supply every historical note to every new review. The context assembler gives the current objective, current-source catalogue and policies, **applicable approved agent knowledge** and, in the later stretch, unresolved handover items. `search_history` can fetch more when a question warrants it. A handover is a derivative index with references, not authoritative evidence.

**Where memory enters the prompt.** Approved knowledge and handover items go in a delimited data block in the run's first input turn, each with its id, confirmer and effective dates, introduced as material to weigh rather than instructions to follow. They are never added to the `instructions` field.

Investigation evaluation runs start with an empty knowledge and handover store; the continuity fixture has its own (§15.2).

### 8.7 Learning, approval and validity [Stretch]

A generic, versioned `AgentKnowledge` record (PostgreSQL with structured metadata and flexible JSONB content) is preferred to an explicit asset-class mapping table. The agent may propose *any* useful operational lesson: source selection, field interpretation, data quirk, calculation convention or document location. It need not predict the next customer's exact exception categories.

A knowledge record must contain, at minimum:

- Stable ID and logical agent definition (the company is implicit while there is one); title and content (structured data or text).
- Originating review/run, evidence or artifact references, proposer and confirmation record.
- Scope/applicability: provider/source system and layout version, instrument identifiers or justified instrument/portfolio class, original label, target classification and taxonomy version where applicable, period, or other explicit selectors. Avoid a global label-to-asset-class mapping when its meaning depends on source or instrument.
- Effective date(s) or review trigger; version, status (`proposed`, `approved`, `rejected`, `superseded`, `revoked`) and supersession linkage. An expired or revoked rule is ineligible for automatic reuse, even if it was previously approved.
- An explicit statement of uncertainty and of what this knowledge does **not** establish.

Only a named operator can approve promotion from proposed knowledge. Applying an answer to this review and confirming future reuse are separate explicit actions; saving an answer never implies the latter. A correction creates a new version and supersedes the old one without erasing history. Record each use of a mapping/source-selection rule on the analysis run and dependent calculations. A correction, revocation or newly discovered conflict flags affected current-review findings and generated outputs for reassessment; never mutate their accepted evidence or silently regenerate them. Historical outputs retain the rule version and validity under which they were produced. Approval of operational knowledge does **not** replace approval of source evidence in Cairn and does not certify every later application of that knowledge.

**Authority rule:** current source documents, effective authoritative structured policies and Cairn-accepted evidence take precedence over memory. A remembered mapping or source convention is *not* an authoritative current-period holding or exposure value. If current data conflicts with remembered knowledge, the agent records an open question (§8.8) and does not quietly overwrite policy or guess a new mapping. Remembered material is treated as data, not as fresh model instructions (§8.6); any source-based prompt-injection attempt must not be promoted into an agent directive.

The initial implementation can use PostgreSQL JSONB and scoped indexes/text search. No embeddings, vector database, knowledge graph, automatic knowledge-consolidation agent or generalized memory service is required.

### 8.8 Clarification lifecycle [Stretch]

When a material ambiguity cannot safely be resolved from existing sources or approved knowledge, Spark records an `open_question` note: the question, the affected source or instrument, why it matters and what answer would settle it. It then carries on with the rest of the review. The run ends `completed_with_uncertainties` with its open questions listed, or `blocked` only if nothing else could proceed. The operator answers in IGI. The answer is recorded with author, time and references, and may resolve this review without becoming persistent knowledge.

The question shows the source labels, proposed mapping/source choices and original locations, the affected holdings and calculations, and what remains unresolved. The operator can select a supported proposal, provide an alternative with its rationale/source, or decline to resolve it. Do not turn an unresolved answer into an implicit default.

The operator can explicitly start a **new** analysis run with the answers and the earlier run's findings and notes as recorded. Model-side encrypted reasoning from the previous run is not restorable or replayed. If Spark finds an answer reusable, it separately calls `propose_knowledge`; future runs rely on it only after the operator confirms it.

Neither clarification nor knowledge approval is Cairn evidence acceptance. They remain IGI operational interactions during the hackathon. A generic, authorised Cairn human-intervention request/response surface is a potential later platform capability.

## 9. Sandboxed Python with Monty [New IGI]

### 9.1 Purpose

`@pydantic/monty` runs agent-written Python from the TypeScript backend without giving that code access to the host. It is the exploratory calculation engine.

### 9.2 Supported Python

Monty is not CPython. It has no third-party packages: no pandas, no NumPy. According to its limitations documentation, and confirmed by the smoke test (§9.7), it supports:

- simple classes with `__init__`, common dunder methods and class variables;
- `@dataclass` with `eq=` and `frozen=`, `field()` and `__post_init__` (not `fields()` or `asdict()`);
- f-strings, including format specs, for floats and `Decimal`;
- the modules `decimal` (from Monty 1.4.0; 1.3.0 has none), `datetime`, `math`, `json`, `re`, `collections` and `itertools`, each with documented divergences from CPython.

It does not support:

- class inheritance or metaclasses;
- `@classmethod`, `@staticmethod` or `@property`;
- user-defined exceptions;
- generator functions (`yield`); generator expressions are materialised as lists;
- `bytes` patterns or the `VERBOSE` flag in `re`.

Each unsupported construct raises `NotImplementedError` with a message naming it, which is what Spark sees. `statistics` and `fractions` are absent. Anything else not listed is added to the smoke test before it is relied on.

The `run_python` tool description carries a short guide: write plain functions over lists and dicts, convert numbers with `Decimal(str)`, avoid the unsupported constructs above, and import only the listed modules. Parse errors, runtime errors and limit violations are returned to Spark verbatim (truncated) so it can correct its code. Each failed attempt counts against the run's budget.

### 9.3 Execution contract

Each execution receives the Python source, the permitted inputs or data references, a fixed set of read-only host functions, explicit resource limits, and an execution id with correlation context.

Each result records the source, input identities and hashes, returned values, standard output, errors and limits hit, start and end times, and Monty and IGI versions.

Values crossing the boundary, as observed in the smoke test:

- Python dicts arrive in JavaScript as `Map`, integers beyond 2^53 as `bigint`, and `Decimal` and date values as tagged objects such as `{"__monty_type__": "Decimal", "value": "3.30"}`. The adapter normalises results to JSON, and the tool guide asks code to return decimals as strings.
- A host function that throws raises `RuntimeError` inside the sandbox, where the code can catch it, and the session survives. Host functions report validation failures this way.

### 9.4 Resource limits

Every limit is set explicitly; IGI never relies on defaults, some of which are unlimited. From Monty 1.4.0's declarations and the smoke test:

- **Session limits:** `maxMemory`, `maxFeedDurationSecs`, `maxTurnDurationSecs`, `maxRecursionDepth`, `maxSuspensions` and `maxTotalSleepSecs`. Omitted limits are unlimited, except recursion depth and suspensions, which default to 1,000. Every host-function call is a suspension, so `maxSuspensions` also caps data calls per execution.
- **Exceeding a limit**, as tested: feed duration raises `TimeoutError`, memory `MemoryError`, recursion `RecursionError`, and suspensions `RuntimeError: suspension limit N exceeded`. The error goes back to Spark and the session survives each time. `maxTurnDurationSecs` and `maxTotalSleepSecs` are set but were not triggered; sleeps return immediately under `osPolicy`.
- **Pool options:** `requestTimeout` (off by default) kills a wedged worker and surfaces `MontyCrashedError` with `timedOut: true`; that session is lost and the pool replaces the worker. `maxProcesses` (default: CPU count) and `checkoutTimeout` (default: wait forever) are also set.
- **`osPolicy`** fixes the clock, makes `sleep` return immediately and seeds `random`, so reruns are reproducible.
- **Output:** IGI caps returned output in its own print callback, truncating. Monty's `CollectString` cap rejects a whole buffered burst of output rather than truncating it.

### 9.5 Security boundaries

The sandbox receives no credentials, no database access, no network and no filesystem. Host functions validate every request and enforce review scope and row and byte limits.

Confirmed by the smoke test: file access raises `PermissionError`; `os.environ` and `os.getenv` are unsupported; `socket`, `subprocess`, `urllib` and third-party packages are absent. `installDependencies` is refused, which confirms the pure-Monty worker rather than an embedded CPython one.

Model-written code is treated as untrusted. Monty's isolation is language-level and does not replace host-level security.

### 9.6 Numerical correctness

- Units and rounding are defined explicitly for every financial metric.
- Monetary values and weights never cross from JavaScript into Monty as JavaScript numbers, which become Python floats: in the smoke test, `Decimal(x) + Decimal(y)` with JavaScript `0.1` and `0.2` gives `0.3000000000000000166533453694`. Data functions return decimal strings; code converts them with `Decimal`; results come back as strings.
- Spark's mental arithmetic is never relied on.
- Every material figure in a finding is a claim bound to typed evidence (a check's fact, a structured rule, a quoted source text or a calculation on other claims) for its measure, scope and unit, and checked at the precision stated (§6.4). Without that, a potential exception stays an unvalidated observation.
- Generated Python reads its values with `read_data`; a run whose code contains typed-in decimal figures gets a warning back.
- Methodology is preserved with each result.
- Missing or incompatible inputs are flagged and block the figures that depend on them. A portfolio's look-through exposure with any holding's look-through data missing is unknown: the check gives no exposure and compares no rule, rather than summing the rest.

A calculation can execute correctly and still apply the wrong policy or methodology. Successful execution does not establish that the method or its assumptions are right, so methodology remains visible for review.

### 9.7 Runtime and deployment

Under Node, `@pydantic/monty` is a native binding that runs code in worker subprocesses. It needs a host that permits subprocesses; edge and serverless function runtimes generally don't. A WebAssembly build runs in `worker_threads` where subprocesses are unavailable.

IGI pins `@pydantic/monty` 1.4.0 exactly. It was published on 26 October 2026 under npm's `next` tag; `latest` is still 1.3.0, which has no `decimal` module. Move to `latest` once it reaches 1.4.0 or later, re-running the smoke test.

Smoke test, 27 October 2026 (`npm run smoke:monty` in `server/`):

| Platform | Result |
|---|---|
| Windows 11 x64, Node 26.8.2 | All required checks pass. Pool start about 0.4 s; checkout tens of milliseconds. |
| Linux x64, Node 24.22.1, Debian trixie (glibc 2.41), in Docker | All required checks pass. |
| Linux x64, Debian bookworm (glibc 2.36), in Docker | Monty does not load: its binary needs glibc 2.38 or later (`undefined symbol: __isoc23_sscanf`). |

The service is therefore deployed as a container image based on Debian trixie or Ubuntu 24.04 or later. A buildpack on an older base image won't load Monty, and nor will Alpine, which has no musl binary. The Docker run stands in for DigitalOcean; the smoke test runs again on the deployed service at first deploy.

Larger-scale processing or specialist libraries may later need a dedicated Python service. It is not added until required.

## 10. Technology and Deployment [New IGI]

### 10.1 Stack

| Component | Choice |
|---|---|
| Frontend | React / TypeScript, built and served by the backend |
| Backend | One Node.js / TypeScript service: API, agent loop, Monty, Cairn client |
| Model API | Meta Model API, OpenAI-compatible Responses API (`POST /v1/responses`), stateless with `store: false`, `muse-spark-1.3`, called with plain `fetch` or the OpenAI SDK pointed at Meta's base URL; no agent framework |
| Sandbox | `@pydantic/monty` |
| Database | DigitalOcean Managed PostgreSQL — dedicated IGI logical database and database user on the existing Cairn Dev cluster for the hackathon |
| File storage | DigitalOcean Spaces — separate private IGI bucket with scoped credentials |
| Hosting | One DigitalOcean service that permits subprocesses, deployed as a container image with glibc 2.38 or later (§9.7) |
| Operator access | A single operator login; no role system |
| Observability | Structured JSON logs with correlation ids across model calls, tool calls, executions and Cairn requests; OpenTelemetry optional |
| Document rendering | Versioned IGI HTML templates printed to PDF by a pinned headless Chromium (Puppeteer) in the deployment container; optional PPTX and slide-PDF renderer (§10.4, §13.6) |

**Development infrastructure boundary.** IGI reuses the existing DigitalOcean managed PostgreSQL cluster and Spaces subscription for the hackathon, but has its own logical database, restricted database user, and private bucket with scoped access credentials. It does not use Cairn's database, schema, tables, storage bucket or application credentials. Shared physical infrastructure saves cost but shares resource limits, operational risk and backup arrangements; monitor cluster capacity. A real customer deployment requires its own infrastructure, access controls, backup/restore plan and security/residency review, rather than inheriting the Cairn Dev resources. IGI remains independently deployable on another provider when needed.

**Before substantial implementation, Meta Model API access is validated from the UK with a real tool-calling request to `muse-spark-1.3`**, recording latency, rate limits and cost.

The probe is `npm run probe:meta` in `server/`. It reads `MODEL_API_KEY` from the environment or from `server/.env`, which is gitignored. It makes one tool-calling round trip on Chat Completions and one on the Responses API, and prints latency, rate-limit headers, usage and estimated cost. It tested both because Chat Completions does not carry the model's reasoning between turns, while the Responses API can without storing the conversation at Meta.

**Decided 27 October 2026: the agent loop uses the Responses API, statelessly.** An investigation is a long run of tool turns, and Spark should keep its line of thought across them. Every model request:

- sets `store: false` and `include: ["reasoning.encrypted_content"]`, and never uses `previous_response_id`, so Meta keeps nothing between requests;
- sends the whole run so far: the brief, every output item Spark produced (reasoning, messages and function calls) unchanged, and a `function_call_output` for every call. A reasoning item without a `summary` gets `summary: []`. Resent input is mostly cached, and cached input costs about an eighth of the normal input price;
- answers every function call in a turn, matched by `call_id`, after validating its arguments: the API does not guarantee they match the schema;
- sets `reasoning.effort` per run (default `medium`) and `max_output_tokens`, which bounds reasoning and visible output together. A response with `status: "incomplete"` is recorded as cut off, never as Spark choosing not to call a tool.

The encrypted reasoning items are held in memory for the run only (§8.5). An interrupted run cannot resume part-way through its conversation; it restarts.

**Development inspection through Vessel.** With `--vessel`, `npm run investigate` and `npm run probe:meta` send their model requests through a local Vessel proxy (`VESSEL_URL`, default `http://127.0.0.1:4550`) instead of to Meta directly. Vessel forwards each request unchanged to its `meta` backend and keeps a copy for inspection. Requests are tagged `spark` or `probe`, and an investigation's requests share a Vessel session named after the analysis run. The API key passes through Vessel, which stores only a redacted form. Vessel's history holds whole requests and responses, encrypted reasoning items included, on the developer's machine, so it is for development runs only; without the flag nothing changes and no Vessel headers are sent. IGI itself still persists no reasoning.

Probe result, 27 October 2026, run from the development machine in the UK. Both surfaces work with `muse-spark-1.3`:

| | Chat Completions | Responses (`store: false`) |
|---|---|---|
| Tool round trip | Correct call and arguments; correct answer | Correct call and arguments; correct answer; encrypted reasoning returned and accepted on replay |
| Latency, call 1 / call 2 | 2.7 s / 3.7 s | 1.7 s / 1.4 s |
| Call 2 tokens in / out (reasoning) | 783 / 362 (321) | 897 / 296 (256) |
| Cost of the round trip | $0.0033 | $0.0029 |

The response headers report 3,000 requests and 4,000,000 tokens a minute for the team, matching the published limits. There was one sample per surface, so latency is indicative only. Before calling the tool, the Responses API also returned a short visible message.

A dedicated execution worker is introduced only if reliability or workload isolation requires it.

### 10.2 Repository

The public IGI repository holds the application, the synthetic data generator, the evaluation harness, the Cairn test double, tests, documentation and demo instructions.

Suggested layout, created only as needed:

- `server/`: API, agent loop, tools, Monty adapter, checks, Cairn client, pack generation;
- `web/`: React UI;
- `fixtures/`: scenario generator and development scenarios;
- `eval/`: evaluation harness and scoring; answer keys live here, outside anything the server reads;
- `docs/`: specification, architecture, Cairn contract summary, demo guide.

### 10.3 Generated files and previous outputs [New IGI; storage MVP, index and retrieval Stretch]

**MVP.** IGI stores uploaded source files, investigation packages and committee packs in its private Spaces bucket. Each file is referenced, with its SHA-256 hash, from the row that already owns it: `SourceDocument` for a source, the finding version for its investigation package (the ledger records the hash of what was submitted), and `CommitteePack` for a pack. Python source and output stay in the database with their `CodeExecution`. Generated files are immutable; a change produces a new version. Investigation packages and committee packs are retained as PDF bytes, not just HTML that a browser might print differently. Each output records its media type, content hash, source finding/snapshot identity and renderer/template version. In the deck stretch, each PPTX and slide PDF is owned by the same `CommitteePack` version, with its own immutable artifact identity/hash and generation status; no general artifact registry is needed. An upload is stored under `sources/<SHA-256>/<file>` as an immutable version, and the review reads the latest version of each file. A review created on the command line from a source folder has its files copied there unchanged when a run starts and when a pack is generated. Either way, every hash a run or pack records refers to bytes IGI holds.

The run's transient working files may be short-lived. The final pack, its accepted-evidence snapshot, submitted investigation packages and reproducibility data must survive the run. The original IGI file remains available under IGI permissions even if a copy was submitted to Cairn.

**Artifact != accepted evidence.** An automatically saved artifact is agent-produced and not human-reviewed. Submitting a copy to Cairn creates a candidate, and Cairn's human filing creates accepted evidence. Preserve the correlation and hashes, but never treat the IGI artifact's existence as proof of Cairn acceptance.

**Later stretch.** A `RunArtifact` index over those files adds content type, producer (`AnalysisRun`), source references, creation time and reporting period, so `search_history` can return the identity and summary of an earlier pack or package and, where authorised, bounded extracted text. This is not a general object-store browser or a production content-retrieval framework. The files stay in IGI's Spaces bucket. An agent-accessible artifact registry on Cairn's existing file storage is a **future platform candidate**, not implemented by IGI.

### 10.4 Document rendering and artifact integrity [New IGI]

IGI renders investigation PDFs and committee PDFs from structured, versioned data using reusable templates. HTML/CSS may be an internal rendering format and may provide the in-app preview, but the delivered artifact is a generated PDF. Rendering introduces no new financial calculations or model-written claims. The deck stretch likewise uses a bounded slide template and snapshot fields, not a second unconstrained report-writing pass.

IGI prints its HTML templates to PDF with a pinned headless Chromium, driven by Puppeteer, the same version in development and in the deployment container. Use bundled fonts and assets. Fix page size, margins, typography and table rules. PDFs have selectable/searchable text, clear titles, version/date/page information, repeated table headers where needed, legible charts and references, and controlled page breaks. Long methodology, checks and code go in readable appendices; do not shrink them into unreadable pages or omit them. Preview and downloaded PDF must represent the same content/version. Validate rendering on the deployment target before the demo.

Record a render manifest: source payload or snapshot hash, output version, template/renderer/font versions and exact artifact hash. Content and layout must be reproducible from the retained inputs; do not promise byte-identical PDFs unless timestamps and other renderer metadata are also fixed. The submitted hash always identifies the retained bytes actually sent to Cairn.

Generation is a persisted operation with one owner and retry state. Write outputs to temporary storage, validate completion, then expose the complete artifact. Failed generation never creates a downloadable final result or a candidate submission. Retry an unfinished IGI render without repeating a Cairn submission. A completed artifact is immutable; regeneration creates a new version. Revalidate publication eligibility before releasing a newly rendered committee artifact; status checks establish an as-of result, not an atomic lock on Cairn evidence. If evidence changed or cannot be verified, retain the attempt as incomplete/stale and do not present it as current final output.

PDF/PPTX rendering escapes source and model text, disallows executable embeds and arbitrary HTML, and uses controlled local assets without resolving document-supplied external resources. Presentation must not weaken the existing file, source-data or prompt-injection boundaries.

## 11. Application Data Model [New IGI]

IGI owns operational data. Cairn owns accepted process evidence. Cairn is not used as a store for portfolio rows.

| Entity | Responsibility |
|---|---|
| `Review` | Reporting period, scope, status, Cairn record reference and step and slot ids |
| `SourceDocument` | Immutable original file, version, media type, SHA-256, origin, reporting period, extraction version, locations, validation issues and recorded corrections |
| Domain rows | Portfolios, positions, exposures, performance, fees, committee actions, and structured policy rules (`PolicyRule`), each linked to its `SourceDocument` |
| `AnalysisRun` | Model, prompt and tool versions, configuration (including whether memory was enabled and which knowledge entries were supplied), budget, final status; the agent-definition id as a constant string (§8.6); **[Stretch]** the earlier run it follows |
| `TraceEvent` | One step of the trace: model turn, tool call, note |
| `CodeExecution` | Source, inputs and hashes, outputs, errors, limits, runtime versions |
| `RunArtifact` **[Stretch]** | Index over IGI's stored files (§10.3): hash, content type, reporting period, producer and access scope, for historical lookup; not Cairn evidence |
| `AgentDefinition` **[Stretch]** | Stable specialist identity and responsibility, separate from model/runtime/Cairn key; only if the stretch needs a table, since the MVP uses a constant id |
| `AgentKnowledge` / `KnowledgeProposal` **[Stretch]** | Proposed/approved scoped knowledge, human confirmer, provenance, validity, version and supersession |
| `ReviewHandover` **[Stretch]** | Unresolved-item references derived in code, versioned, scoped to agent and originating review |
| `Clarification` **[Stretch]** | An `open_question` note, the operator's answer, the run that raised it and the run started with the answer, and optional knowledge proposal |
| `Finding` | Statement, classification, materiality, citations, validation state, uncertainty, version, investigation-package file and hash per version, and withdrawal reason and time if withdrawn |
| `CairnSubmission` | The submission ledger entry (§12.4) |
| `ReviewedSnapshot` | The publication-ready findings with their accepted assertion and package evidence, the counts of rejected and withdrawn findings, and the source versions behind them |
| `CommitteePack` | Versioned PDF, snapshot reference, render manifest, generation status, hash, stale/superseded state; optional deck artifacts with their own hashes tied to the same pack/snapshot |

Identifiers stay stable through the investigation and publishing lifecycle. Exact schemas follow implementation. `TraceEvent` is part of the ordinary investigation and audit trace. The entities marked **[Stretch]** are added only after the primary end-to-end MVP is functional. There is one fictional company and no company entity (§8.6). Do not create a second generic memory platform in this repository.

## 12. Cairn Integration

### 12.1 The existing intake contract [Existing Cairn]

IGI uses Cairn's candidate intake, version 1. Every request carries `Authorization: Bearer <agent key>`. The backend holds the key; nothing else does.

| Operation | Route | Notes |
|---|---|---|
| Find a subject | `GET /api/intake/v1/subjects?reference=` | Needs "Start records" |
| List startable procedures | `GET /api/intake/v1/subjects/{subjectReference}/procedures` | Needs "Start records" |
| Start a record | `POST /api/intake/v1/records` | Needs "Start records". Returns the record, its steps and slots, and `repeated` |
| Find open records | `GET /api/intake/v1/records?reference=` | Needs "Look up records". Returns only open, workspace-visible records with incomplete steps |
| Get a record's open steps | `GET /api/intake/v1/records/{cairnReference}/steps` | Needs "Look up records" |
| Submit a file | `POST /api/intake/v1/candidates` | Raw bytes streamed, `Content-Disposition` filename; `Cairn-Source-Reference`, `Cairn-Proposed-Step` and `Cairn-Proposed-Slot` headers |
| Submit an assertion | `POST /api/intake/v1/candidates/assertion` | JSON: `assertionText`, `sourceReference`, `proposedStepId`, `proposedSlotId` |

Submissions return `201` with `candidateId` and `placement`. Anything other than `placed` means the candidate is in the Tray unplaced.

Constraints IGI must respect:

- **Assertions** are plain text, at most 4,000 characters. Cairn shows an agent’s assertion as plain text, in the Tray and once filed, keeping its line breaks: it deliberately does not render an agent’s Markdown, so no link in it becomes live without a person accepting it. IGI therefore writes structured plain text, with short labelled lines and "- " bullets, and no Markdown syntax, HTML or links that would read as clutter. Keep evidence references readable as plain text, and verify the Tray and filed-evidence views in the demo environment. Rendering an agent’s Markdown would be a separately authorised Cairn decision.
- **Files** must be a type Cairn accepts for in-app uploads. New IGI investigation packages and submitted committee packs are PDF (`.pdf`, `application/pdf`), using Cairn's existing file-intake and PDF preview. Markdown/HTML may remain internal or historical artifacts, but are not the new submitted report format. Existing submitted files retain their bytes, evidence and history; converting one requires a new version and new acceptance. Do not assume PPTX intake support: the optional deck is downloaded from IGI, or its PDF rendition may be submitted separately under §13.6.
- **Malware scanning:** in production an agent's file cannot be opened, previewed or filed until scanned, and file candidates are refused if scanning is off. Development deployments may relax the hold.
- **Source references** are display text: at most 200 characters, one line, shown to people in quotation marks. They are not unique and are not an idempotency key.
- **Limits per agent:** 60 requests per 10 minutes across all routes; 100 unfiled candidates; 25 started records nobody has acted on. A started record can be cancelled by a person but never deleted.
- **Candidate submission is not idempotent.** A retried submission may land twice.
- **Record start** with the same procedure, subject and source reference returns the first record only while nobody has acted on it.
- Errors are RFC 9457 problem details with a stable `code`. A refusal carrying a `code`, `429` included, created nothing.

Cairn's MCP server offers the same operations except files. IGI uses HTTP only.

### 12.2 Required Cairn setup [Existing Cairn]

Configured by a Workspace Admin in the chosen Cairn environment:

- a subject for the fictional firm's investment-governance programme. The record is started for it and cannot be moved to another, so it must be the subject the whole review covers, not one portfolio or fund; `open` shows the subject's name and starts nothing without `--start`. Portfolio subjects can be linked to the record as additional subjects by a person in Cairn, where the procedure allows additional subjects; the intake API cannot add them;
- a published procedure for the periodic committee preparation cycle, with steps:
  1. Source data and reconciliation
  2. Portfolio allocation and risk review
  3. Fund, manager and fee oversight
  4. Historical decisions and outstanding actions
  5. Committee pack preparation
- on steps 1 to 4, an assertion slot for finding statements and a document slot for investigation packages, each allowing multiple items, since one step holds several findings; on step 5, a document slot for the committee pack (§13.5). Cairn labels a slot set to one item "single item only" but does not enforce it, and the intake API does not report the setting, so single-item slots mislead the reader. Changing it needs a new published version of the procedure, which applies to records started afterwards;
- an agent named "IGI" with "Look up records" and "Start records" permissions, linked to the demo operator's Cairn user, who must hold a role that can start records;
- an agent key stored only in the IGI backend's environment. Keys expire (90 days by default).

**Demo environment.** Default: Cairn's Dev deployment. It relaxes the hold on unscanned agent files, so file candidates can be opened and filed straight away. The choice and its scanning configuration are confirmed during Gate A. If a stricter environment is used, the demo allows for scanning before filing.

### 12.3 Submission content [New IGI]

For each submitted finding, the backend freezes a presentation payload from its structured finding version, verified claims, coverage, source references and uncertainty. Both the assertion and PDF are rendered from this payload; a fresh model call does not rewrite either.

**Assertion.** Use structured plain text in the existing assertion field, with short labelled sections:

- **Finding:** title, classification/materiality and plain statement.
- **Key figures and checks:** values with units, scope and evidence basis (check fact, structured rule, quoted text or derivation); precise validation status and any unsupported scope/figures.
- **Why it matters:** the finding's own concise explanation, preserving the distinction between facts and interpretation.
- **Evidence:** policy/version, readable row/check references, investigation-package identity, review/run/finding/version and any predecessor.
- **Unresolved:** the specific assumptions and uncertainties; say when none were recorded rather than inventing reassurance.

State that numerical/population validation does not certify the explanation or conclusion. The transmitted text is at most 4,000 characters. Compose concise fields and point to the PDF for detailed workings; do not truncate a sentence or drop a material qualification, unsupported claim or revision reference to fit. If the essential content cannot fit, return a clear preparation error and require a shorter reviewed finding before submission. Test the rendered assertion in both the Tray and filed evidence. Presentation uses existing Cairn functionality and requires no Cairn editor changes.

**Investigation package PDF.** Lead with a reviewer-readable finding summary, key figures and policy, why it matters, validation boundary, uncertainty and an evidence index. Follow with methodology, source document register and exact locations/hashes, cited checks and their scoped facts, calculations, assumptions and revision history. Append the cited executed Python, inputs, outputs and errors relevant to the finding in full, with legible wrapping and pagination. Include review/run/finding/version, generation and rendering metadata. Every assertion figure must agree with the same version in the PDF; neither adds an unsupported causal explanation or recommendation.

**Required pair.** Both the assertion and PDF are mandatory for publication readiness. Correlate candidate IDs with review id, analysis run id, finding id/version, presentation payload hash and exact assertion/file hashes. A file from a different run or version cannot complete the pair, even if its local finding id matches. The payload manifest holds the output hashes outside the PDF to avoid a circular self-hash.

**Source reference and filename.** Include a readable review, short run identifier, finding and version, for example `IGI 2026-10, run a1b2c3, F-07 v2`; keep Cairn's one-line/200-character limit. The full identities remain in IGI's ledger and the PDF. Use a corresponding versioned `.pdf` filename. Display run-qualified finding references in the UI and pack so two runs' F1 items are distinguishable.

**Placement.** Use the step for the finding's review area (source data, allocation and risk, funds and fees, and committee actions are steps 1 to 4), in its first slot accepting the item's kind, using ids from the review's record. Older findings without review areas retain the existing classification fallback. A person may file the evidence elsewhere; IGI reads back placement and never overrides it.

Cairn attributes every submission to the IGI agent. The backend submits under that identity; readable formatting does not change authorship, validation or acceptance semantics.

### 12.4 Submission ledger and reliability [New IGI]

Every submission attempt gets a `CairnSubmission` row before the request is sent:

| Field | Content |
|---|---|
| Ledger id | IGI's own id |
| Review id, analysis run id, finding id and version | The exact finding version submitted; ids such as F1 are not unique across runs |
| Kind | `assertion` or `file` |
| Payload hash | SHA-256 of the exact bytes or text sent |
| Source reference | As sent |
| Proposed step and slot | As sent |
| Outcome | `sending`, `submitted`, `refused`, `uncertain`, or `abandoned` by the operator |
| Candidate id and placement | When Cairn returned them |
| Error code | When Cairn refused |
| Cairn status | Latest status read-back result and when it was read |

Rules:

- `submitted` only when Cairn returned a `candidateId`.
- `refused` when Cairn returned a problem with a `code`. Nothing was created; resending is safe. `429` may be retried automatically after `Retry-After`.
- `uncertain` after a timeout, dropped connection or response without a usable body. A missing response is never treated as a rejection. **Uncertain submissions are never retried automatically.**
- Uncertain entries are shown to the operator, who checks Cairn's Tray and either resends (accepting that a duplicate may need discarding in Cairn) or abandons the entry. An abandoned or refused entry leaves its finding incomplete until the item is resent or the finding is withdrawn (§6.7).
- The status read-back resolves only candidates whose id IGI holds. It cannot resolve a submission whose `candidateId` never arrived.

Record start follows Cairn's rules: always send a source reference; after an unclear outcome, look for an open record for the subject (`GET /api/intake/v1/records?reference=`) before starting again; remember that once a person acts on the record, a repeated start creates a second record.

### 12.5 Candidate-status read-back [Cairn extension]

**Status:** authorised by founder decision on 27 October 2026, to be recorded in Cairn's decision log. The contract below, including its permission, omission and visibility rules, was approved as the API boundary on 27 October 2026. Built in Cairn on 27 October 2026, with the decision record and guardrail amendment, and deployed to Cairn Dev, where the Gate A milestone (§17.1) passed the same day. Its route, field names, wire values (`unfiled`, `filed`, `discarded`, `active`, `voided`), limits and omission and visibility rules match this section as written. IGI codes against it as written; any change to a name, field or rule is a revision of this section, agreed with Cairn first.

#### Operation

```http
GET /api/intake/v1/candidates?id={candidateId}&id={candidateId}
Authorization: Bearer cairn_ak_...
```

- 1 to 100 candidate ids per request. Duplicates are collapsed. No ids, more than 100, or a malformed id is `400 validation.failed`.
- Available to every agent that can submit. No new permission: the admin who allowed the submission has allowed its disposition to be known.
- An MCP tool, `get_candidate_status`, offers the same operation, as every non-file intake operation has an MCP equivalent.

#### Response

```json
{
  "items": [
    { "candidateId": "0199a...", "status": "unfiled", "evidence": null },
    { "candidateId": "0199b...", "status": "discarded", "evidence": null },
    {
      "candidateId": "0199c...",
      "status": "filed",
      "evidence": {
        "cairnReference": "EVI-7KQ2-M9XD-4HPA-K",
        "status": "active",
        "filedUtc": "2026-11-02T10:14:03Z",
        "voidedUtc": null,
        "recordReference": "CAI-4HW8-2TNC-9RFE-B",
        "stepId": "0199...",
        "slotId": "0199..."
      }
    }
  ]
}
```

- `status` is the candidate's lifecycle: `unfiled`, `filed` or `discarded`. `filed` and `discarded` are terminal.
- `evidence.status` is the evidence's state: `active` or `voided`. Voiding is one-way.
- `evidence.cairnReference` is the evidence item's immutable reference. Filed evidence content cannot change in Cairn; only its status and some descriptive metadata can. The reference plus its status is therefore the version IGI needs.
- `recordReference`, `stepId` and `slotId` say where the candidate was filed, which may differ from where it was proposed. They are returned only to agents with "Look up records", the permission that already governs record identity on this surface.

The four states the product needs map onto Cairn's model:

| Product state | Response |
|---|---|
| Unfiled | `status: "unfiled"` |
| Discarded | `status: "discarded"` |
| Filed | `status: "filed"`, `evidence.status: "active"` |
| Voided | `status: "filed"`, `evidence.status: "voided"` |

#### Boundaries

- An agent sees only candidates it submitted. Ids that don't exist, belong to another agent or another workspace, or are not agent submissions are **left out of `items`**. These cases cannot be told apart, and a request whose ids are all unknown returns `200` with an empty list.
- If the record holding the evidence is restricted to named people, the candidate reports `filed` with `evidence: null`. Candidates filed before the extension existed report the same. IGI treats both as unverifiable.
- No evidence content, record names, comments, subject details, user ids or names, or void reasons are returned. An authorised person can see who filed or voided an item, and why, in Cairn from the evidence reference.
- Nothing can be filed, discarded, voided or changed through it.
- Every request is audited against the agent and key, like lookups, recording how many ids were asked about and how many were found, never the ids. A request refused as malformed is not audited. It counts against the 60-requests-per-10-minutes limit.
- It reports the candidate and its evidence, not the record: evidence on a record cancelled later still reads `active`. IGI's review record is not expected to be cancelled; if it is, the operator rebuilds the pack on a new record.
- Authentication, workspace switches, revocation and tenant isolation behave as on every other intake route.

Polling is enough. No webhooks or subscriptions.

#### How IGI uses it [New IGI]

- Poll known candidate ids in batches of at most 100, normally once per minute while review remains pending. Refresh when the operator returns to the review or asks explicitly, before snapshot generation, and when opening, downloading as current final output, or submitting a committee artifact. Include the required pairs, excluded-version evidence and submitted output artifacts that can affect eligibility; checking only included findings can miss stale-making events.
- Coalesce overlapping UI/background refreshes and coordinate the shared 60-requests-per-10-minutes allowance across all routes and batches. Respect `Retry-After` and use backoff for temporary failures. A refresh failure is uncertainty, never acceptance or rejection. Show last-checked time and the pending blocker. An unknown-id or uncertain-submission case cannot be repaired by blind polling/resubmission.
- Persist pending reconciliation work and recover it after restart; repeated reads must not cause duplicate submissions, model runs or artifact generation. Once no routine review work remains, polling may stop. Later voids are detected at the next permitted refresh/open/download check, not continuously. Do not promise immediate push updates or revocation of files already downloaded.
- Reconciliation uses deterministic backend code. Filed/active may enable the operator's generation action; rejection, voiding or uncertainty updates blockers/staleness. None automatically starts a model run. Re-investigation requires an explicit operator action and any explanation needed from the person, since the status route returns no review reasons.
- A candidate entry is **snapshot-eligible** only when `status` is `filed`, `evidence` is present and `evidence.status` is `active`.
- A **submitted finding is publication-ready** only when its assertion candidate **and** its investigation-package file candidate are both snapshot-eligible, linked to the same finding ID and version, and filed against the expected review record (`evidence.recordReference`). Partially accepted findings are incomplete, not publishable conclusions. The other finding states and their effect on the pack are in §6.7.
- Unfiled, discarded, voided, unverifiable (`evidence: null`), uncertain and missing entries are never included in a snapshot. One eligible candidate must never cause an incomplete material finding to appear in a reviewed pack.

### 12.6 Cairn test double [New IGI]

IGI ships an in-process fake of the routes in §12.1 and §12.5, with the same shapes, error codes and limits. It lets judges and the evaluation harness run IGI without Cairn and lets tests drive every status transition. The real Cairn is used only for a small number of end-to-end runs (§15.5).

### 12.7 Cairn procedure/record responsibility [Existing Cairn; future direction]

The Cairn record is the **monthly business review** and its human evidence checkpoints, not a one-to-one proxy for each Spark execution. Multiple IGI analysis runs, corrections and candidate submissions can relate to that one record. Cairn's existing candidate acceptance is the human boundary in this MVP. Generic question/answer approvals, durable agent-run management, shared company memory and artifact retrieval through Cairn remain **post-hackathon design candidates**. No new Cairn routes are required for the IGI memory stretch.

## 13. Review and Publishing Semantics [New IGI]

### 13.1 Acceptance is not approval

IGI keeps these distinct, in data and in wording:

- candidate evidence submitted by the IGI agent;
- evidence filed by a named person in Cairn;
- findings supported by that evidence;
- findings expressly endorsed by decision-makers;
- committee decisions.

Cairn's filing is never presented as approval of a finding, a recommendation or a decision. IGI may keep agent findings and their data independently, but never presents them as human-accepted until Cairn confirms it.

### 13.2 Reviewed snapshot

Built from a status read-back made immediately before generation. It records:

- the Cairn record reference;
- for each publication-ready finding: its assertion candidate ID and evidence reference **and** its investigation-package file candidate ID and evidence reference, with filing times, records, steps and slots;
- the review and analysis run ids, finding ID and version shared by the required pair, plus the exact submitted assertion/PDF payload hashes;
- the number of rejected and of withdrawn findings;
- source document hashes;
- policy rule versions;
- execution and check references;
- the content the pack shows for each finding: statement, explanation, figures with how IGI checked each and what it applies to, whole-population statements with their coverage, policy comparisons, uncertainties and the finding it revised, all contained in its accepted assertion and package;
- the portfolio figures, policy rules in force and open committee actions the pack shows, computed from the hashed sources at generation, and the file store key of each retained source (§10.3);
- for each outstanding-action finding, the committee actions it cites, as the action log its analysis run read records them, and for each finding the rule versions it names as that run read them, so a finding from an earlier run shows what its accepted package rests on;
- the matters the latest run left unresolved: its open questions and blockers, and any potential exception it stored as an observation;
- every submitted item of a withdrawn or rejected version, with its evidence reference and state, without content (§6.7);
- the record's step and slot names;
- the IGI code version that generated the pack and the one the analysis ran on, each a full commit hash, marked as a development build when the working tree had uncommitted changes;
- the generation time and a hash of the snapshot, taken over its JSON with keys sorted so that it verifies after storage.

Only publication-ready findings enter the reviewed snapshot (§6.7, §12.5). While any submitted finding is pending or incomplete, no final pack is generated and IGI lists what blocks it; a preview, if shown, is visibly labelled and presents no conclusion as accepted. The snapshot is immutable. The committee PDF, its preview and optional deck use it alone, with an artifact manifest tying each output to its exact snapshot hash and rendering version (§10.4). Portfolio overviews and unresolved matters retain their source-data/unreviewed labels; inclusion in a reviewed pack does not turn them into accepted findings.

### 13.3 Stale and superseded packs

IGI re-checks **both constituent evidence items for every included finding** whenever it polls and when the pack is opened. If either is no longer filed and active, or becomes unverifiable, the pack is marked **stale**, with the reason. Withdrawing a finding the pack includes also marks it stale, and so does any item of a withdrawn or rejected version becoming, or remaining, filed and active on the record (§6.7). A stale pack is never rewritten. A newly generated pack supersedes it, and both remain in the pack history. The same stale/superseded status applies to every PDF or slide artifact derived from that snapshot. New source versions, corrected/revoked mappings affecting the review, or a newer governing analysis run require reassessment before the previous outputs are offered as current: they mark existing packs stale, so a stale pack cannot be submitted. Preserve historical bytes and their as-of provenance; show why reassessment is needed. Re-check before offering an artifact as current final output: opening a pack reads Cairn afresh. If the check fails, show its last-verified time and an unavailable/unverified state. An explicit historical download may remain available with a clear warning; a pack that is stale, superseded or unverified opens only that way. Files already downloaded or filed in Cairn cannot be remotely changed or withdrawn by IGI.

### 13.4 Pack content

A directly generated pre-meeting **PDF**, with an in-app preview from the same snapshot. The download must have predictable typography, tables, page breaks, page numbers and reference links, without requiring manual browser print settings (§10.4):

**Executive overview:** review period and portfolios; data coverage and validation status; whether the analysis left matters unresolved; number and type of accepted findings; how many submitted findings were not accepted in Cairn and how many the operator withdrew; how many previous committee actions are not recorded as completed; and the accepted findings grouped, each linked to its article, as policy exceptions, actions outstanding or newly triggered, data quality and missing information (when there are any), and lower-priority observations.

**Portfolio overview:** each portfolio's look-through allocation at the last two period ends and the change, with bars, computed by IGI's deterministic checks from the hashed sources and labelled as source data, not evidence filed in Cairn.

**Material findings:** the potential issue, the applicable policy rule and version, each figure with how IGI checked it and what it applies to, each whole-population statement with the population and checks behind it, a note that the explanation and conclusion are the agent's interpretation and not checked (and that reconciling weights shows consistency, not correctness), the finding it revises, explanation, the uncertainties it states as points for committee discussion, evidence references. IGI adds no discussion points of its own. Policy comparisons are shown only where they support the finding: those on the measure of the rule it names, which covers the same limit in other portfolios the finding concerns. A finding that names no rule shows none, since a cited check's comparisons may concern another measure. An outstanding action shows instead the committee actions it cites, as the action log records them. Each comparison states the limit, the date, the actual figure and the margin in percentage points ("Exceeded by 1.97 percentage points"); the exact decimals stay in the investigation package.

**Matters the analysis could not resolve:** the latest run's open questions and blockers and any potential exception it stored as an observation, as the agent recorded them, labelled as not reviewed in Cairn. Shown only when there are any; each finding's own uncertainties stay with the finding.

**Outstanding governance items:** data validation issues, how many findings from the latest analysis run were not submitted to Cairn (as a count, without content), and previous committee actions not recorded as completed.

**Appendix:** data source register, policy rules in force, analysis methods, calculation and investigation references, accepted evidence manifest with step and slot names, evidence of earlier, withdrawn or rejected versions, generation and version information.

The pack states that filing accepts evidence and is not approval, and that Cairn, not the pack, records whether each investigation package was opened before it was filed.

The material findings section contains only publication-ready findings, with both the accepted assertion and the accepted investigation package; no unaccepted supporting calculation may be represented as reviewed. Rejected and withdrawn findings appear only as counts, never with their content. The pack never invents recommendations, market commentary or committee decisions. A pack with no findings is a valid result **only under the conditions in §6.8**: clean findings and validated coverage are worth reporting. Rejected and withdrawn findings' evidence references and states may appear in the appendix, never their content.

### 13.5 Filing the pack in Cairn

The operator can submit the latest committee **PDF**, while it is not stale and a fresh status check confirms eligibility, to Cairn as a candidate document proposed for the committee pack step's document slot. Submit the exact retained PDF bytes and record their hash, pack version and snapshot reference before the request, as in the ledger (§12.4). An uncertain attempt is resent only when the operator asks. A person files or discards it in Cairn; IGI reads back its state with the other candidates. Its filing is a separate acceptance event and never substitutes for the underlying finding pairs. This action already has a working implementation for the earlier pack format in the progress log; v0.13 changes new submissions to PDF, while preserving historical submissions.

IGI completes no step, accepts no evidence and finishes no procedure. Whether steps with no IGI evidence, such as source reconciliation, are completed, skipped or given evidence of their own is a decision for the people running the procedure. The record's Reports section holds only Cairn's own generated reports, so the pack never appears there.

### 13.6 Committee briefing deck [Stretch]

After the complete MVP and priority clarification/memory slice, provide **Generate slides** for an eligible committee-pack version. Produce a concise six-to-eight-slide briefing as editable PPTX plus a matching slide PDF. Both use that pack's exact `ReviewedSnapshot`, after a fresh status check; neither uses live mutable data or an unreviewed model summary. The full committee PDF remains the detailed record of the analysis.

The bounded template covers review scope and coverage; matters needing attention; material allocation/concentration findings; historical actions and new obligations; uncertainties; and recorded discussion/follow-up points. Adapt to the findings actually present and avoid empty filler slides. A clean review is a valid presentation. Do not invent recommendations, decisions, causal claims or discussion points merely to fill the template.

Every material figure and conclusion is traceable to a snapshot field and finding/evidence reference. Slides preserve the unit, period, uncertainty and review status; speaker notes and an evidence appendix may carry supporting detail, but must not hide a qualification that changes the slide's meaning. Source-data overview and unresolved/unreviewed matters retain those labels. Rejected or withdrawn finding content is excluded as in the pack.

Store each deck artifact's hash, renderer/template version and pack/snapshot reference. Layout is tested in the PPTX render and slide PDF: no clipped text, unreadable charts or missing references. A slide-render failure does not invalidate a correctly generated committee PDF, but no partial slide artifact is presented as ready. Evidence changes make all outputs from the snapshot stale (§13.3); replacing them creates new immutable versions.

The operator may download the deck from IGI. If separately submitting it to Cairn, submit its PDF rendition as a distinct candidate through the existing ledger and explicit operator action; do not silently replace the full committee pack or assume PPTX intake/preview support. No new Cairn endpoint or permission is required.

## 14. User Interface [New IGI]

Small and coherent. The gates in §17.1 have passed; the next work makes the existing investigation and review controls visible and the documents usable. Use clear operator actions and status language, without exposing implementation details as the product flow.

- **Reviews:** create/select a reporting period and scope; show investigation status, outstanding clarification/review work and pack versions.
- **Sources:** upload supported XLSX/PDF/DOCX/CSV, view source metadata, original-file locations and validation issues, inspect extracted rows, and record import corrections/mappings. Show which review areas depend on an unresolved issue.
- **Investigation:** an explicit **Start investigation** action and chronological trace of actual tool calls, data accessed, Python run, inputs, outputs, notes and findings. Summaries first; code and raw data expand on demand. **[Stretch]** Show focused questions with affected instruments, labels and source locations, an answer control and **Start follow-up run**; present **Confirm for future reviews** separately on knowledge proposals.
- **Findings:** assertion preview as Cairn will show it, investigation PDF preview/download, classification, scoped claim validation and uncertainty, run-qualified identity and revision history. Show assertion and PDF statuses individually, the derived finding state, last-checked time and Cairn link. Actions: **Open Cairn record**, **Submit findings**, **Refresh Cairn status**, resolve uncertain submissions, and withdraw with a reason. There are no Cairn evidence accept/reject controls in IGI.
- **Pack:** show the precise remaining blockers and enable **Generate committee PDF** only when ready. Provide the matching preview, PDF download, snapshot/evidence references, generation status and version history. Label stale, superseded, incomplete and unverified outputs conspicuously. **[Stretch]** Add **Generate slides** and PPTX/slide-PDF downloads for the same snapshot.

These remain four tabs within a review (Sources, Investigation, Findings, Pack), plus the Reviews list; do not add separate memory or workflow applications. **Needs clarification** and **Waiting for Cairn review** describe pending review work; they do not imply a live model is waiting. On return from Cairn, refresh status within the shared rate limit and explain what changed without starting Spark. Show processing, errors and recovery without losing recorded work after reload/restart (§6.10).

No raw chain-of-thought is shown, and nothing is presented as the model's private reasoning. Filing evidence, resolving an interpretation and confirming a reusable rule remain visibly different actions.

## 15. Evaluation and Testing [New IGI]

### 15.1 Purpose

Show that the agent investigates unfamiliar data rather than following a hard-coded sequence of expected anomalies.

### 15.2 Scenarios and answer-key isolation

A scenario generator produces datasets from a seed and a set of planted issue types. Each scenario has an independent answer key.

Scenarios include:

- genuine policy exceptions;
- subtle problems needing joins or calculations across sources;
- disagreements between reports;
- stale or missing information;
- unresolved historical committee actions;
- policy documents that disagree with their structured rules;
- legitimate anomalies that are not breaches;
- clean portfolios with no material exceptions.

A distinct **[Stretch]** two-period continuity test covers incompatible valuation/model classifications and competing exposure sources. It checks that confirmed mappings/source-selection rules are reused only within scope and validity, new instrument classifications are not guessed, and last month's exposure numbers are not reused as current-period data (§7.4). Keep the memory test's expected answer separate from the agent context; it does not replace the primary blind investigation evaluation.

**Memory never reaches an evaluation run.** There is one company and one agent definition, so approved knowledge and handovers from development or demo reviews would otherwise be supplied to every later run, holdout runs included. Every development, holdout and Gate B run starts with an empty knowledge and handover store, and each run records which knowledge entries it was given (§11). The continuity fixture (§7.4) is the exception: it runs on its own store, and its November run sees only the knowledge approved during its October run.

**Development scenarios** are used freely while building. **Holdout scenarios** are kept separate:

- generated with seeds and issue combinations not used in development;
- including at least one issue type absent from the development set, written after the freeze by someone (or a separate agent session) without access to the prompts and tools;
- run only after the prompts, tools and business rules are frozen at a tagged commit.

Prompts, tools and business rules are never tuned against holdout results. After the freeze only crash and infrastructure fixes are allowed, and any re-run is disclosed.

Isolation is enforced by construction, not just by rule:

- Spark's tools read only the review's imported `SourceDocument` rows;
- answer keys live under `eval/` and are never imported or readable by the server;
- Monty has no filesystem or network;
- investigation evaluation runs see no approved knowledge or handover items;
- scenario file names, sheet names and descriptions are neutral and reveal nothing about planted issues;
- prompts, tool descriptions and data descriptions contain no expected findings;
- an automated isolation check runs before every evaluation and starts none if the instructions, tool definitions or source descriptions contain an answer-key figure, fund name or id, a scenario's file names reveal an issue, or anything in the server imports `eval/` or the generator.

### 15.3 Metrics

- material issues found and missed;
- incorrect or unsupported findings (false positives);
- benign anomalies correctly explained;
- missing information correctly recognised;
- evidence citation accuracy;
- numerical correctness and reproducibility of calculations;
- model and tool cost, and execution time.

Each scenario runs several times. Every run records the model, prompt and tool versions.

A finding is matched to a planted issue by the evidence it cites (the rule version, committee action or check the answer key names for the issue, on the issue's portfolio), never by its wording; its classification then decides whether the issue counts as found. A potential exception or policy inconsistency that matches no planted issue is a false positive. Each claimed figure the generator also computed must equal it, and every check and Python execution is re-run on the same sources to show it reproduces. Results are reported per scenario and per configuration (model, effort, commit, instructions and tools hashes) and never pooled across configurations.

### 15.4 MVP targets

- Find at least 80% of known material exceptions across the holdout scenarios.
- No unsupported confirmed breach assertions.
- Traceable source evidence for every material finding.
- Independent validation of every material number.
- Correctly explain at least one deliberately misleading, non-breaching anomaly.
- Complete analyses with no access to answer keys.
- Preserve the code and inputs needed to reproduce significant calculations.

These are development targets, not claims about production reliability.

### 15.5 Cairn in evaluation

Repeated evaluations use the Cairn test double (§12.6). They create no Cairn records or candidates.

Real Cairn is used for:

- the Gate A milestone (§17.1);
- one or two end-to-end IGI runs before the demo;
- the demo itself.

### 15.6 Automated tests

- CSV/XLSX/PDF/DOCX source parsing, schema validation, equivalent normalized facts across supported formats and original-location provenance (§7.5);
- financial calculations and decimal handling, including JavaScript-to-Monty value transfer;
- wrong dates, units and missing values;
- policy document and structured rule disagreement, without silently selecting or overwriting contradictory evidence;
- Monty resource limits, unsupported-construct errors returned to Spark, and restricted host functions;
- tool input validation and review scoping;
- agent response parsing and error recovery;
- prompt injection embedded in documents and spreadsheet cells;
- submission ledger: refused, uncertain and duplicate submissions; no automatic retry of uncertain ones;
- record-start retry behaviour;
- status mapping for unfiled, filed and active, voided, discarded, unverifiable and missing candidates;
- snapshot eligibility, immutability and stale marking across the committee PDF and any derived deck;
- pack generation from **complete assertion-plus-investigation-package pairs** only, including assertion accepted/file pending, file accepted/assertion discarded, voided support, mismatched finding versions and unverifiable evidence;
- final-pack blocking and incomplete-preview labelling for partially accepted findings;
- rejected findings (assertion discarded) and withdrawn findings excluded and counted; requiring a withdrawal reason; any still-active evidence of an excluded version continuing to block publication; withdrawal of an included finding marking its outputs stale;
- a pack with no findings blocked by a potential exception that was neither submitted nor withdrawn;
- behaviour when Cairn or the status operation is unavailable;
- one end-to-end run against the test double covering realistic imports, investigation, formatted assertion/PDF submission, partial and full filing, snapshot generation and subsequent voiding;
- focused claim validation, contradictory-data and revision cases in §15.7, and document/layout checks in §15.8.

**If the memory stretch is implemented**, add tests for agent/review scoping; isolation from other agent definitions; proposed or review-only answers being ignored as reusable knowledge until human-approved; provider/instrument/taxonomy scope and effective dates; expired, revoked, conflicting or superseded knowledge; a focused open question that blocks only dependent conclusions; a new run started with the recorded answer; knowledge supplied as data, never in `instructions`; evaluation runs receiving no knowledge; and prompt injection via stored memories. Run the October-to-November sequence (§7.4) with changed values and an uncovered new instrument. Correcting a mapping preserves prior versions and marks dependent current-review outputs for reassessment; restarting the service preserves pending clarifications and confirmation state. The later stretch adds a previous handover with older unresolved items and lookup of a previous report from IGI's stored files. The answer keys for continuity fixtures must also remain unavailable to Spark.

### 15.7 Contradictions, revisions and durable review tests

Keep deterministic contract tests separate from live-model evaluations. Use synthetic fixtures, a controlled model stub where a tool sequence is needed, and the Cairn test double; ordinary tests require no live Meta or Cairn calls. Do not assert exact prose or a hard-coded investigation sequence in behavioural evaluations.

Required deterministic cases, retaining the v0.12 regressions already recorded in the progress log:

- A figure omitted from declared claims, a numerically identical fact with wrong measure/portfolio/period/instrument/rule, and a percent/pp mismatch cannot pass validation. Action targets have their own quoted-source evidence, and unsupported population claims cannot hide missing holdings.
- A policy document contradicts the effective structured limit: preserve and surface both sources, apply the structured limit numerically, and do not label the disagreement resolved without evidence.
- An action marked Completed conflicts with holdings that miss its target. A triggered notification lacks delivery evidence. Preserve the distinction between conflicting facts, an obligation arising and proof that an action was missed.
- New explicitly authoritative evidence resolves an apparent breach. A supported revision changes classification/conclusion and becomes current; the original finding, evidence and reason for revision remain available. Test the reverse transition when new evidence establishes a breach.
- An unvalidated replacement cannot retire a validated current finding. Unknown, cross-run/review, self, cycle and already-superseded references are rejected. Rejected revision attempts never count or get submitted; current finding identity is used by every consumer.
- Revised source material is a new immutable source version with provenance. A new run is required when the source manifest changes; the existing same-run `replaces` contract is not stretched to accept a foreign-run id. Publishing a later submitted version still requires reconciliation of earlier active Cairn evidence (§6.7).
- Accept the assertion alone, accept the PDF alone, discard either item, void either item, file on the wrong record, omit an id, or return `filed` without evidence detail. Each produces the documented state and cannot silently publish a final pack. Test pairs whose F1 labels match but whose runs or versions differ.
- Restart while waiting for review or during PDF generation; repeat refreshes and operator clicks; introduce an out-of-order status response. Retain work and prevent duplicate jobs, stale-state rollback and automatic retries of uncertain submissions. Respect rate limiting and backoff. Evidence changes during generation are detected before final output is exposed, or at the next documented check after that as-of verification.
- Withdraw/reject a version whose package remains active, and later file a previously unfiled excluded item. The former blocks final publication; the latter makes existing PDF/deck outputs stale. History is preserved and IGI never voids Cairn evidence itself.

The clean case remains valid. Tests must demonstrate the evidence or state transition being protected, not merely mirror implementation branches.

### 15.8 Presentation and document verification

- Assertions read clearly as plain text in the Tray and filed evidence: labelled lines and bullets, no Markdown or HTML syntax. Enforce the 4,000-character limit without losing qualifications, units or provenance.
- Parse generated PDFs to check expected figures, finding/run/version references, source locators, required appendices and selectable text. Check that every presentation value matches the immutable finding payload or reviewed snapshot.
- Render representative short and long PDFs to page images and inspect them at normal reading size. Cover long fund names, tables spanning pages, dense references, code wrapping, negative figures, zero-findings packs and unresolved issues. Verify page numbers, headings, charts and links, with no clipping, overlap or unreadably small text. Check the actual deployment renderer as well as local output.
- Verify PDF filename/media type, retained exact-byte hash, matched assertion/file version, completed-generation visibility and retry behaviour. Existing Markdown/HTML evidence remains historical; conversion cannot inherit its acceptance.
- **[Stretch]** Render PPTX and slide PDF and inspect every slide. Match figures, units, references and qualifications to the same pack snapshot. Rejected/unreviewed content never appears as accepted. Test deck-render failure separately from pack success, and joint stale marking after evidence changes.

Record visual verification with the relevant change. Automated content checks support, but do not replace, inspection of rendered pages/slides.

## 16. Security and Operations [New IGI]

- Entirely synthetic data. No real financial data, customer information or platform credentials in the repository, fixtures, logs or demo.
- The Meta API key and the Cairn agent key live only in the backend's environment. Spark and Monty receive neither.
- Agent tools are allowlisted, scoped to the current review and read-only, apart from writing notes and findings to IGI's own trace.
- Source document text is untrusted data, never instructions. Importers enforce file/expanded-container size and parser limits, reject unsupported or encrypted formats clearly, and never execute macros or external document links. Renderers escape source text and use controlled assets (§7.5, §10.4).
- Execution logs and source hashes are kept; secrets and unnecessary document content are not logged.
- One fictional firm and one logical investment-governance agent. Multi-tenant isolation and true cross-agent permissions are [Post-hackathon] and must be designed before any real customer data.
- Review notes, memory proposals, approved knowledge and generated artifacts remain within IGI's private development infrastructure. They must not be written into source-control fixtures or exposed through a public data endpoint.
- Approved memory does not become a system-level instruction merely by retrieval. Preserve source, confirmer and validity; exclude superseded or unapproved knowledge from automatic context, and treat retrieved content as untrusted data.
- No external Cairn memory or artifact read/write functionality is introduced for the hackathon.
- Production use would need further work on client-data handling, model-provider terms, retention, security review, regulatory responsibility and incident response. The prototype does not claim to have solved these.

## 17. Delivery Plan

### 17.1 Two gates first

The two highest-risk requirements are proven before anything else gets substantial time. No UI polish before both pass.

**Gate A: Cairn candidate-status read-back [Cairn extension]**

Passed when the extension is merged in Cairn, deployed to the demo environment, and this milestone passes against that deployment:

1. An authenticated agent submits an assertion.
2. Querying it reports `unfiled`.
3. A person files it in Cairn.
4. Querying it reports `filed`, with the evidence reference Cairn shows for it.
5. Steps 1–2 are repeated, a person discards the candidate, and querying reports `discarded`.
6. A person voids the evidence from step 3, and querying reports it `voided`.

Only once Gate A passes does IGI rely on the read-back for committee-pack publication.

**Passed 27 October 2026** against Cairn Dev.

**Gate B: autonomous Spark and Monty investigation [New IGI]**

Passed when, on a development scenario whose planted issues appear nowhere in the prompts or tools, Spark:

- explores the sources and chooses its own analyses;
- runs Python in Monty several times, including a follow-up prompted by an earlier result;
- proposes at least one correct, non-obvious finding that needs a cross-source join or calculation, with cited sources and independent validation;
- explains at least one benign anomaly without calling it a breach;
- makes no unsupported breach claim;

and does it again on a second variation of the scenario.

**Passed 27 October 2026** on development scenarios `dev-01` and `dev-02`. On `dev-01`, Python ran twice in each of two runs, which is borderline for "several times". The results are in `docs/progress.md`.

**Contingency** (not needed: Gate A passed). If Gate A is not passed by the end of 29 October, IGI continues to submission and status display against the test double, and a pack generated against real Cairn is a draft labelled "not verified against Cairn". It never claims acceptance. The demo shows only what works. Scope is cut from stretch goals and UI, not from the gates.

### 17.2 Schedule

**Scheduling rule:** Gates A and B are already documented as passed on 27 October; the progress log also records the earlier-format end-to-end Cairn round trip and v0.12 validation tests. The table retains those original gate dates for historical continuity and updates remaining delivery scope. v0.13 PDF, import and UI requirements still need implementation and verification. The priority memory slice follows the complete MVP, and the deck follows that slice. Neither may delay the evaluation freeze or replace the investigation and Cairn review in the three-minute demo.

| Date | Work |
|---|---|
| Tue 27 Oct | Settle this specification and the read-back contract. Record the Cairn founder decision and guardrail amendment in the Cairn repository. Make a real Meta Model API tool-calling request from the UK. Install Monty and run a smoke test on Windows and on the deployment target. Choose the Cairn demo environment. |
| Wed 28 – Thu 29 Oct | **Gate A** in a Cairn session: implement, test, deploy, run the milestone. **Gate B** in IGI: the first development scenario and importer, the agent loop, the seven tools, the Monty adapter; prove a non-obvious finding twice. |
| Fri 30 – Sat 31 Oct | Finish the IGI operator flow on the existing backend; formatted assertions and investigation/committee PDFs; XLSX/PDF/DOCX uploads and provenance; status/restart handling. Verify the new PDF round trip against Cairn and deploy. |
| Sun 1 – Mon 2 Nov | Evaluation harness, contradictory-data/revision tests, rendering checks and test-double journey. Fixes against development scenarios only. **Only if the MVP is complete:** clarification/mapping and two-period reuse; then the optional snapshot-derived deck if time remains. |
| Tue 3 Nov | Freeze at a tagged commit, recording whether the memory tools are enabled; the holdout runs that configuration, with an empty knowledge store (§15.2). Write and generate holdout scenarios. Run the holdout evaluation several times and record the results as they come out. |
| Wed 4 Nov | Demo video, README and disclosure, check the public repository and deployed demo. Submit by 18:00 GMT, well before the 02:00 GMT (5 Nov) deadline. |

Stretch goals start only if every MVP item in §19.1 is done.

### 17.3 Implementation plan

**1. Read-back API contract (completed foundation).** As in §12.5: one batched, read-only intake route and its MCP equivalent, reporting candidate lifecycle and evidence state for the calling agent's own candidates.

**2. Cairn changes, decision record and security tests (historical; built 27 October).** These were Cairn work under its own rules, not new work requested by v0.13:

- a dated founder decision record for the extension, and amendments to the guardrails' external-surface and candidate-intake sections and their revision log;
- recording, at the moment a candidate is filed, which evidence item it became. The extension added this link because deriving it from step, agent and content is ambiguous in exactly the duplicate-submission case IGI needs to handle. Filings made before the change stay unlinked;
- one read-only command behind the HTTP route and the MCP tool, audited like the existing lookups;
- the intake reference updated, including its list of what intake will not do;
- the API contract, generated client types, API test pack and knowledge wiki updated under Cairn's contract-change process;
- tests: the six milestone steps; another agent's candidate, another workspace's candidate, an in-app Tray item and a nonexistent id all left out identically; a restricted record and an unlinked filing both reporting `evidence: null`; record details withheld from agents without "Look up records"; revoked key and disabled intake refused; malformed and oversized requests refused; an audit entry for every request; rate-limit accounting; no user or content fields in any response; MCP and HTTP parity; tenant row-level security.

The detailed Cairn design is kept with Cairn's private documentation.

**3. How IGI consumes it.**

- The Cairn client exposes `findSubject`, `listStartableProcedures`, `startRecord`, `findRecords`, `getRecordSteps`, `submitAssertion`, `submitFile` and `getCandidateStatus(ids)`, each mapping Cairn's problem codes to typed errors.
- The ledger (§12.4) records every attempt; the poller (§12.5) updates Cairn status; the snapshot builder applies the eligibility rule; the pack view re-checks and marks stale.
- The test double (§12.6) implements the same client contract, so the evaluation harness and tests never need Cairn.

**4. Autonomous Spark and Monty proof of concept.** A command-line run in the server package (`scripts/investigate.ts`): import a development scenario, run the agent loop with the seven tools and Monty, and write the trace to a JSON file in `server/runs/`. Since persistence (28 Oct), the run and its trace are saved in IGI's database instead. Gate B's criteria are the acceptance test. No UI and no Cairn.

**5. Next implementation passes (v0.13).** Build on the working backend and v0.12 validation recorded in `docs/progress.md`; do not rebuild those components or mark new deliverables complete merely because an earlier-format demo worked.

1. **Readable review artifacts:** common presentation payload, structured plain-text assertions, investigation PDFs and directly generated committee PDFs. Preserve claim validation and the submission ledger; add run-qualified identities, artifact hashes and render verification. New PDF submissions require their own Cairn acceptance; historical Markdown/HTML files remain unchanged.
2. **Complete operator journey and realistic sources:** Reviews/Sources/Investigation/Findings/Pack UI, explicit starts/submissions/generation, XLSX/PDF/DOCX/CSV ingestion with original locations, visible blockers and return-from-Cairn refresh. Persist pending work, coalesce polling and verify recovery/duplicate prevention. Complete the end-to-end test-double journey, contradictory-data/revision tests and one new PDF round trip against Cairn.
3. **Priority memory slice [Stretch]:** after every MVP item works and before freeze, implement focused classification/source questions, review-only answers, new-run handling, `propose_knowledge` and separate confirmation, scope/validity and the October-to-November fixture. Verify changed values and a new uncovered instrument. Keep all state in IGI.
4. **Committee briefing deck [Stretch]:** after the priority memory slice, generate and inspect PPTX and slide PDF from the pack's existing snapshot, with matching provenance and stale handling. Do not add a second unconstrained writing agent.
5. **Freeze and submit:** complete the evaluation harness, freeze prompts/tools/business rules, run the isolated holdout, disclose results, verify deployment and record only working features in the demo.

The later handover, `search_history` and artifact index follow the narrow memory slice and are not prerequisites for these artifacts. Do not introduce a general workflow/memory platform, change Cairn, or compromise the evaluation to complete a stretch feature. Update this specification in place if scope changes, and record completed implementation and verification separately in `docs/progress.md`.

## 18. Three-Minute Demo

**0:00–0:20, the problem.** A fictional investment manager preparing its monthly committee: fragmented information and manual analysis.

**0:20–0:40, the input.** Create/select the review in IGI and show XLSX valuations/model rules, the policy PDF and DOCX committee minutes, with original locations and import status. The agent has not been told what is wrong.

**0:40–1:35, autonomous investigation.** Start Spark. Show real tool calls, Python generated and run in Monty, a follow-up investigation triggered by an earlier result, the discovery of a non-obvious exception and a benign anomaly explained away.

**1:35–2:05, evidence and human review.** Show the readable plain-text assertion and open its PDF investigation package inside Cairn. A person files **both**. Return to IGI and refresh status; publication readiness appears only after both are confirmed active for the same version/record. Explain that filing accepts evidence and does not approve an investment decision.

**2:05–2:35, the committee materials.** Download/open the directly generated committee PDF: findings, references, calculations and open questions, with no print-dialog setup. If the deck stretch is complete, show its matching snapshot/version and one or two slides. Optionally void evidence in Cairn, refresh IGI and show both outputs marked stale; do not imply a webhook delivered the change.

**2:35–3:00, significance.** Meta for intelligence, Monty for executable investigation, Cairn for accountability. Existing Cairn, the new Cairn extension and new IGI are identified. A specialist application built quickly on an existing evidence platform: a repeatable forward-deployed delivery model.

The demo shows only working functionality. If Gate A is not passed, it does not show verified acceptance. **Optional memory variant:** if completed and independently tested, use a compact October-to-November sequence: an unfamiliar valuation label/source conflict, the focused question, review-only answer and separate reuse confirmation, then November using current values and asking about an uncovered new asset. Use time from introductory/UI footage, not the core review. Include the optional deck only if its own generation and evidence checks work. Do not displace the live investigation, Monty computation or Cairn human acceptance to fit this in.

## 19. Definition of Done

### 19.1 MVP [MVP]

- [ ] An operator can create a review, upload the documented XLSX/PDF/DOCX/CSV sources and explicitly start an investigation; file arrival alone does not start a model run.
- [ ] Extracted values retain original-file locations, dates and units; unsupported/uncertain data and mapping issues are visible, and dependent conclusions cannot use guessed or silently omitted data.
- [ ] Spark investigates without access to expected findings.
- [ ] Spark writes and runs useful Python through Monty, and corrects its own code after errors.
- [ ] Code, inputs, outputs and source provenance are recorded.
- [ ] Spark finds meaningful exceptions and correctly handles at least one false alarm.
- [ ] Every material number is independently validated.
- [ ] Policy documents and structured rules are both used, and disagreement is flagged.
- [ ] The backend opens a Cairn record and submits, on explicit operator actions, a readable plain-text assertion and generated PDF package to the appropriate steps, with exact payload hashes and a ledger that handles uncertain outcomes.
- [ ] Assertions respect the 4,000-character limit without losing essential qualifiers; assertion and PDF match the same review/run/finding/version and preserve validation boundaries.
- [ ] A person accepts submitted evidence in Cairn.
- [ ] IGI verifies acceptance of **both** the assertion and the investigation-package file for each material finding through the Cairn candidate-status operation (Gate A).
- [ ] Submitted findings are publication-ready only when both required evidence items are accepted and active for the same finding version; incomplete findings cannot silently enter the pack.
- [ ] The final committee pack is a directly downloadable, rendered-and-verified PDF from a fixed reviewed snapshot, with no manual print-scale dependency. Pending/incomplete findings or active excluded-version evidence block final publication; support changes or withdrawal make it stale.
- [ ] Polling/refresh, last-checked time and blockers are visible, respect Cairn's rate limit and recover after restart without duplicate submissions or generation. Status changes do not invoke Spark; unverifiable state cannot enable final publication.
- [ ] Rejected and withdrawn findings are excluded and counted; a pack with no findings requires every potential exception to have been rejected or withdrawn.
- [ ] Deterministic tests cover contradictory sources, claim/scope validation, accepted/rejected revisions, complete evidence pairs, stale outputs and restart recovery; PDF content and rendered layout are verified.
- [ ] The evaluation suite measures discovery quality and numerical correctness on frozen holdout scenarios.
- [ ] The IGI source is public, with the Cairn dependency and the new Cairn extension disclosed.
- [ ] The demo video shows only working functionality.

Where a required integration is not available, the limitation is documented and completed work is kept distinct from future work.

### 19.2 Priority memory stretch [Stretch]

Not part of the MVP.

- [ ] Investigation notes remain scoped to their originating review and run, and reach a later run only as recorded findings and notes, never as approved memory.
- [ ] Spark can propose a generic reusable item with `propose_knowledge`, and the operator confirms it before later runs use it.
- [ ] Knowledge belongs to the stable investment-governance agent definition, not the current model, run or key.
- [ ] A subsequent review automatically gets applicable approved knowledge as a data block, not the entire historical transcript.
- [ ] An ambiguity produces a recorded open question without stopping the rest of the run, and the operator's answer starts a **new** run rather than claiming to resume encrypted reasoning.
- [ ] October's incompatible valuation labels/source conflict produce a focused question; a review-only answer and approval for future reuse are separate recorded actions.
- [ ] The November fixture applies only approved, in-scope mapping/source rules, reads November's values and asks about the newly held fund or uncovered label.
- [ ] Expiry, revocation, taxonomy changes and conflicting authoritative data prevent silent reuse; mapping corrections preserve history and flag dependent current-review results for reassessment.
- [ ] Investigation evaluation runs receive no approved knowledge; the continuity fixture uses only what its own October run approved.
- [ ] Tests distinguish unapproved, stale, conflicting or out-of-scope memories from usable approved knowledge.

If incomplete by the evaluation freeze, document it as unfinished stretch work and exclude it from the demo; do not compromise the primary blind evaluation.

### 19.3 Committee briefing deck [Stretch]

- [ ] A six-to-eight-slide briefing can be generated as PPTX and slide PDF from the same eligible `ReviewedSnapshot` as the committee PDF.
- [ ] Material figures, units, periods, evidence references and qualifications agree across all outputs; no new unsupported recommendations or decisions appear.
- [ ] All slides are visually checked; a failed render is never shown as a ready deck.
- [ ] Artifact hashes and version/snapshot links are retained; evidence changes make all derived outputs stale without altering old bytes.
- [ ] Downloading the deck and any separate submission of its PDF are explicit actions; neither substitutes for the full committee pack or required finding pairs.

This stretch follows the priority memory slice and is omitted from the demo if unfinished at freeze.

## 20. Engineering Guidance

This specification defines product intent, boundaries and outcomes. Before implementing, verify current code, API contracts, SDK versions and deployment capabilities.

1. Validate Meta Model API tool calling and structured output with a real request from the UK.
2. Validate Monty's supported subset, limits and installation with the installed version.
3. Build to Cairn's documented intake contract (§12.1) and the status extension (§12.5), which passed Gate A.
4. Prefer tested calculations over model-generated numbers.
5. One agent and one working end-to-end flow first.
6. No Cairn changes from this repository. Cairn changes follow Cairn's own process.
7. Keep new IGI functionality identifiable in the public repository.
8. Agent-scoped memory and artifacts are **vertical-owned for this hackathon**. Do not create shared memory, artifact or generic approval APIs in Cairn as part of this project.
9. Do not promote unresolved observations, agent-suggested mappings or historical exposure values into authoritative rules. Require human confirmation and period-aware retrieval for reusable knowledge.
10. Preserve the seven-tool investigative MVP and the completed Cairn read-back contract; add `propose_knowledge` only for the priority memory stretch, and `search_history` only after it.
11. Generate assertions, PDFs and optional slides from versioned structured payloads/snapshots. Preserve validation and provenance through every presentation; do not create a second numerical or narrative source of truth.
12. Put imports, clarification, remembered rules, execution recovery and document rendering in IGI. Use polling within the existing Cairn contract; no new Cairn webhook or generic intervention service is required.

### Public references

- [Meta Model API documentation](https://dev.meta.ai/docs/overview)
- [Monty JavaScript quickstart](https://pydantic.dev/docs/monty/quickstart/javascript/)
- [Monty security model](https://pydantic.dev/docs/monty/concepts/security/)
- [Monty limitations](https://pydantic.dev/docs/monty/limitations/)

Cairn's documentation is private. §12 summarises the parts of its contract IGI depends on.

---

**Fundamental product principle**

*The application does not know the answer before an investigation begins. It gives an intelligent agent trustworthy data, controlled analytical capabilities and a clear objective. The agent discovers and substantiates findings. Cairn makes the resulting work subject to human accountability.*

**Fundamental business principle**

*IGI shows that Cairn River can deliver a specialised AI solution quickly on an existing, reusable platform, improving that platform only where a real, generic need appears.*

---

## Revision Log

**v0.13 evaluation, 29 October 2026**

- The isolation check runs before every evaluation; findings are scored by the evidence they cite, per configuration, with numbers cross-checked and calculations re-run (§15.2, §15.3).

**v0.13 clarifications, 29 October 2026** (from the specification audit in the progress log)

- A whole-population statement needs coverage of the kind it states, over the population it names (§6.4).
- Missing look-through data makes an exposure unknown; no exposure, comparison or fact is derived from the rest (§9.6).
- The review's own period end governs the import (§6.2). Any budget refusal ends a run `budget_exhausted` (§8.4).
- §7.5 names where the documented layouts are defined.
- An earlier run's finding shows its own run's committee actions and rule versions (§13.2). New sources or a later run make existing packs stale; opening a pack reads Cairn afresh, and a pack that is not current opens only as a historical copy (§13.3).

**v0.13, 28 October 2026**

- New investigation packages and final committee packs are directly generated PDFs, paired with readable, structured plain-text assertions in the existing 4,000-character Cairn field (§6.5, §10.4, §12.1–12.3, §13.4–13.5). Cairn shows an agent’s assertion as plain text by design, so assertions carry no Markdown. PDFs are printed from HTML templates by a pinned headless Chromium. Preserve historical submitted files and require fresh acceptance for new versions.
- Defined shared presentation payloads, run-qualified identities, exact artifact hashes, renderer/template manifests, readable appendices and deployment/render verification. Preserved v0.12 claim validation and revision semantics.
- Made operator triggers, pending review/clarification states, polling/refresh, restart recovery and duplicate prevention explicit; Cairn status changes use backend reconciliation and require no waiting model call or webhook (§6.10, §12.5, §14).
- Specified realistic XLSX/PDF/DOCX inputs alongside CSV, original-file location provenance and dependent-calculation blocking for ambiguous extraction or mappings (§6.2, §7.1, §7.5).
- Extended the priority October-to-November memory slice to incompatible valuation/model classifications, scoped source selection, separate review-only answers/reuse confirmation, validity/revocation and mapping-impact tracing (§6.9, §7.4, §8.7–8.8).
- Added the subsequent committee deck stretch: PPTX and slide PDF from the same reviewed snapshot, matching qualifications/evidence and stale handling (§13.6, §19.3).
- Integrated contradiction/revision/recovery and document-layout tests, delivery passes, the demo journey and acceptance criteria (§15.6–15.8, §17–19). The progress log's completed work remains historical evidence; this revision does not mark new requirements implemented or modify Cairn's API.

**v0.12, 28 October 2026**

- Validation covers a finding's material claims (§6.4, §9.6):
  - check results yield typed facts with measure, unit and scope;
  - every figure is a claim bound to a fact, a structured rule, a quoted source text or a calculation on other claims, for its portfolio, period, instrument, rule version and unit;
  - every figure in the text must be a verified claim, and population statements need coverage proven from check results;
  - percentages and pp are distinct.
- The assertion, package and pack say how each figure was checked and that the reasoning was not (§12.3, §13.4).
- Revisions are accepted only when they do not retire a validated finding with an unvalidated one; rejected revisions are kept but never count (§6.4, §6.7).
- Instructions on snapshots, triggers, stated aims and reading values in code (§8.3).

**v0.11, 28 October 2026**

- The record must hold no active evidence of a withdrawn or rejected version: such evidence blocks a pack and makes an existing one stale, and a person voids it in Cairn (§6.7, §6.8, §13.3).
- Findings name a review area, which decides their step; a fee finding goes to the fund and fee step (§8.2, §12.3).
- Required setup: a subject for the whole review, slots allowing multiple items, and a document slot for the pack (§12.2).
- A run completes with uncertainties for open questions, blockers or an unvalidated exception, not for an observation with no figures; Spark records unresolved matters as open questions (§8.3, §8.4).
- Pack content: grouped overview, unresolved matters, only the comparisons that support a finding, in percentage points, committee actions for outstanding actions, excluded versions' evidence, step and slot names, code versions, retained sources (§10.3, §13.2, §13.4).
- The pack can be submitted to Cairn as a candidate document (§13.5).

**v0.10, 28 October 2026**

- Each finding counts once, by its latest version, and a finding Spark revised counts only through its revision (§6.7).
- Pack generation also requires the source files to match the latest run's hashes. A pack with no findings counts a finding Spark proposed as a potential exception even if it was stored as an observation (§6.8).
- The snapshot holds everything the pack shows, including the portfolio figures computed from the hashed sources, and its hash is over its JSON with keys sorted (§13.2).
- Pack content made concrete: look-through allocation with the change between periods; the finding's own uncertainties as discussion points; validation issues, the latest run's unsubmitted findings as a count, and open committee actions as outstanding items (§13.4).

**v0.9, 28 October 2026**

- The submission ledger has an `abandoned` outcome for entries the operator abandons (§12.4).
- The proof-of-concept trace is saved in IGI's database rather than a JSON file (§17.3).
- Opening the Cairn record starts from the subject's startable procedures, which also confirms the subject exists, rather than a separate subject lookup (§6.1).

**v0.8, 27 October 2026**

- Removed §20 (post-hackathon direction and the Cairn platform candidates), which a Cairn strategy document now covers; Engineering Guidance is renumbered §20.
- The investigation package is a Markdown file (§12.1).

**v0.7, 27 October 2026**

- Kept memory infrastructure out of the MVP: files are stored in Spaces and referenced from the rows that own them (`SourceDocument`, the finding version, `CommitteePack`), and the `RunArtifact` index moved to the later stretch without retention metadata. The agent definition is a constant id and there is no company entity (§8.6, §10.3, §11).
- Evaluation runs start with an empty knowledge and handover store and record the knowledge they were given; the freeze records whether the memory tools are enabled (§8.6, §15.2, §17.2).
- Labelled the memory text in §1–2 as stretch, and replaced "extension" with "stretch" in the status line.
- Narrowed the priority memory slice to one clarification, `propose_knowledge` with operator confirmation, and the October-to-November reuse. The handover, `search_history` and lookup of earlier packs became later stretch, and earlier pack text is never supplied automatically (§4.3, §6.9, §8.2, §19.2).
- An open question no longer ends a run: Spark records it with the existing `open_question` note kind and carries on, and the run ends `completed_with_uncertainties`. Removed `awaiting_input` (§6.9, §8.4, §8.8).
- The handover is derived in code from unresolved items, with no relevance ranking. Approved knowledge enters the prompt as a delimited data block in the first input turn, never in `instructions` (§6.9, §8.6).
- The continuity example and fixture use two disagreeing look-through sources, through a `source` column and a source argument on the `lookthrough_exposure` check, rather than new security-master and provider-export file types (§6.9, §7.4).
- Replaced the name of a private Cairn component with "Cairn's existing file storage" (§10.3, §20). §5.2 and §21 now say the read-back passed Gate A. The optional memory slice is a paragraph of §17.3, placed before the freeze, and §19 is split into MVP (§19.1) and stretch (§19.2) acceptance.

**v0.6, 27 October 2026**

- Added specialised logical agent definitions and bounded responsibilities; distinguished agent identity from model/runtime/key and Cairn business records from individual analysis runs (§2.5–2.6, §12.7).
- Defined four practical memory scopes (run, review, review handover, agent) and deferred shared company memory; review notes stay scoped, concise handovers carry unresolved work, and only human-confirmed agent knowledge is reused (§6.9, §8.6–8.8).
- Chose generic scoped/versioned operational knowledge over hard-coded asset-mapping tables, with approval, applicability, temporal validity, provenance, conflict/supersession checks and a clarification/new-run pattern that does not claim to resume encrypted reasoning (§8.7–8.8).
- Described IGI-owned immutable run/report artifacts, cross-period reuse and the distinction between stored artifacts and Cairn-accepted evidence (§10.3–11).
- Made the October-to-November knowledge/clarification exercise a **priority stretch after the complete MVP**, with an optional concise demo, separate tests and acceptance criteria; original Gate A/B achievements, main investigation evaluation and Cairn boundary are unchanged (§4, §7, §15–19).
- Captured only *future platform candidates* for Cairn: governed memory, agent-accessible encrypted artifact registry, human intervention requests and procedures as accountable process checkpoints; these are for a separate Cairn strategy document, not this hackathon implementation (§20).
- Corrected the out-of-date document status/extension summary to reflect that Gates A and B already passed on 27 October.

**v0.5, 27 October 2026**

- Defined a material finding as any finding the operator submits, and gave each finding version a state derived from its two candidates and the operator's actions: not submitted, pending, publication-ready, rejected, incomplete or withdrawn (§6.7).
- A finding whose assertion is discarded in Cairn is rejected: excluded from the pack and counted, no longer blocking it.
- Added operator withdrawal in IGI, with a mandatory reason, as the way out for pending, incomplete or voided findings; withdrawing an included finding makes the pack stale (§6.7, §13.3, §14).
- A pack with no findings now requires every potential exception from the latest analysis run to have been rejected or withdrawn (§6.8).

**v0.4, 27 October 2026**

- Switched the IGI development database and file storage to DigitalOcean Managed PostgreSQL and Spaces (§10.1), reusing the existing development subscription with logically separated database, credentials and bucket, while requiring independent production-client infrastructure.
- Required both the finding assertion and its supporting investigation-package file to be accepted and active in Cairn before a material finding can enter the reviewed snapshot or final committee pack (§6, §12–15, §19); incomplete submissions block final pack generation, and voiding either item makes an existing pack stale.

**v0.3, 27 October 2026**

- Recorded the Monty smoke test (§9): `decimal` needs Monty 1.4.0, now pinned; limit names and behaviour confirmed; isolation confirmed; Linux needs glibc 2.38 or later, so deployment uses a trixie or Ubuntu 24.04 container.
- Ran the Meta Model API probe from the UK: tool calling works on both Chat Completions and the Responses API (§10.1).
- Chose the Responses API, stateless, with encrypted reasoning replayed within a run and held in memory only (§10.1, §8.5).

**v0.2, 27 October 2026**

- Authorised a Cairn candidate-status read-back extension and specified its contract (§12.5) instead of treating acceptance read-back as unresolved. The contract was approved as the API boundary the same day.
- Moved all Cairn operations from the agent to the backend; Spark holds no Cairn tools or credentials.
- Reduced fifteen proposed tools to seven.
- Corrected Monty's supported subset and required explicit resource limits and decimal-string value transfer.
- Required both human-readable and structured policies, with disagreement flagged.
- Added the submission ledger rules, the snapshot eligibility rule and stale packs.
- Separated development and holdout evaluation with a freeze, and mocked Cairn in evaluation.
- Removed the non-existent Cairn "request further investigation" action.
- Narrowed the UI to one review page with four tabs, and observability to structured logs.
- Restructured the plan around Gates A and B, with the corrected deadline.
- Recorded the hackathon entry (Startup track, Build for Your World theme) and disclosure rules; removed private links.

**v0.1, 26 October 2026.** First draft.
