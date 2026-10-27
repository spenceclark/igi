# Rules

While you may have access to "Cairn" code via the environment, do not make any changes to Cairn via this session. Only edit code under IGI folder.

- `docs/spec.md` is the specification. Revise it in place; don't append contradictory notes.
- `docs/progress.md` is the progress log. Append note as things are completed. Record issues found and resolved.
- This repository is public. `docs/private/` is gitignored and holds notes on Cairn internals: never copy its content into tracked files, and never link to the private Cairn repository from public docs.
- `server/` is the Node/TypeScript backend. Node 24+ runs `.ts` files directly, so use erasable TypeScript syntax only (no `enum`, no parameter properties). In `server/`: `npm run smoke:monty` checks the Monty sandbox (spec §9); `npm run probe:meta` calls the Meta Model API.
- Secrets live only in the environment or `server/.env` (gitignored): the Meta key `MODEL_API_KEY`, and later the Cairn agent key, the database connection and the Spaces keys. Never read, print or commit them. IGI's database and bucket are its own; never connect to Cairn's database or storage.
- In `server/`: `npm test` runs the unit tests; `npm run investigate -- ../fixtures/scenarios/dev-01` runs a Spark investigation (costs about $0.20), writing its trace to `server/runs/` (gitignored). From the root: `node fixtures/generate.ts` regenerates the scenarios and answer keys; `node eval/verify-checks.ts` cross-checks the trusted checks against the generator.
- Evaluation isolation (spec §15.2): `server/` never imports from `eval/` or `fixtures/generate.ts`, and prompts, tool descriptions and data descriptions never name expected findings. Development scenarios may be used for tuning; holdout scenarios are written after the freeze.
