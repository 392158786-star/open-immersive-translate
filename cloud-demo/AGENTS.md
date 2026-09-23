# cloud-demo Agent Instructions

This package is an isolated Fastify service that runs TypeScript directly with
Node's type stripping.

## Rules

- Do not run terminal commands.
- Do not run `npm install`, tests, typecheck, lint, build, or watch commands.
- Do not commit or push.
- Edit only files required by the current stage.
- Report the validation commands for the user to run.

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
