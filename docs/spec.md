# Investment Governance Intelligence
## Product & Technical Specification — v0.1

**Date:** 26 October 2026  
**Status:** Draft for implementation  
**Organisation:** Cairn River Ltd  
**Project:** Standalone AI-first investment governance application, powered by Cairn  
**Hackathon:** Meta Global AI Developer Hackathon 2026  
**Proposed track:** Startup — Build for Your World

---

## 1. Executive Summary

Investment Governance Intelligence (IGI) is an AI-powered investment-governance analyst for small and mid-sized UK discretionary investment management firms.

It helps investment teams prepare for periodic investment committee meetings by examining information from multiple sources, independently investigating discrepancies, identifying potential policy exceptions and producing evidence-backed findings.

Unlike conventional reporting automation, the AI is not given a predetermined series of calculations and expected conclusions.

Instead, **the AI agent acts as an investigator**. It can inspect unfamiliar datasets, formulate hypotheses, select analytical tools, write Python, execute calculations, inspect the results and decide whether further investigation is warranted.

The system combines three responsibilities:

1. **Intelligence:** Meta Muse Spark performs autonomous investigation, reasoning and interpretation.
2. **Computation:** Sandboxed Python execution through Pydantic Monty, supported by deterministic TypeScript analysis and validation.
3. **Accountability:** Cairn manages procedure records, evidence submission, human acceptance, attribution and audit history.

The application manages investment-domain data and produces the final investment committee materials. Cairn remains the authoritative system for evidence review and acceptance.

The project will demonstrate how a specialised application can be delivered rapidly using Cairn as a reusable foundation — a prototype of Cairn River's emerging forward-deployed engineering business model.

## 2. Product Philosophy

### 2.1 An investigator, not a scripted workflow

The agent's objective is to discover and substantiate material issues in investment information.

It must not be told which anomalies exist, where they are located or what conclusions it is expected to reach.

It may be provided with:

- The overall investment-governance objective.
- Authoritative policies and the firm's review requirements.
- Descriptions and schemas of available datasets.
- Tools for reading, querying and analysing information.
- The context and scope of the review.

It must determine which investigations to perform.

Ordinary data validations and known policy calculations may be implemented deterministically, but those checks must not dictate the complete investigation or replace autonomous reasoning.

**A successful agent must be able to discover a material problem that the developer did not explicitly anticipate.**

### 2.2 Evidence before conclusions

Every material finding must have sufficient supporting information for another person to examine and challenge it.

A finding without adequate evidence is an unresolved observation, not a confirmed exception.

The application must distinguish:

- Source facts.
- Calculated results.
- Agent interpretations.
- Potential exceptions.
- Accepted evidence.
- Committee decisions.

### 2.3 Human accountability

Agents may start Cairn records and submit candidate evidence to the Tray or directly to compatible evidence slots on existing records.

A named human must accept that evidence before it becomes part of the authoritative Cairn record.

Cairn preserves both the originating agent attribution and the accepting human attribution.

**Accepting evidence does not automatically mean approving the agent's conclusion or making an investment decision.**

### 2.4 Platform boundaries

The vertical application owns its domain-specific workflows, operational database, agent orchestration, calculations, importers, UI and report generation.

Cairn owns procedure records, evidence acceptance, record history, permissions and auditability.

The project must not recreate Cairn's evidence review interface.

No direct access to Cairn's database is permitted.

## 3. Fictional Customer and Business Problem

### 3.1 Customer

A fictional UK discretionary investment manager:

- Approximately 20 employees.
- Three model investment portfolios used in the prototype.
- A monthly investment committee.
- Investment information supplied by multiple providers and systems.
- Limited internal software development capacity.
- Human oversight of all consequential investment decisions.

This is a deliberately realistic hypothetical customer, not a validated paying customer.

### 3.2 Current process

Each month, an investment analyst:

1. Collects portfolio holdings, allocation reports and performance figures.
2. Reconciles information from different reporting systems.
3. Reviews investment policies, portfolio limits and manager information.
4. Investigates discrepancies and possible breaches.
5. Checks changes to fund charges, allocation assumptions and other relevant information.
6. Reviews outstanding actions from previous committee meetings.
7. Produces investment committee materials.
8. Records decisions and follows up afterwards.

Information may be spread across spreadsheets, PDF documents, emails, minutes and proprietary systems.

The objective is to reduce manual preparation and investigation work while improving the reproducibility and traceability of the results.

### 3.3 Target users

**Investment Analyst:** Initiates a review, supplies information, monitors investigations and prepares committee material.

**Head of Investments / CIO:** Reviews proposed findings, checks supporting calculations and approves evidence in Cairn.

**Investment Committee Member:** Consumes the final pack, examines findings and participates in decisions.

For the hackathon, a single operator may demonstrate all three roles. Production-grade role management across the vertical is outside the initial scope.

## 4. Scope

### 4.1 Hackathon MVP

The MVP must provide an end-to-end flow:

**Import → Investigate → Substantiate → Submit to Cairn → Human review → Generate committee pack**

It includes:

- Synthetic investment datasets and source documents.
- File import and deterministic validation.
- An autonomous Meta Muse Spark investigation agent.
- Sandboxed Python execution using Monty.
- Investigation history with generated code and results.
- Evidence-backed findings.
- Cairn record initiation and evidence submission.
- Human acceptance through the existing Cairn UI.
- Authoritative read-back of accepted evidence, where supported by a verified integration.
- Committee pack generation from a fixed set of accepted evidence.
- A blind evaluation suite with known expected outcomes.

### 4.2 Explicitly excluded

The MVP will not include:

- Live trading or dealing instructions.
- Portfolio rebalancing or optimisation.
- Personalised investment recommendations.
- Client suitability assessments.
- Real customer financial data.
- Live custody, trading or market-data integrations.
- Automated acceptance of evidence.
- Autonomous committee decisions.
- A replacement for Cairn's review UI.
- A general-purpose investment management platform.
- A complex hierarchy of collaborating agents.

Muse Voice, Muse Image and SAM are not required. Muse Spark is the central Meta capability.

### 4.3 Possible stretch goals

Only after the complete core workflow functions:

- Investigation of a second, previously unseen dataset.
- Additional portfolio or performance analytics.
- Automated production of more sophisticated charts.
- Recording post-committee decisions and carrying actions into the next cycle.
- A second agent independently reviewing the first agent's findings.
- Comparison of investigations produced by different model configurations.

## 5. Functional Workflow

### 5.1 Create a review

The operator selects a reporting period and creates a new investment-governance review.

The vertical application creates an internal `Review` and an associated `AnalysisRun`.

Using an authorised Cairn agent identity, it finds the existing governance subject, obtains the published review procedure and initiates a Cairn record if needed.

Cairn's existing record initiation and candidate-intake contracts must be used.

The application stores the resulting Cairn reference for correlation.

### 5.2 Import the information

The operator supplies the review's source files.

Each file is:

- Stored as an immutable input version for the review.
- Assigned a unique source identifier.
- Hashed using SHA-256.
- Parsed into typed domain data where applicable.
- Validated for structural correctness.
- Recorded with reporting dates, units and provenance.

Missing or invalid data must be reported rather than silently repaired.

Where data mapping is ambiguous, an operator may resolve it before investigation.

### 5.3 Start autonomous investigation

The operator starts an analysis run.

Muse Spark receives a broad instruction to review the supplied data against the applicable governance policies, identify matters requiring attention and provide defensible supporting evidence.

The agent can inspect schemas, select data, query previous context and execute analytical code.

It should not receive the evaluation answer key or any instructions revealing planted anomalies.

### 5.4 Investigate iteratively

The agent may repeat the following cycle as necessary:

1. Formulate an analytical question.
2. Determine what information is required.
3. Retrieve data through approved tools.
4. Generate Python or invoke deterministic calculations.
5. Execute the analysis.
6. Inspect the results.
7. Challenge the result or investigate further.
8. Record an observation or proposed finding.

A successful investigation need not produce a finding. The agent may conclude that a suspected issue has a legitimate explanation.

### 5.5 Submit candidate evidence to Cairn

A proposed finding should have a supporting evidence package containing:

- The finding and its classification.
- The data sources used.
- The applicable policy and effective version.
- The calculations and generated code.
- Execution results.
- Validation results.
- Relevant assumptions and uncertainties.
- A plain-English explanation.

The vertical submits the appropriate components as Cairn candidate evidence using the existing HTTP/MCP intake interface.

Where compatible, the agent proposes direct placement against the relevant procedure step and evidence slot. Otherwise the candidate remains in the Tray.

Submission does not mean acceptance.

### 5.6 Human review

The operator opens the Cairn record.

The reviewer can inspect the submitted material and accept, discard or request further investigation.

This happens in Cairn, not in a duplicated approval interface within IGI.

Rejected or unaccepted material remains outside the accepted evidence set.

### 5.7 Generate the committee pack

Once the relevant evidence has been accepted, the vertical retrieves an authoritative view of the accepted evidence and constructs a fixed `ReviewedSnapshot`.

The pack is generated from that snapshot, not from unreviewed agent observations or live mutable source data.

The pack identifies material findings, accepted evidence, outstanding uncertainties, potential exceptions and items for committee discussion.

It does not present proposed investment actions as approved committee decisions.

The resulting pack is versioned and may itself be submitted to Cairn as candidate evidence for a further human acceptance step.

## 6. Demonstration Dataset

### 6.1 Dataset structure

Create a realistic, entirely synthetic investment-governance dataset.

It should contain:

- Three model portfolios with different investment objectives.
- Two consecutive reporting periods.
- Portfolio positions, values and reported weights.
- Instrument identifiers and fund classifications.
- Underlying fund asset-class exposures.
- Investment mandates and risk limits.
- Historical performance and benchmarks.
- Provider fee information.
- A previous investment committee's decisions and outstanding actions.

Suggested source formats are CSV, XLSX and PDF.

Use synthetic values and fictional entities. Financial conventions should nevertheless be internally coherent.

The dataset should be complex enough to require cross-source analysis, but small enough for efficient hackathon testing.

### 6.2 Independent evaluation fixtures

Maintain a separate test-fixture generator and answer key.

The fixtures should contain examples of:

- Genuine policy exceptions.
- Subtle problems requiring joins or calculations across sources.
- Disagreements between reports.
- Stale or missing information.
- Unresolved historical committee actions.
- Apparent anomalies that are not actually breaches.
- Clean portfolios containing no material exceptions.

**Do not encode the expected findings into the agent's prompts, tools, data descriptions or runtime-accessible metadata.**

The evaluator may know the planted issues. The investigating agent must not.

Tests should include multiple generated variations so the system cannot pass merely by recognising one fixed dataset.

The public repository may contain evaluation fixtures, but the runtime agent must have no access to their answer keys. Holdout scenarios should be introduced separately from development examples.

### 6.3 Input validation

Implement deterministic checks for:

- Missing or duplicate records.
- Invalid identifiers.
- Inconsistent valuation dates.
- Weights that do not reconcile.
- Missing look-through coverage.
- Unit and percentage ambiguity.
- Reporting-period mismatches.
- Missing policy applicability.
- Invalid or inconsistent financial values.

These checks establish whether information is safe to analyse.

They do not constitute the complete investigative workflow.

## 7. Agent Architecture

### 7.1 Initial design

Start with **one Muse Spark investigation agent**, not multiple specialist agents.

The agent operates within a bounded execution loop managed by the TypeScript backend.

Its context includes the review objective, available sources, relevant governance policy information and tool descriptions.

It does not need to load every source document into its prompt.

Data should be retrieved selectively as the investigation develops.

### 7.2 Proposed tool capabilities

**Data discovery**

- `list_sources`: List available source datasets and documents.
- `describe_source`: Retrieve schema, provenance, reporting period and field definitions.
- `sample_rows`: Inspect a bounded sample of structured information.
- `query_data`: Retrieve bounded, validated selections of domain data.
- `get_policy`: Retrieve an applicable governance policy and effective date.
- `get_previous_actions`: Retrieve earlier decisions and follow-up actions supplied as part of the review.

**Analysis**

- `execute_python`: Execute agent-generated Python through Monty.
- `run_validated_check`: Invoke a deterministic, tested financial or data-quality calculation.
- `get_execution_result`: Retrieve an earlier execution result and its provenance.

**Investigation management**

- `record_observation`: Preserve an intermediate finding or uncertainty.
- `propose_finding`: Create a structured candidate finding.
- `request_missing_information`: Mark a specific investigation as blocked by unavailable evidence.

**Cairn integration**

- `start_review_record`: Initiate or locate a Cairn review record.
- `submit_evidence`: Submit authorised candidate evidence via Cairn.
- `get_reviewed_evidence`: Retrieve authoritative accepted-evidence information through a verified integration mechanism.

These are proposed tools belonging to the vertical application. They are **not claims that Cairn currently exposes matching MCP tools**.

### 7.3 Agent behaviour

The agent should:

- Explore relevant data rather than assuming known problems.
- Test hypotheses with executable analysis.
- Compare information against the correct policy version.
- Explain why something is or is not material.
- Investigate contradictory evidence.
- Identify when a result depends on uncertain assumptions.
- Preserve the methods used to derive conclusions.
- Avoid inventing absent values or unsupported explanations.
- Stop when sufficient review coverage has been achieved or resources are exhausted.

The agent must not make consequential changes directly to investment data or Cairn evidence records.

### 7.4 Execution limits

Each analysis run must have configurable budgets for:

- Model calls and tokens.
- Total duration.
- Tool invocations.
- Sandbox executions.
- Rows and bytes returned by data tools.
- Analysis retries.
- Total estimated API cost.

The agent should finish with a clear status: completed, completed with uncertainties, blocked, failed or budget-exhausted.

Budget exhaustion must not be misrepresented as completion.

## 8. Sandboxed Python with Monty

### 8.1 Purpose

Use `@pydantic/monty` from the TypeScript backend to execute agent-generated Python.

Monty is the preferred exploratory calculation engine because it supports controlled Python execution without giving generated code unrestricted access to the host environment.

### 8.2 Execution contract

Each execution receives:

- The generated Python source.
- Explicitly permitted input data or references.
- A bounded set of read-only host functions.
- Execution resource limits.
- An execution identifier and correlation context.

The result records:

- Source code.
- Input identities and hashes.
- Returned values.
- Standard output where relevant.
- Errors and execution limits.
- Start/end timestamps and duration.
- Runtime and dependency versions.

### 8.3 Security boundaries

The sandbox must not receive application credentials, unrestricted database access, arbitrary network access or uncontrolled filesystem access.

Host functions must validate every request and enforce explicit scope and limits.

Set memory and execution-time limits.

Treat model-generated code as untrusted, even though Monty is designed for this use case. Monty's security boundary is language-level isolation, not a substitute for every layer of production infrastructure security.

### 8.4 Numerical correctness

For critical financial metrics:

- Define units and rounding explicitly.
- Prefer decimal or fixed-precision calculations where appropriate.
- Avoid relying on model-generated mental arithmetic.
- Independently validate important outputs using trusted calculations.
- Preserve calculation methodology.
- Flag missing or incompatible input data.

A calculation can be computationally correct while applying the wrong investment policy or methodology. Those cases must remain reviewable.

### 8.5 Limitations

Monty is not full CPython and does not provide arbitrary third-party libraries such as Pandas and NumPy.

For the MVP, use native structures and supported built-in modules for modest datasets.

Larger-scale data processing, advanced statistical analysis or specialist financial calculations may later use a dedicated Python service.

Do not add that infrastructure until required.

## 9. Technology and Deployment

### 9.1 Preferred stack

| Component | Proposed technology |
|---|---|
| Web frontend | React / TypeScript |
| Application API | Node.js / TypeScript |
| Agent orchestration | TypeScript with Meta Model API |
| Reasoning model | Muse Spark, initially `muse-spark-1.3` |
| Sandboxed computation | `@pydantic/monty` |
| Operational database | Supabase PostgreSQL |
| File storage | Supabase Storage or equivalent |
| Server hosting | Node-compatible managed service, initially DigitalOcean |
| Frontend hosting | Same application deployment or Cloudflare |
| Evidence and records | Existing Cairn via HTTP/MCP |
| Observability | OpenTelemetry traces and structured logs |

Use the simplest viable runtime. Monty's native Node integration requires worker subprocesses, so don't assume it can execute directly in a serverless runtime that does not support them.

Start with one backend deployment where possible. Introduce a dedicated execution worker if reliability or workload isolation requires one.

### 9.2 Repository boundary

Create a standalone public repository containing the vertical application's new source code, synthetic data generator, evaluation harness, tests, documentation and demo instructions.

Keep Cairn's existing proprietary implementation in its separate repository.

The application must communicate with Cairn exclusively through authorised external interfaces.

Existing Cairn functionality must be clearly distinguished from functionality created during the hackathon.

### 9.3 Suggested structure

- `apps/web` — React frontend.
- `apps/server` — TypeScript API, orchestration and application services.
- `packages/domain` — shared types and domain rules.
- `packages/analysis` — Monty adapter and deterministic calculations.
- `packages/cairn-client` — Cairn integration adapter.
- `packages/evaluation` — blind test harness and scoring.
- `fixtures` — synthetic source-data generation and scenarios.
- `docs` — architecture, investigation contracts and demo guidance.

This is a proposed structure, not a requirement to create every package on day one.

## 10. Application Data Model

The vertical owns operational data; Cairn owns the accepted process evidence.

The initial conceptual entities are:

| Entity | Responsibility |
|---|---|
| `Review` | Reporting period, status, review scope and Cairn correlation |
| `SourceDocument` | File metadata, source version, hash, origin and reporting period |
| `Portfolio` | Domain portfolio identity and descriptive information |
| `Position` | Instrument holding, value, weight and valuation information |
| `InstrumentExposure` | Underlying exposures and their effective dates |
| `GovernancePolicy` | Extracted applicable limits and policy provenance |
| `AnalysisRun` | Model, prompt version, configuration, state and budget |
| `Investigation` | Hypothesis, supporting observations and analysis trail |
| `CodeExecution` | Generated code, inputs, outputs, errors and runtime metadata |
| `Finding` | Proposed issue, materiality, evidence and uncertainty |
| `CairnSubmission` | Candidate ID, proposed destination and submission status |
| `ReviewedSnapshot` | Fixed set of authoritatively accepted evidence and source versions |
| `CommitteePack` | Generated output, version, snapshot reference and hashes |

Exact database schemas should be derived from implementation requirements.

Preserve stable identifiers throughout the investigation and publishing lifecycle.

Avoid making Cairn a duplicate store for all operational portfolio rows.

## 11. Cairn Integration

### 11.1 Existing capabilities to reuse

The existing candidate-intake contract documents the following operations:

- Finding subjects and startable procedures.
- Starting records under an authorised agent identity.
- Finding compatible, placeable records and steps.
- Submitting assertions and links through HTTP/MCP.
- Uploading file candidates through HTTP.
- Proposing a target step and evidence slot.
- Human acceptance of candidates in the Cairn application.
- Attribution of the originating agent and accepting human.

Use Cairn's published contract rather than inventing new API shapes.

For example, the existing surfaces include:

- `POST /api/intake/v1/records`
- `GET /api/intake/v1/records/{cairnReference}/steps`
- `POST /api/intake/v1/candidates`
- `POST /api/intake/v1/candidates/assertion`
- MCP tool `start_record`
- MCP tool `submit_candidate`

File upload uses the HTTP endpoint, not the MCP tool.

An agent's proposed step placement is not accepted evidence. It remains a candidate until a human files it.

### 11.2 Required Cairn setup

Create an appropriate subject, such as the fictional firm's investment governance programme.

Create and publish a procedure covering the periodic committee preparation cycle.

Suggested steps:

1. Source data and reconciliation.
2. Portfolio allocation and risk review.
3. Fund, manager and fee oversight.
4. Historical decisions and outstanding actions.
5. Committee pack preparation.

Give the procedure suitable evidence slots for files and assertions.

Register a named IGI agent in Cairn, enable candidate intake and grant only the required lookup/start capabilities.

Link the agent to an authorised user where Cairn's record-start rules require it.

Use an agent key stored securely on the vertical backend.

### 11.3 Submission strategy

Submit findings as a combination of concise assertions and evidence files.

An evidence file may contain an investigation package: methodology, input references, executed code, outputs and calculation validation.

Use stable source references to correlate submissions with analysis runs.

Cairn's intake does not guarantee idempotent candidate submission. The vertical must maintain its own submission ledger and reconcile uncertain outcomes rather than blindly retrying.

Similarly, record-start retries must respect Cairn's documented conditional repeat behaviour.

### 11.4 Authoritative evidence read-back — integration gate

**This is the primary unverified integration requirement.**

Before implementing committee-pack publishing:

1. Inspect Cairn's current authenticated application API, read models and MCP interface.
2. Verify whether an independently deployed vertical can legitimately retrieve accepted evidence and its provenance.
3. Establish how the vertical authenticates for this operation and which Cairn user's permissions apply.
4. Confirm that pending, discarded and accepted candidates can be distinguished reliably.
5. Confirm that evidence changes and historical versions can be detected.

The currently documented external agent-key intake surface provides limited lookup information, not a general accepted-evidence read API.

Do not assume that the normal Cairn UI's richer endpoints are approved for external integration.

If a suitable read operation is unavailable, propose the smallest authorised integration or a controlled human-generated export as a fallback. Do not bypass Cairn authorisation or directly query its database.

**Final committee-pack publication must not claim authoritative human sign-off unless the accepted evidence state has actually been verified.**

Any required Cairn core extension must be separately scoped and assessed against the hackathon's public-code and new-work rules.

## 12. Review and Publishing Semantics

### 12.1 Evidence acceptance versus conclusion approval

The system maintains a distinction between:

- Candidate evidence submitted by an agent.
- Evidence accepted by an authorised human.
- Findings supported by that evidence.
- Findings expressly endorsed by decision-makers.
- Committee decisions.

Cairn's existing acceptance mechanism must not be presented as approval of an investment recommendation.

### 12.2 Reviewed snapshot

The vertical creates a `ReviewedSnapshot` identifying:

- Cairn record and evidence references.
- Accepted evidence versions or event positions.
- Source document hashes.
- Relevant policy versions.
- Investigation and execution references.
- Snapshot generation time.

The snapshot is immutable.

If acceptance state or authoritative evidence subsequently changes, the existing pack is not silently rewritten. A new pack version must be generated or the old one clearly marked superseded.

### 12.3 Committee pack content

Produce an HTML/PDF pre-meeting pack containing:

**Executive overview**

- Review period and portfolios covered.
- Data coverage and validation status.
- Number and type of proposed exceptions.
- Areas requiring committee attention.

**Portfolio overview**

- Relevant portfolio and allocation figures.
- Changes between periods.
- Charts derived from reviewed information.

**Material findings**

- Description of the potential issue.
- Applicable governance policy.
- Supporting calculations and comparisons.
- Explanation and uncertainties.
- Evidence references.
- Proposed points for committee discussion.

**Outstanding governance items**

- Missing data or unresolved investigations.
- Previous committee actions still open.
- Matters requiring human judgement.

**Appendix**

- Data source register.
- Analysis methods.
- Calculation and investigation references.
- Accepted evidence manifest.
- Generation/version information.

Do not automatically invent investment recommendations, market commentary or committee decisions.

The pack should be useful even if it contains no exceptions: clean results and validated coverage are valid outcomes.

## 13. User Interface

IGI's interface should be visually polished but narrowly scoped.

### 13.1 Review dashboard

Displays available reviews, reporting periods, analysis status, findings and committee-pack versions.

### 13.2 Source workspace

Allows file upload and shows data source metadata, validation issues and reporting dates.

### 13.3 Investigation workspace

This is the application's distinctive interface.

Show a chronological investigation trace, including:

- Questions the agent chose to investigate.
- Data and tools accessed.
- Python generated.
- Execution results.
- Follow-up investigations.
- Proposed findings and unresolved questions.

Show observable actions and recorded analytical artifacts, not claims about inaccessible private model reasoning.

Make the exploration comprehensible without requiring the user to read every line of code.

### 13.4 Findings workspace

Shows each proposed finding, classification, numerical evidence, supporting references and current submission status.

Link to the relevant Cairn record for human evidence acceptance.

Do not duplicate Cairn's acceptance controls.

### 13.5 Committee pack workspace

Displays the accepted evidence snapshot, report preview, PDF export and pack history.

Publishing controls must respect the authoritative review-state checks.

## 14. Evaluation and Testing

### 14.1 Purpose

Demonstrate that the agent can investigate unfamiliar data rather than follow a hard-coded sequence of expected anomalies.

### 14.2 Evaluation approach

Maintain an independent answer key for each test scenario.

Measure:

- True material issues discovered.
- Material issues missed.
- Incorrect or unsupported findings.
- Correct identification of benign anomalies.
- Evidence citation accuracy.
- Numerical correctness.
- Reproducibility of calculations.
- Model/tool cost and execution time.
- Ability to recognise missing information.

Run evaluations repeatedly, recording the model and prompt versions, with more than one synthetic scenario.

### 14.3 Initial success targets

Proposed MVP targets:

- Detect at least 80% of known material test exceptions across the primary blind fixture.
- Produce no unsupported confirmed breach assertions.
- Provide traceable source evidence for every material finding.
- Independently validate all material numerical outputs.
- Correctly identify at least one deliberately misleading, non-breaching anomaly.
- Complete an analysis without receiving the hidden answer key.
- Preserve code and inputs required to reproduce significant calculations.

These are development targets, not claims about production reliability.

### 14.4 Automated tests

Include tests for:

- Source parsing and schema validation.
- Financial calculations and decimal handling.
- Incorrect dates, units and missing values.
- Monty resource limits and restricted host functions.
- Tool input validation and access boundaries.
- Agent response parsing and error recovery.
- Duplicate and uncertain Cairn submissions.
- Record-start retry behaviour.
- Evidence acceptance and rejection handling.
- Snapshot versioning and invalidation.
- Pack generation from accepted-only evidence.
- Missing or unavailable Cairn read-back.
- End-to-end execution using synthetic data.

Treat source document text as untrusted data. Test prompt-injection attempts embedded in documents and spreadsheet cells.

## 15. Security and Operational Requirements

For the hackathon, use entirely synthetic data.

Keep credentials and model API keys server-side.

The vertical must not give Monty or Spark unrestricted credentials to Supabase or Cairn.

Agent-accessible tools should be allowlisted, scoped and read-only unless a specific write operation is required.

Apply tenant and review boundaries to all data access even if the initial demo has one fictional customer.

Persist execution logs and source hashes, but avoid logging secrets or unnecessary document content.

Instrument the workflow with OpenTelemetry where practical, using correlation identifiers across model calls, data operations, code execution and Cairn submission.

Do not expose raw chain-of-thought or claim that the visible investigation trace is the model's complete internal reasoning.

A production version will need further consideration of client-data handling, model-provider contracts, retention, security review, regulatory responsibility and incident response. Those concerns must not be represented as already solved by the prototype.

## 16. Development Plan

**Day 1 — Architecture and feasibility**

- Create the public repository.
- Verify Meta Model API tool calling from TypeScript.
- Verify native Monty execution and deployment requirements.
- Inspect Cairn's existing intake and authorised read contracts.
- Create the simplest vertical-to-Cairn integration test.

**Day 2 — Synthetic data and evaluation**

- Create the fictional firm and portfolio fixtures.
- Implement data parsing and validation.
- Create the independent anomaly answer key and evaluator.

**Days 3–4 — Autonomous investigation**

- Build the Spark tool loop.
- Implement Monty execution and safe data access.
- Persist investigations and execution artifacts.
- Evaluate discovery on the synthetic scenarios.

**Days 5–6 — Cairn integration**

- Configure the governance subject and procedure.
- Initiate records and submit candidate evidence.
- Verify placement, attribution and human acceptance.
- Resolve the authoritative read-back route.

**Day 7 — Committee pack**

- Build accepted evidence snapshots.
- Generate the pre-meeting report and charts.
- Submit the pack back to Cairn where appropriate.

**Day 8 — Evaluation and reliability**

- Run blind evaluation variants.
- Fix missed exceptions and false positives.
- Test failure handling, retries and reproducibility.

**Day 9 — Demonstration and submission**

- Finalise the UI, README and architecture documentation.
- Record the required three-minute video.
- Verify the public repository and deployed demo.
- Submit before 4 November 2026, 9:00 pm US Eastern Time.

Start with a vertical slice that proves Spark can investigate, Monty can execute and Cairn can receive evidence. Do not defer that integration until the final days.

## 17. Three-Minute Hackathon Demo

The video should communicate the product's value and the novel capability clearly.

**0:00–0:20 — The problem**

Introduce a fictional investment manager preparing its monthly committee meeting. Explain the fragmented information and manual analytical effort.

**0:20–0:40 — The input**

Show the supplied portfolio data, policies and prior committee information. Emphasise that the agent has not been told what issues exist.

**0:40–1:35 — Autonomous investigation**

Start Spark. Show meaningful tool use, generated Python, Monty execution and the discovery of a non-obvious exception.

Include a follow-up investigation rather than merely displaying a single predefined calculation.

**1:35–2:05 — Evidence and human review**

Show the investigation package submitted to a Cairn record and a human accepting the candidate evidence.

Explain the distinction between an agent producing evidence and a human accepting it.

**2:05–2:35 — Finished committee pack**

Show the report produced from the accepted evidence snapshot, including the material finding, references, calculations and outstanding questions.

**2:35–3:00 — Technical and commercial significance**

Show the architectural separation: Meta for intelligence, Monty for executable investigation and Cairn for accountability.

Explain that the specialist application was developed independently on an existing evidence platform and illustrates a repeatable FDE delivery model.

If the read-back integration remains unresolved, the demo must not fake the accepted-evidence publishing step. Demonstrate only what actually works.

## 18. Definition of Done

The hackathon MVP is complete when:

- [ ] A review can be created using a realistic synthetic investment dataset.
- [ ] Spark independently investigates data without access to expected findings.
- [ ] Spark generates and executes useful analytical Python through Monty.
- [ ] The application records code, inputs, outputs and source provenance.
- [ ] It identifies meaningful exceptions and handles at least one false alarm.
- [ ] Findings are linked to independently verifiable evidence.
- [ ] The agent can initiate a Cairn record and submit evidence to appropriate steps.
- [ ] An authorised person can review and accept submitted evidence in Cairn.
- [ ] The vertical can verify which evidence was accepted before publication.
- [ ] A committee pack is generated from a fixed accepted-evidence snapshot.
- [ ] The evaluation suite measures discovery quality and numerical correctness.
- [ ] The new vertical source is publicly available.
- [ ] The three-minute demonstration accurately represents working functionality.

Where a required integration is not available, document that limitation and distinguish completed functionality from future work.

## 19. Post-Hackathon Direction

This application is intended to serve as Cairn River's first demonstrable FDE-style solution, not necessarily its first commercial product.

After the event, assess:

- Whether small DFMs recognise the problem and its cost.
- Whether the application meaningfully reduces analyst preparation time.
- What integrations real firms would require.
- Whether Cairn's current APIs and evidence model are sufficient.
- Which additional platform capabilities would be reusable across other customer engagements.
- Whether the solution should become a packaged product or remain a client-specific offering.

Do not expand Cairn simply to satisfy a hypothetical future requirement.

The longer-term objective is to improve the platform through real customer needs while retaining flexibility to deploy specialised solutions within either Cairn River's infrastructure or a customer's environment.

## 20. Engineering Guidance

This specification defines product intent, system boundaries and expected outcomes.

Before implementation, verify current code, API contracts, SDK versions and deployment capabilities.

In particular:

1. Inspect Cairn's actual intake, authentication, evidence and read-back behaviour.
2. Validate Monty's supported Python subset and execution limits with the installed version.
3. Validate Meta Model API's current tool-calling and structured-output interfaces.
4. Prefer tested financial calculations over assumptions generated by the model.
5. Start with one agent and one functioning end-to-end workflow.
6. Implement no speculative Cairn platform changes.
7. Make all newly built, demonstrated functionality identifiable in the public repository, consistent with the hackathon rules.

### Key references

- [Cairn Candidate Intake Reference](https://github.com/spenceclark/Cairn/blob/main/docs/candidate-intake.md)
- [Cairn Product Direction and Guardrails](https://github.com/spenceclark/Cairn/blob/main/docs/product-guardrails.md)
- [Meta Model API documentation](https://dev.meta.ai/docs/overview)
- [Monty JavaScript Quickstart](https://pydantic.dev/docs/monty/quickstart/javascript/)
- [Monty Security Model](https://pydantic.dev/docs/monty/concepts/security/)
- [Monty Limitations](https://pydantic.dev/docs/monty/limitations/)

---

**Fundamental product principle**

*The application does not know the answer before beginning an investigation. It supplies an intelligent agent with trustworthy data, controlled analytical capabilities and a clear objective. The agent discovers and substantiates findings. Cairn ensures the resulting work is subject to human accountability.*

**Fundamental business principle**

*The vertical demonstrates the capability of Cairn River to deliver a specialised AI solution rapidly by building on an existing, reusable platform — without forcing industry-specific complexity into that platform.*