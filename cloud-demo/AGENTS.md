# cloud-demo Agent Instructions

This package is an isolated Fastify service that runs TypeScript directly with
Node's type stripping.

## Rules

- Run terminal commands directly, one native command per tool call.
- Do not use `cmd.exe`, `powershell`, `bash -c`, pipes, redirection, `tail`,
  `tee`, `;`, `&&`, or `||`.
- Do not run `npm install`, `npm ci`, watch mode, dev servers, or background
  processes.
- Validation commands are:
  - `node node_modules/typescript/bin/tsc --noEmit`
  - `node node_modules/eslint/bin/eslint.js .`
  - `node node_modules/vitest/vitest.mjs run`
- Do not use `npm` or `pnpm` for validation. Run the direct Node entry points.
- Run each validation command separately with a 120-second timeout.
- Do not commit or push unless explicitly requested.
- Edit only files required by the current stage.
- Fix failures only within the current stage.

## TypeScript Constraints

- Do not use constructor parameter properties.
- Do not use `enum`.
- Annotate callback parameters explicitly when TypeScript cannot infer them.
- Keep runtime dependencies limited to Fastify, PostgreSQL, Redis, CORS, and Zod
  unless the user explicitly approves another dependency.

## Architecture

- Keep the cloud service isolated from the browser extension build.
- RDS is the durable translation-memory store.
- Redis is the hot cache.
- The default upstream is the deterministic mock provider.
- Never commit credentials or environment files.
