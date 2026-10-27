TO BE POPULATED AT FIRST PASS AND KEPT UP TO DATE

While you may have access to "Cairn" code via the environment, do not make any changes to Cairn via this session. Only edit code under IGI folder.

- `docs/spec.md` is the specification. Revise it in place; don't append contradictory notes.
- This repository is public. `docs/private/` is gitignored and holds notes on Cairn internals: never copy its content into tracked files, and never link to the private Cairn repository from public docs.
- `server/` is the Node/TypeScript backend. Node 24+ runs `.ts` files directly, so use erasable TypeScript syntax only (no `enum`, no parameter properties). In `server/`: `npm run smoke:monty` checks the Monty sandbox (spec §9); `npm run probe:meta` calls the Meta Model API.
- The Meta key is `MODEL_API_KEY`, in the environment or `server/.env` (gitignored). Never read, print or commit it.
