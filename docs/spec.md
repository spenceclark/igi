# Investment Governance Intelligence
## Product & Technical Specification — v0.6

**Date:** 27 October 2026  
**Status:** Working implementation specification. Gates A and B passed on 27 October; remaining IGI MVP work is in progress. Memory continuity is an explicitly scoped extension, not a new prerequisite for those gates.  
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

IGI owns the investment data, the investigation and the committee pack. Cairn remains the authoritative system for evidence acceptance.

An investment-governance specialist is a **logical agent definition**, not a particular model instance or chat session. Its investigation notes belong to the review and run; useful firm-specific operational knowledge may be proposed for human confirmation and reused across monthly reviews. During the hackathon, any such memory and generated artifacts remain inside IGI. Shared company memory and agent-accessible artifacts on Cairn are possible future platform capabilities, not a new Cairn deliverable here.

The project tests Cairn as a foundation for independently developed, industry-specific AI applications. Building IGI exposed one genuine platform gap: an outside agent cannot learn what happened to evidence it submitted. That gap is being closed with a small, generic Cairn extension (§12.5) rather than a workaround in IGI.

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

IGI owns its domain data, importers, agent orchestration, calculations, investigation trace, UI, operational memory, run artifacts and report generation.

Cairn owns procedures, records, evidence acceptance, record history, permissions and audit.

- IGI reaches Cairn only through Cairn's authorised API. It never touches Cairn's database.
- IGI does not reproduce Cairn's evidence review or acceptance interface.
- IGI does not change Cairn. Cairn changes go through Cairn's own decision record, guardrails and development rules in the Cairn repository.

### 2.5 Specialist responsibility and durable knowledge

The Investment Governance Agent is responsible for preparing and investigating periodic investment-governance reviews. It may produce committee packs, exception analyses and follow-up materials as outputs of that **one responsibility**. Another responsibility, such as client suitability or compliance assurance, warrants a separate logical agent definition, not merely a different document template.

Long-lived knowledge is scoped to the company and the **logical agent definition**, not to the model name, agent process, prompt version or Cairn API key. Replacing Muse Spark with a new model must not erase learned operational knowledge.

The agent may decide what is worth retaining. **It may not unilaterally make that material an authoritative business rule or share it with other agents.** Run/review notes are automatically retained as history; cross-review operational knowledge requires explicit human confirmation. Scope, provenance, effective dates, supersession and access restrictions are part of the data model (§8.6).

### 2.6 Business process versus execution run

A Cairn procedure defines accountable business checkpoints and a Cairn record represents an instance of that business process. One monthly review record can span several IGI `AnalysisRun` executions, clarifications, accepted evidence items and later committee decisions. Cairn does **not** execute the agent, orchestrate its tool calls or store its transient reasoning state.

Cairn's existing candidate review is the hackathon's human-in-the-loop boundary. A generic agent-requested clarification/approval mechanism inside Cairn is a **post-hackathon platform candidate**, not an existing feature or part of this build.

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

**Import → Investigate → Propose findings → Submit to Cairn → Human acceptance in Cairn → Verify acceptance through Cairn's API → Generate committee pack**

The core experience:

1. Import the synthetic investment data.
2. Watch Spark investigate it using Monty.
3. Inspect findings and their reproducible calculations.
4. Submit findings to Cairn and follow their acceptance status.
5. Produce the reviewed committee pack.

It includes:

- synthetic investment datasets and source documents;
- file import with deterministic validation;
- one autonomous Muse Spark investigation agent;
- sandboxed Python execution with Monty;
- a persisted investigation trace of real tool calls, code, inputs and outputs, scoped to the review and run;
- evidence-backed findings;
- operator-triggered Cairn record start and evidence submission, with a submission ledger;
- human acceptance in the existing Cairn UI;
- acceptance read-back through the Cairn candidate-status extension;
- committee pack generation from a fixed snapshot of verified, accepted, active evidence;
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

Only once the complete MVP works. **The first priority stretch is the narrow cross-review memory demonstration** (§6.9, §8.6); it must not delay the already agreed evidence and committee-pack flow:

- approved, generic agent-scoped operational knowledge, proposed by Spark and confirmed in IGI;
- a compact handover derived from the previous review, with relevant unresolved issues carried forward;
- one operator clarification that ends a run and starts a new run with the confirmed answer, rather than pretending to resume encrypted reasoning;
- an October-to-November scenario that reuses approved knowledge and asks again about a new, uncovered instrument;
- review history and prior generated-artifact lookup for context, without a general-purpose RAG service;
- re-investigation of a single finding, started by the operator from IGI with a note;
- investigation of a second, previously unseen dataset during the demo;
- additional portfolio and performance analytics and richer charts;
- recording committee decisions and carrying actions into the next cycle;
- submitting the committee pack itself to Cairn for a further acceptance step;
- a second agent reviewing the first agent's findings;
- comparing investigations across model configurations.

### 4.4 Post-hackathon [Post-hackathon]

See §20. Includes multi-tenant isolation, role management, production deployment and anything needing real client data. Company-wide shared knowledge, cross-specialist promotion, FDE knowledge onboarding, Cairn-hosted memory/artifact APIs and generic Cairn human-intervention requests are all **post-hackathon candidates**, not IGI MVP work.

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

It requires a dated founder decision and an amendment to Cairn's product guardrails, then a separately scoped implementation with tests, all in the Cairn repository under its own rules. IGI does not depend on it for publication until it passes the milestone in §17.1 (Gate A).

### 5.3 New IGI functionality [New IGI]

Everything in this repository: the synthetic data and scenario generator, importers and validation, the Spark investigation loop and its tools, the Monty adapter, deterministic checks, the investigation trace, findings, the Cairn client and submission ledger, status polling, snapshots, the committee pack, the UI, the evaluation harness, the Cairn test double and the documentation. IGI also owns the basic storage and index of its source and generated artifacts. The priority memory stretch adds agent-scoped knowledge proposals, confirmation, review handovers and historical retrieval entirely within IGI.

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

1. finds the governance subject by its Cairn reference (`GET /api/intake/v1/subjects`);
2. lists the procedures startable for it (`GET /api/intake/v1/subjects/{subjectReference}/procedures`) and picks the configured review procedure;
3. starts the record (`POST /api/intake/v1/records`) with a source reference naming the review, such as `IGI review 2026-10`;
4. stores the returned Cairn reference and step and slot ids on the `Review`.

Retries follow Cairn's documented rules (§12.4).

### 6.2 Import the information [New IGI]

The operator uploads the review's source files. Each file is:

- stored as an immutable input version for the review;
- given a unique source identifier;
- hashed with SHA-256;
- parsed into typed domain data where applicable;
- validated structurally (§7.3);
- recorded with reporting dates, units and provenance.

Missing or invalid data is reported, never silently repaired. Where mapping is ambiguous the operator resolves it before investigation.

### 6.3 Investigate [New IGI]

The operator starts an `AnalysisRun`. Spark receives a broad instruction: review the supplied data against the applicable governance policies, identify matters that need attention and substantiate them.

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

Spark calls `propose_finding` with a structured finding (§8.2). The backend checks that every cited source row, execution and check exists in this run. A finding whose material numbers have not been independently validated is stored as an unresolved observation, not a potential exception.

### 6.5 Submit to Cairn [New IGI]

The operator chooses which findings to submit. The backend, not Spark, submits each one:

- an **assertion** stating the finding (plain text, at most 4,000 characters);
- a **file** holding the investigation package: methodology, inputs and their hashes, executed code, outputs, check results, assumptions and uncertainties.

**Every submitted finding needs both.** For publication, a *material finding* is any finding the operator submits to Cairn, whatever its classification. It is publication-ready only when its assertion and its investigation-package file are each confirmed as filed, active evidence in Cairn for the same finding version. Accepting the assertion alone is not enough.

Each submission proposes a step and slot on the review's record. If the proposal doesn't fit, the candidate waits in the Tray unplaced. Every attempt is recorded in the submission ledger (§12.4).

Submission is not acceptance.

### 6.6 Human review in Cairn [Existing Cairn]

The operator opens the record in Cairn from a link in IGI. There a person files each candidate onto a step as evidence or discards it. They may later void evidence. Discarding a finding's assertion is how the reviewer rejects the finding.

Cairn has no "request further investigation" action. If the operator wants more investigation, they start it in IGI: a new analysis run on the review (MVP), or re-investigation of a single finding ([Stretch]).

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

When more than one description fits, the first in this order applies: withdrawn, rejected, publication-ready, incomplete, pending. For example, a discarded assertion makes a finding rejected whatever its file's state.

**Withdrawal.** The operator can withdraw any finding version in IGI, submitted or not, and must give a reason. IGI records when and why. Withdrawal is final for that version and changes nothing in Cairn: a person discards any of its candidates still unfiled there. To put the matter forward again, the operator submits a new version. Withdrawal is how a pending, incomplete or voided finding stops blocking the pack. It is the operator's decision about what IGI puts forward, not a review decision, which belongs to Cairn.

IGI shows status and links to Cairn. It offers no accept or reject controls.

### 6.8 Generate the committee pack [New IGI]

Immediately before generation, IGI makes a fresh status call and resolves every finding's state (§6.7). A **final committee pack** is generated only when no submitted finding is pending or incomplete. Its immutable `ReviewedSnapshot` (§13.2) holds the publication-ready findings. Rejected and withdrawn findings are excluded, and the pack states how many there were. The pack is generated from that snapshot only, never from unreviewed agent output or live, mutable source data.

While any submitted finding is pending or incomplete, IGI lists what remains to be done and generates no final pack. It may show a preview, clearly marked incomplete, in which no unaccepted finding is presented as reviewed.

**A pack with no findings** is valid only when the review's latest analysis run ended `completed` or `completed_with_uncertainties`, and every potential exception that run proposed (in its latest version) has been rejected in Cairn or withdrawn. A potential exception the operator neither submitted nor withdrew blocks a pack with no findings.

If the verified evidence later changes, the pack keeps its version and is marked stale; a newly generated pack supersedes it (§13.3).

### 6.9 Cross-review knowledge, clarifications and artifacts [New IGI; priority Stretch]

**The existing MVP already persists run notes in the investigation trace.** A subsequent analysis within the same review may be given a concise summary of those notes and can inspect its earlier trace. Notes remain attached to the originating `Review` and `AnalysisRun`; they do not automatically become global agent memory.

The priority memory slice extends the workflow without changing Cairn:

1. When Spark encounters an unresolved classification, source-of-truth or methodology question, it records the exact ambiguity with source references, and ends the run as `blocked` (or `awaiting_input` once explicitly supported).
2. The operator answers inside IGI. An answer may resolve the immediate review without being promoted into long-lived knowledge. If Spark identifies future value, it proposes an agent-scoped knowledge record with applicability, provenance and an explanation of what it should *not* imply.
3. The operator explicitly confirms or rejects the knowledge proposal. Confirmation makes it available to later reviews for the **same logical agent and company**. It does not certify a financial fact or change the authoritative policy table.
4. A new `AnalysisRun` begins with the operator's clarification, approved applicable knowledge and a concise summary of prior work. The encrypted reasoning of the interrupted run is **not resumed**; IGI reconstructs context from its own stored facts and visible artifacts.
5. On completion of a review, IGI derives a compact `ReviewHandover`: significant resolved items, outstanding uncertainties, follow-ups and links to source evidence and artifacts. When the next period starts, only relevant handover items — including older unresolved items — are automatically supplied. Raw historical notes remain searchable on demand, not injected wholesale.
6. IGI indexes its generated investigation packages and committee packs so the same specialist can discover last month's output without the operator uploading it again. Retrieval is bounded to its own authorised IGI company and agent context; older period-specific values are not assumed current.

**Example:** October's provider export uses categories incompatible with the firm's investment taxonomy. Spark asks where the authoritative classification comes from. The analyst confirms the security master for direct securities, and monthly fund-manager look-through reports for multi-asset funds. IGI may retain those *source-selection rules*, after approval. November uses them to obtain current-period data, but asks about a newly encountered instrument rather than inventing a mapping. The October exposure percentages are never silently carried into November.

This is **learning with human supervision**, not automatic self-modification of policies. Company-level knowledge shared with other specialist agents is deliberately excluded from the hackathon (§20).

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

Formats: CSV, XLSX and PDF. Complex enough to need cross-source analysis, small enough for fast iteration.

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
- unit and percentage ambiguity;
- reporting-period mismatches;
- portfolios with no applicable policy;
- invalid or inconsistent financial values.

These establish whether data is safe to analyse. They are not the investigation.

### 7.4 Two-period memory demonstration [Stretch]

Prepare a **separate** synthetic continuity fixture with two periods. October includes a provider classification that is ambiguous against the firm's taxonomy and cannot safely be normalised from available input. The operator supplies the source-selection rule; the agent proposes to remember it; the operator confirms it. November repeats the familiar source but changes period-specific values and introduces one new asset with an unrecognised mapping. Expected behaviour: reuse the approved source rule, fetch the current-period classification/exposure, and ask about the new asset rather than guess.

Keep this scenario out of the primary Gate B evaluation. It tests the memory/clarification slice, not whether the agent can discover planted investment exceptions. Its answer key is likewise inaccessible to Spark.

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
| Trusted calculations | `run_check` | Runs a named, tested deterministic calculation, such as weight reconciliation, look-through exposure against a limit, concentration, fee change between periods, or performance recomputation. The catalogue is in the tool description; Spark decides whether and when to call them. |
| Record work | `record_note` | Records an observation, hypothesis, assumption, open question or missing-information blocker. |
| | `propose_finding` | Creates a structured finding: statement, classification, portfolios, policy rule and version, cited source rows, execution and check ids, explanation, assumptions and uncertainties. |

**Optional memory tools [Stretch]**: `search_history` searches approved knowledge and relevant prior review handovers/notes and returns only bounded, source-attributed results (including artifact references). `propose_knowledge` writes a **proposal**, never an approved memory; the backend/operator handles confirmation. Use `record_note` for clarification requests, with a typed note kind, rather than adding another model tool. The backend may expose previous IGI-generated report text through bounded historical lookup if needed; no unrestricted object-store tool or cross-agent access is implied.

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
- cite the sources, executions and checks behind each finding;
- avoid inventing absent values or unsupported explanations;
- stop when coverage is sufficient or the budget runs out.

Spark cannot change investment data or anything in Cairn.

### 8.4 Budgets and final status

Each run has configured limits on model tokens and estimated cost, wall-clock time, tool calls, Python executions, and rows and bytes returned by data tools.

A run ends as `completed`, `completed_with_uncertainties`, `blocked`, `failed` or `budget_exhausted`. Budget exhaustion is never reported as completion. A clarification can use `blocked` in the MVP; the memory stretch may add an explicit `awaiting_input` state. An answer starts a new run with reconstructed persisted context and a reference to the blocked run, not a resumed Meta Responses conversation.

### 8.5 Investigation trace

Every model turn, tool call, argument, result, Python source, execution result, note and finding is persisted in order with a correlation id. The trace is the record of what the agent did.

Spark's visible message text, including any short message it writes before a tool call, is shown as labelled model output.

Spark's reasoning is never visible to IGI. The Responses API returns it only as encrypted items, which IGI sends back to Meta on each turn of the same run so Spark keeps its line of thought between tool calls (§10.1). IGI holds those items in memory for the run only. It never decrypts, logs, persists or displays them, and the trace records only reasoning token counts. The trace is not presented as the model's complete internal reasoning.

### 8.6 Memory scopes and persistence [Existing trace MVP; persistent knowledge Stretch]

| Scope | Owner / key | Persistence and delivery |
|---|---|---|
| **Run** | `analysisRunId` | Ephemeral model context; visible `TraceEvent` and code/execution data persisted for reproducibility. Encrypted reasoning is not persisted. |
| **Review** | `companyId` + `agentDefinitionId` + `reviewId` | Investigation notes and their sources are attached to the review and run, never treated as global facts. Follow-up runs receive a **summary**, with detailed notes available for retrieval. |
| **Cross-review handover** | `companyId` + `agentDefinitionId` + originating `reviewId` | One derived, versioned summary of outstanding matters and relevant follow-ups. Relevant entries are included when future reviews begin until resolved or superseded; original history remains accessible. |
| **Agent knowledge** | `companyId` + stable `agentDefinitionId` + `knowledgeId` | Reusable company-specific knowledge for this specialist. Spark proposes; a human confirms. Scoped, versioned, attributed and validity-checked. Relevant approved entries are supplied automatically; deeper history is searched as needed. |
| **Company-wide knowledge** | Company and access scopes, independent of an agent | **Post-hackathon only.** Sharing or promotion between specialist agents requires explicit authority and appropriate source permissions. |

For the hackathon there is only one fictional company and one logical `investment-governance` agent definition, but its identifier must remain stable across runs and model upgrades. The data schema should not depend on `muse-spark-1.3`, a transient chat ID or Cairn's agent-key identifier.

Do not automatically supply every historical note to every new review. The context assembler gives the current objective, current-source catalogue and policies, **applicable approved agent knowledge**, and concise unresolved handover items. `search_history` can fetch more when a question warrants it. A handover is a derivative index with references, not authoritative evidence.

### 8.7 Learning, approval and validity [Stretch]

A generic, versioned `AgentKnowledge` record (PostgreSQL with structured metadata and flexible JSONB content) is preferred to an explicit asset-class mapping table. The agent may propose *any* useful operational lesson: source selection, field interpretation, data quirk, calculation convention or document location. It need not predict the next customer's exact exception categories.

A knowledge record must contain, at minimum:

- Stable ID, company and logical agent definition; title and content (structured data or text).
- Originating review/run, evidence or artifact references, proposer and confirmation record.
- Scope/applicability: source system, instrument/portfolio class, period, or other justified selectors.
- Effective date(s) or review trigger; version, status (`proposed`, `approved`, `rejected`, `superseded`) and supersession linkage.
- An explicit statement of uncertainty and of what this knowledge does **not** establish.

Only a named operator can approve promotion from proposed knowledge. A correction creates a new version and supersedes the old one without erasing history. Approval of operational knowledge does **not** replace approval of source evidence in Cairn and does not certify every later application of that knowledge.

**Authority rule:** current source documents, effective authoritative structured policies and Cairn-accepted evidence take precedence over memory. A remembered mapping or source convention is *not* an authoritative current-period holding or exposure value. If current data conflicts with remembered knowledge, the agent asks for clarification and does not quietly overwrite policy or guess a new mapping. Remembered material is treated as data, not as fresh model instructions; any source-based prompt-injection attempt must not be promoted into an agent directive.

The initial implementation can use PostgreSQL JSONB and scoped indexes/text search. No embeddings, vector database, knowledge graph, automatic knowledge-consolidation agent or generalized memory service is required.

### 8.8 Clarification lifecycle [Stretch]

When a material ambiguity cannot safely be resolved from existing sources or approved knowledge, Spark uses `record_note` to register a typed clarification request: the question, affected source/instrument, why it matters and what would enable resumption. The run ends `blocked` / `awaiting_input`. The operator answers in IGI. The answer is recorded with author, time and references, and may resolve this review without becoming persistent knowledge.

The operator can explicitly start a **new** analysis run with the answer and a compact summary of relevant prior visible work. Model-side encrypted reasoning from the previous run is not restorable or replayed. If Spark finds the answer reusable, it separately calls `propose_knowledge` and waits for confirmation before future runs may rely on it.

Neither clarification nor knowledge approval is Cairn evidence acceptance. They remain IGI operational interactions during the hackathon. A generic, authorised Cairn human-intervention request/response surface is a potential later platform capability (§20).

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
- Every material number in a finding is validated independently, by a `run_check` result or a backend recomputation in decimal arithmetic. Without that, the finding stays an unresolved observation.
- Methodology is preserved with each result.
- Missing or incompatible inputs are flagged.

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

**Development infrastructure boundary.** IGI reuses the existing DigitalOcean managed PostgreSQL cluster and Spaces subscription for the hackathon, but has its own logical database, restricted database user, and private bucket with scoped access credentials. It does not use Cairn's database, schema, tables, storage bucket or application credentials. Shared physical infrastructure saves cost but shares resource limits, operational risk and backup arrangements; monitor cluster capacity. A real customer deployment requires its own infrastructure, access controls, backup/restore plan and security/residency review, rather than inheriting the Cairn Dev resources. IGI remains independently deployable on another provider when needed.

**Before substantial implementation, Meta Model API access is validated from the UK with a real tool-calling request to `muse-spark-1.3`**, recording latency, rate limits and cost.

The probe is `npm run probe:meta` in `server/`. It reads `MODEL_API_KEY` from the environment or from `server/.env`, which is gitignored. It makes one tool-calling round trip on Chat Completions and one on the Responses API, and prints latency, rate-limit headers, usage and estimated cost. It tested both because Chat Completions does not carry the model's reasoning between turns, while the Responses API can without storing the conversation at Meta.

**Decided 27 October 2026: the agent loop uses the Responses API, statelessly.** An investigation is a long run of tool turns, and Spark should keep its line of thought across them. Every model request:

- sets `store: false` and `include: ["reasoning.encrypted_content"]`, and never uses `previous_response_id`, so Meta keeps nothing between requests;
- sends the whole run so far: the brief, every output item Spark produced (reasoning, messages and function calls) unchanged, and a `function_call_output` for every call. A reasoning item without a `summary` gets `summary: []`. Resent input is mostly cached, and cached input costs about an eighth of the normal input price;
- answers every function call in a turn, matched by `call_id`, after validating its arguments: the API does not guarantee they match the schema;
- sets `reasoning.effort` per run (default `medium`) and `max_output_tokens`, which bounds reasoning and visible output together. A response with `status: "incomplete"` is recorded as cut off, never as Spark choosing not to call a tool.

The encrypted reasoning items are held in memory for the run only (§8.5). An interrupted run cannot resume part-way through its conversation; it restarts.

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

### 10.3 Generated artifacts and previous outputs [New IGI; existing MVP storage, retrieval Stretch]

IGI stores **raw input versions, generated Python source/outputs, investigation packages and committee packs** in its own DigitalOcean storage and database, with stable artifact IDs, SHA-256 hashes, content type, producer (`AnalysisRun`/agent), source references, creation time, reporting period and retention metadata. Treat generated artifacts as immutable versions; produce a new version for changes. Artifact metadata is centrally indexed in IGI so the specialist can discover last month's pack or calculation without requiring a fresh upload.

The run's transient working files may be short-lived. The final pack, its accepted-evidence snapshot, submitted investigation packages and reproducibility data must survive the run. The original IGI artifact remains available under IGI permissions even if a related copy was submitted to Cairn.

**Artifact != accepted evidence.** An automatically saved artifact is agent-produced and not human-reviewed. Submitting a copy to Cairn creates a candidate, and Cairn's human filing creates accepted evidence. Preserve the correlation and hashes, but never treat the IGI artifact's existence as proof of Cairn acceptance.

For the memory stretch, `search_history` may return the identity and summary of an earlier artifact and IGI may provide bounded extracted text/structured content where authorised. This is not a general object-store browser or a production content-retrieval framework. The file itself remains in IGI Spaces for the hackathon. Cairn's encrypted StoredFiles and possible agent-accessible artifact registry are **future platform candidates**, not implemented by IGI (§20).

## 11. Application Data Model [New IGI]

IGI owns operational data. Cairn owns accepted process evidence. Cairn is not used as a store for portfolio rows.

| Entity | Responsibility |
|---|---|
| `Review` | Reporting period, scope, status, Cairn record reference and step and slot ids |
| `SourceDocument` | File, version, SHA-256 hash, origin, reporting period, validation results |
| Domain rows | Portfolios, positions, exposures, performance, fees, committee actions, and structured policy rules (`PolicyRule`), each linked to its `SourceDocument` |
| `AnalysisRun` | Model, prompt and tool versions, configuration, budget, final status; stable agent-definition ID and optional predecessor/clarification link |
| `TraceEvent` | One step of the trace: model turn, tool call, note |
| `CodeExecution` | Source, inputs and hashes, outputs, errors, limits, runtime versions |
| `RunArtifact` | Indexed immutable input/output files, generated reports and investigation packages, with hashes, reporting period, producer and access scope; existing IGI storage, not Cairn evidence |
| `AgentDefinition` **[Stretch]** | Stable specialist identity and responsibility, separate from model/runtime/Cairn key; one investment-governance definition in this prototype |
| `AgentKnowledge` / `KnowledgeProposal` **[Stretch]** | Proposed/approved scoped knowledge, human confirmer, provenance, validity, version and supersession |
| `ReviewHandover` **[Stretch]** | Derived, versioned cross-period summary and unresolved-item references, scoped to company, agent and originating review |
| `Clarification` **[Stretch]** | Unresolved operator question, user answer, linked blocked and restarted runs, and optional knowledge proposal |
| `Finding` | Statement, classification, materiality, citations, validation state, uncertainty, version, and withdrawal reason and time if withdrawn |
| `CairnSubmission` | The submission ledger entry (§12.4) |
| `ReviewedSnapshot` | The publication-ready findings with their accepted assertion and package evidence, the counts of rejected and withdrawn findings, and the source versions behind them |
| `CommitteePack` | Generated output, version, snapshot reference, hash, stale/superseded state |

Identifiers stay stable through the investigation and publishing lifecycle. Exact schemas follow implementation. `TraceEvent` and `RunArtifact` are part of the ordinary investigation/audit trace; the four knowledge/clarification concepts marked **[Stretch]** are added only after the primary end-to-end MVP is functional. Do not create a second generic memory platform in this repository.

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

- **Assertions** are plain text, at most 4,000 characters. Markdown and links are not rendered.
- **Files** must be a type Cairn accepts for in-app uploads; PDF, HTML, Markdown, JSON and CSV are among them. The investigation package format is chosen by how it previews in Cairn, checked in Gate A.
- **Malware scanning:** in production an agent's file cannot be opened, previewed or filed until scanned, and file candidates are refused if scanning is off. Development deployments may relax the hold.
- **Source references** are display text: at most 200 characters, one line, shown to people in quotation marks. They are not unique and are not an idempotency key.
- **Limits per agent:** 60 requests per 10 minutes across all routes; 100 unfiled candidates; 25 started records nobody has acted on. A started record can be cancelled by a person but never deleted.
- **Candidate submission is not idempotent.** A retried submission may land twice.
- **Record start** with the same procedure, subject and source reference returns the first record only while nobody has acted on it.
- Errors are RFC 9457 problem details with a stable `code`. A refusal carrying a `code`, `429` included, created nothing.

Cairn's MCP server offers the same operations except files. IGI uses HTTP only.

### 12.2 Required Cairn setup [Existing Cairn]

Configured by a Workspace Admin in the chosen Cairn environment:

- a subject for the fictional firm's investment-governance programme;
- a published procedure for the periodic committee preparation cycle, with steps:
  1. Source data and reconciliation
  2. Portfolio allocation and risk review
  3. Fund, manager and fee oversight
  4. Historical decisions and outstanding actions
  5. Committee pack preparation
- on each step, an assertion slot for finding statements and a document slot for investigation packages;
- an agent named "IGI" with "Look up records" and "Start records" permissions, linked to the demo operator's Cairn user, who must hold a role that can start records;
- an agent key stored only in the IGI backend's environment. Keys expire (90 days by default).

**Demo environment.** Default: Cairn's Dev deployment. It relaxes the hold on unscanned agent files, so file candidates can be opened and filed straight away. The choice and its scanning configuration are confirmed during Gate A. If a stricter environment is used, the demo allows for scanning before filing.

### 12.3 Submission content [New IGI]

For each submitted finding:

- **Assertion:** the backend composes it from the structured finding: statement, classification, key figures with units, the policy rule and effective version, and IGI's finding and run ids. It fits within 4,000 characters of plain text.
- **Investigation package file:** methodology, input references and hashes, executed code, outputs, check results, assumptions and uncertainties.
- **Required pair:** both the assertion and investigation-package file are mandatory for every submitted finding to be publication-ready. Their candidate IDs are correlated by IGI finding ID and version in the submission ledger; no single item stands in for the other.
- **Source reference:** short and readable by the people filing it, such as `IGI review 2026-10, finding F-07`.
- **Placement:** the step and slot the backend maps the finding's classification to, using the ids from the review's record.

Cairn attributes every submission to the IGI agent; the backend submits under that identity.

### 12.4 Submission ledger and reliability [New IGI]

Every submission attempt gets a `CairnSubmission` row before the request is sent:

| Field | Content |
|---|---|
| Ledger id | IGI's own id |
| Finding id and version | What was submitted |
| Kind | `assertion` or `file` |
| Payload hash | SHA-256 of the exact bytes or text sent |
| Source reference | As sent |
| Proposed step and slot | As sent |
| Outcome | `sending`, `submitted`, `refused`, `uncertain` |
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

- One batched request per minute while any ledger entry is `unfiled`, a request when the operator refreshes, one immediately before building a snapshot, and one for a pack's snapshot candidates whenever that pack is opened. Well within the rate limit. Once nothing is unfiled, polling stops, so a later void is detected when the pack is next opened or refreshed, not continuously.
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
- the IGI finding ID and version shared by the required pair;
- the number of rejected and of withdrawn findings;
- source document hashes;
- policy rule versions;
- execution and check references;
- the generation time and a hash of the snapshot.

Only publication-ready findings enter the reviewed snapshot (§6.7, §12.5). While any submitted finding is pending or incomplete, no final pack is generated and the review is marked incomplete; a preview, if shown, is visibly labelled and presents no conclusion as accepted. The snapshot is immutable.

### 13.3 Stale and superseded packs

IGI re-checks **both constituent evidence items for every included finding** whenever it polls and when the pack is opened. If either is no longer filed and active, or becomes unverifiable, the pack is marked **stale**, with the reason. Withdrawing a finding the pack includes also marks it stale. A stale pack is never rewritten. A newly generated pack supersedes it, and both remain in the pack history.

### 13.4 Pack content

An HTML pre-meeting pack, exported to PDF with the browser's print function:

**Executive overview:** review period and portfolios; data coverage and validation status; number and type of potential exceptions; how many submitted findings were not accepted in Cairn and how many the operator withdrew; areas needing committee attention.

**Portfolio overview:** allocation figures, changes between periods, charts from reviewed information.

**Material findings:** the potential issue, the applicable policy rule and version, supporting calculations and comparisons, explanation and uncertainties, evidence references, points for committee discussion.

**Outstanding governance items:** missing data and unresolved investigations, previous committee actions still open, matters needing human judgement.

**Appendix:** data source register, analysis methods, calculation and investigation references, accepted evidence manifest, generation and version information.

The material findings section contains only publication-ready findings, with both the accepted assertion and the accepted investigation package; no unaccepted supporting calculation may be represented as reviewed. Rejected and withdrawn findings appear only as counts, never with their content. The pack never invents recommendations, market commentary or committee decisions. A pack with no findings is a valid result **only under the conditions in §6.8**: clean findings and validated coverage are worth reporting.

## 14. User Interface [New IGI]

Small and coherent. Visual polish comes after the gates in §17.1 are passed.

- **Reviews:** a list of reviews with period, status and pack versions.
- **Review page**, with four tabs:
  - **Sources:** upload, metadata, reporting dates, validation issues.
  - **Investigation** (the centrepiece): the chronological trace of real tool calls, data accessed, Python run, inputs, outputs, notes and findings, with follow-up investigations visible as such. Readable without reading every line of code: summaries first, code and data on expansion. **[Stretch]** Show a small inline clarification panel and pending/approved knowledge proposals; no new standalone memory management application.
  - **Findings:** each finding with classification, figures, citations, validation state, separate assertion/file submission and Cairn statuses, the finding state (§6.7), and a link to the Cairn record. Buttons to submit to Cairn, to resolve uncertain submissions, and to withdraw a finding with a reason. No accept or reject controls.
  - **Pack:** the snapshot, preview, print to PDF, history, stale and superseded markers. Earlier pack versions are indexed as IGI artifacts; **[Stretch]** allow the agent to retrieve last period's report by its reference.

No raw chain-of-thought is shown, and nothing is presented as the model's private reasoning.

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

A distinct **[Stretch]** two-period continuity test checks that a confirmed source-selection rule is reused, new instrument classifications are not guessed, and last month's exposure numbers are not reused as current-period data. Keep the memory test's expected answer separate from the agent context; it does not replace the primary blind investigation evaluation.

**Development scenarios** are used freely while building. **Holdout scenarios** are kept separate:

- generated with seeds and issue combinations not used in development;
- including at least one issue type absent from the development set, written after the freeze by someone (or a separate agent session) without access to the prompts and tools;
- run only after the prompts, tools and business rules are frozen at a tagged commit.

Prompts, tools and business rules are never tuned against holdout results. After the freeze only crash and infrastructure fixes are allowed, and any re-run is disclosed.

Isolation is enforced by construction, not just by rule:

- Spark's tools read only the review's imported `SourceDocument` rows;
- answer keys live under `eval/` and are never imported or readable by the server;
- Monty has no filesystem or network;
- scenario file names, sheet names and descriptions are neutral and reveal nothing about planted issues;
- prompts, tool descriptions and data descriptions contain no expected findings.

### 15.3 Metrics

- material issues found and missed;
- incorrect or unsupported findings (false positives);
- benign anomalies correctly explained;
- missing information correctly recognised;
- evidence citation accuracy;
- numerical correctness and reproducibility of calculations;
- model and tool cost, and execution time.

Each scenario runs several times. Every run records the model, prompt and tool versions.

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

- source parsing and schema validation;
- financial calculations and decimal handling, including JavaScript-to-Monty value transfer;
- wrong dates, units and missing values;
- policy document and structured rule disagreement;
- Monty resource limits, unsupported-construct errors returned to Spark, and restricted host functions;
- tool input validation and review scoping;
- agent response parsing and error recovery;
- prompt injection embedded in documents and spreadsheet cells;
- submission ledger: refused, uncertain and duplicate submissions; no automatic retry of uncertain ones;
- record-start retry behaviour;
- status mapping for unfiled, filed and active, voided, discarded, unverifiable and missing candidates;
- snapshot eligibility, immutability and stale marking;
- pack generation from **complete assertion-plus-investigation-package pairs** only, including assertion accepted/file pending, file accepted/assertion discarded, voided support, mismatched finding versions and unverifiable evidence;
- final-pack blocking and incomplete-preview labelling for partially accepted findings;
- rejected findings (assertion discarded) and withdrawn findings excluded, counted, and no longer blocking; withdrawal requiring a reason; withdrawal of an included finding marking the pack stale;
- a pack with no findings blocked by a potential exception that was neither submitted nor withdrawn;
- behaviour when Cairn or the status operation is unavailable;
- one end-to-end run against the test double.

**If the memory stretch is implemented**, add tests for company/agent/review scoping; isolation from other agent definitions; proposed knowledge being ignored until human-approved; applicability and effective dates; contradictory/superseded instructions; previous handover with older unresolved items; missing-context clarifications and new-run restart; retrieval of a previous report from IGI artifact storage; and prompt injection via stored memories. The answer keys for continuity fixtures must also remain unavailable to Spark.

## 16. Security and Operations [New IGI]

- Entirely synthetic data. No real financial data, customer information or platform credentials in the repository, fixtures, logs or demo.
- The Meta API key and the Cairn agent key live only in the backend's environment. Spark and Monty receive neither.
- Agent tools are allowlisted, scoped to the current review and read-only, apart from writing notes and findings to IGI's own trace.
- Source document text is untrusted data, never instructions.
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

**Scheduling rule:** Gates A and B are already documented as passed on 27 October. The table retains the original milestones for historical continuity. The priority memory slice must not jeopardise the IGI core submission, evaluation freeze or three-minute demo. Implement it after the end-to-end Cairn acceptance/pack round trip works; otherwise leave it as documented [Stretch].

| Date | Work |
|---|---|
| Tue 27 Oct | Settle this specification and the read-back contract. Record the Cairn founder decision and guardrail amendment in the Cairn repository. Make a real Meta Model API tool-calling request from the UK. Install Monty and run a smoke test on Windows and on the deployment target. Choose the Cairn demo environment. |
| Wed 28 – Thu 29 Oct | **Gate A** in a Cairn session: implement, test, deploy, run the milestone. **Gate B** in IGI: the first development scenario and importer, the agent loop, the seven tools, the Monty adapter; prove a non-obvious finding twice. |
| Fri 30 – Sat 31 Oct | Minimum end-to-end IGI: persistence, trace, findings, record start, submission ledger, status polling, snapshot, HTML pack. One real end-to-end run against Cairn. Deploy. |
| Sun 1 – Mon 2 Nov | Evaluation harness, scenario variations and test double. Fixes against development scenarios only. Investigation trace UI. Prompt-injection tests. **Only if the MVP is complete:** the narrow agent-memory/clarification and two-period continuity slice. |
| Tue 3 Nov | Freeze at a tagged commit. Write and generate holdout scenarios. Run the holdout evaluation several times and record the results as they come out. |
| Wed 4 Nov | Demo video, README and disclosure, check the public repository and deployed demo. Submit by 18:00 GMT, well before the 02:00 GMT (5 Nov) deadline. |

Stretch goals start only if every MVP item in §19 is done.

### 17.3 Implementation plan

**1. Read-back API contract.** As in §12.5: one batched, read-only intake route and its MCP equivalent, reporting candidate lifecycle and evidence state for the calling agent's own candidates.

**2. Cairn changes, decision record and security tests.** All in the Cairn repository, under its rules:

- a dated founder decision record for the extension, and amendments to the guardrails' external-surface and candidate-intake sections and their revision log;
- recording, at the moment a candidate is filed, which evidence item it became. Cairn does not store this link today, and deriving it from step, agent and content is ambiguous in exactly the duplicate-submission case IGI needs to handle. Filings made before the change stay unlinked;
- one read-only command behind the HTTP route and the MCP tool, audited like the existing lookups;
- the intake reference updated, including its list of what intake will not do;
- the API contract, generated client types, API test pack and knowledge wiki updated under Cairn's contract-change process;
- tests: the six milestone steps; another agent's candidate, another workspace's candidate, an in-app Tray item and a nonexistent id all left out identically; a restricted record and an unlinked filing both reporting `evidence: null`; record details withheld from agents without "Look up records"; revoked key and disabled intake refused; malformed and oversized requests refused; an audit entry for every request; rate-limit accounting; no user or content fields in any response; MCP and HTTP parity; tenant row-level security.

The detailed Cairn design is kept with Cairn's private documentation.

**3. How IGI consumes it.**

- The Cairn client exposes `findSubject`, `listStartableProcedures`, `startRecord`, `findRecords`, `getRecordSteps`, `submitAssertion`, `submitFile` and `getCandidateStatus(ids)`, each mapping Cairn's problem codes to typed errors.
- The ledger (§12.4) records every attempt; the poller (§12.5) updates Cairn status; the snapshot builder applies the eligibility rule; the pack view re-checks and marks stale.
- The test double (§12.6) implements the same client contract, so the evaluation harness and tests never need Cairn.

**4. Autonomous Spark and Monty proof of concept.** A command-line run in the server package (`scripts/investigate.ts`): import a development scenario, run the agent loop with the seven tools and Monty, and write the trace to a JSON file in `server/runs/`. The trace moves to the database with persistence (Fri 30 – Sat 31 Oct). Gate B's criteria are the acceptance test. No UI and no Cairn.

**5. Shortest route to a complete demo.** Once both gates pass:

1. Persist and render the trace the proof of concept already produces (Investigation tab).
2. Findings tab: list findings, submit through the ledger, show polled status and finding state, withdraw with a reason.
3. Snapshot and HTML pack from fully accepted assertion-plus-investigation-package pairs; print to PDF.
4. Sources tab with upload and validation.
5. Evaluation harness on the test double; then the holdout run.
6. Deploy, record the demo, submit.

**6. Optional memory slice:** If all six steps work with comfortable margin, introduce the `AgentKnowledge` proposal/approval store, `ReviewHandover`, clarification/restarted-run handling, and bounded historical artifact lookup. Confirm the two-period scenario independently. This is not an excuse to rebuild the model loop or create Cairn memory APIs.

## 18. Three-Minute Demo

**0:00–0:20, the problem.** A fictional investment manager preparing its monthly committee: fragmented information and manual analysis.

**0:20–0:40, the input.** The portfolio data, policies (document and structured rules) and prior committee actions. The agent has not been told what is wrong.

**0:40–1:35, autonomous investigation.** Start Spark. Show real tool calls, Python generated and run in Monty, a follow-up investigation triggered by an earlier result, the discovery of a non-obvious exception and a benign anomaly explained away.

**1:35–2:05, evidence and human review.** IGI's backend submits the finding assertion and its investigation package to the Cairn record. A person files **both** in Cairn. IGI marks the finding publication-ready only after the read-back confirms both accepted and active. The distinction between the agent producing evidence and a person accepting it is explained.

**2:05–2:35, the committee pack.** The pack built from the verified snapshot: the finding, references, calculations and open questions. Optionally, void the evidence in Cairn and show the pack marked stale.

**2:35–3:00, significance.** Meta for intelligence, Monty for executable investigation, Cairn for accountability. Existing Cairn, the new Cairn extension and new IGI are identified. A specialist application built quickly on an existing evidence platform: a repeatable forward-deployed delivery model.

The demo shows only working functionality. If Gate A is not passed, it does not show verified acceptance. **Optional memory variant:** if completed and independently tested, replace a few seconds of introductory/UI footage with the October-to-November handover: one approved source-selection rule reused and one new asset correctly sent back for clarification. Do not displace the live investigation, Monty computation or Cairn human acceptance to fit this in.

## 19. Definition of Done [MVP]

- [ ] A review can be created and loaded with a realistic synthetic dataset.
- [ ] Spark investigates without access to expected findings.
- [ ] Spark writes and runs useful Python through Monty, and corrects its own code after errors.
- [ ] Code, inputs, outputs and source provenance are recorded.
- [ ] Spark finds meaningful exceptions and correctly handles at least one false alarm.
- [ ] Every material number is independently validated.
- [ ] Policy documents and structured rules are both used, and disagreement is flagged.
- [ ] The backend starts a Cairn record and submits evidence to appropriate steps, with a ledger that handles uncertain outcomes.
- [ ] A person accepts submitted evidence in Cairn.
- [ ] IGI verifies acceptance of **both** the assertion and the investigation-package file for each material finding through the Cairn candidate-status operation (Gate A).
- [ ] Submitted findings are publication-ready only when both required evidence items are accepted and active for the same finding version; incomplete findings cannot silently enter the pack.
- [ ] The committee pack is generated from a fixed snapshot of publication-ready findings, blocks final publication while any submitted finding is pending or incomplete, and becomes stale if either accepted evidence item changes status or an included finding is withdrawn.
- [ ] Rejected and withdrawn findings are excluded and counted; a pack with no findings requires every potential exception to have been rejected or withdrawn.
- [ ] The evaluation suite measures discovery quality and numerical correctness on frozen holdout scenarios.
- [ ] The IGI source is public, with the Cairn dependency and the new Cairn extension disclosed.
- [ ] The demo video shows only working functionality.

Where a required integration is not available, the limitation is documented and completed work is kept distinct from future work.

### 19.1 Priority memory stretch acceptance (not part of MVP)

- [ ] Investigation notes remain scoped to their originating review/run and can be summarised or retrieved later without automatically becoming approved memory.
- [ ] Spark can propose a generic reusable item, and a human confirms it before later runs use it.
- [ ] Knowledge belongs to the fictional company and stable investment-governance agent definition, not the current model/run/key.
- [ ] A subsequent review automatically gets a relevant handover and applicable approved agent knowledge, not the entire historical transcript.
- [ ] An unresolved clarification produces a recorded operator question and starts a **new** run with the answer rather than claiming to resume encrypted reasoning.
- [ ] The November fixture reuses an October source-selection convention while requiring new current-period exposure values and clarification for a newly unknown instrument.
- [ ] A prior IGI-generated report or investigation package can be located by reference and read through authorised, bounded IGI access without a new upload.
- [ ] All tests distinguish unapproved, stale, conflicting or out-of-scope memories from usable approved knowledge.

If incomplete by the evaluation freeze, document it as unfinished stretch work and exclude it from the demo; do not compromise the primary blind evaluation.

## 20. Post-Hackathon Direction [Post-hackathon]

IGI is Cairn River's first demonstrable forward-deployed solution, not necessarily its first commercial product.

Afterwards, assess:

- whether small discretionary managers recognise the problem and its cost;
- whether IGI meaningfully reduces preparation time;
- what integrations real firms would need;
- whether Cairn's APIs and evidence model are sufficient, and which further platform capabilities would be reused across engagements;
- whether this becomes a packaged product or stays a client-specific offering;
- which company and agent knowledge should be centralised, and what proves reuse across **at least two distinct specialist applications**;
- whether prior agent-generated artifacts require cross-application discovery and download with Cairn's existing encrypted StoredFiles layer;
- which human clarification/approval requests should eventually become governed, durable Cairn interactions.

**Potential Cairn platform evolution — not committed implementation:**

- **Governed memory:** company-wide approved policies and context, specialist agent knowledge, and handovers, with tenant/access scopes, provenance, time validity, supersession and human confirmation. This is not an instruction to move IGI's current run state or encrypted model reasoning into Cairn.
- **Governed artifact registry:** metadata, permissions, versioned references and controlled retrieval over Cairn's already tenant-isolated encrypted file storage. Automatically generated run artifacts must remain distinct from evidence accepted into records. A future specialist should be able to find a previous report **only if authorised**.
- **Cairn procedures and records as business-process checkpoints:** one business record may span many agent executions, tools and clarifications. Cairn governs human interventions and accountable outcomes; external verticals run and resume their own agent workflows. A generic human request/response API is a candidate, not built today.
- **FDE onboarding:** a future client engagement could preload approved firm terminology, policies, system/data-source descriptions and document conventions into appropriately scoped company knowledge. It should not turn IGI's hackathon into a basic policy-document RAG product.

The long-term architecture and commercial direction belong in a separate **Cairn Agentic Platform Vision** document, not in IGI's hackathon deliverables. Its future proposals must not override Cairn's authoritative product guardrails or trigger speculative implementation.

Cairn is extended only for real, generic needs, as with the candidate-status read-back, never for a hypothetical one. Solutions may run in Cairn River's infrastructure or a customer's.

## 21. Engineering Guidance

This specification defines product intent, boundaries and outcomes. Before implementing, verify current code, API contracts, SDK versions and deployment capabilities.

1. Validate Meta Model API tool calling and structured output with a real request from the UK.
2. Validate Monty's supported subset, limits and installation with the installed version.
3. Build to Cairn's documented intake contract (§12.1) and, once Gate A passes, the status extension (§12.5).
4. Prefer tested calculations over model-generated numbers.
5. One agent and one working end-to-end flow first.
6. No Cairn changes from this repository. Cairn changes follow Cairn's own process.
7. Keep new IGI functionality identifiable in the public repository.
8. Agent-scoped memory and artifacts are **vertical-owned for this hackathon**. Do not create shared memory, artifact or generic approval APIs in Cairn as part of this project.
9. Do not promote unresolved observations, agent-suggested mappings or historical exposure values into authoritative rules. Require human confirmation and period-aware retrieval for reusable knowledge.
10. Preserve the seven-tool investigative MVP and the completed Cairn read-back contract; implement `search_history`/`propose_knowledge` only for the priority memory stretch.

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
