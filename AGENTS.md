# Agent Instructions

## Terminal Usage

Do not run terminal commands for this repository. CodeArts Agent's Bash tool can
hang indefinitely on Windows when commands use pipes, package scripts, or watchers.

Use file inspection and editing tools only:

- Read files.
- Search files.
- Create or edit files.
- Return the exact commands the user should run for validation.

Do not run any of the following:

- `npm`, `pnpm`, `npx`, or `yarn` commands.
- `git` commands.
- Test, typecheck, lint, build, install, dev server, or watch commands.
- Commands containing `|`, `tail`, `tee`, `watch`, or a background process.

After finishing code changes, stop and report:

1. Files changed.
2. What was implemented.
3. Validation commands for the user to run.
4. Any remaining risks or decisions.

Do not commit or push. The user or coordinating agent handles validation and Git.

## Scope

Work only on the explicitly requested stage. Do not continue into later stages.
Do not modify unrelated files or revert existing user changes.

## TypeScript Runtime

The `cloud-demo/` package runs TypeScript directly with Node's type stripping.
Do not use TypeScript features that require code generation:

- Do not use constructor parameter properties.
- Do not use `enum`.
- Add explicit types to callback parameters when contextual typing is unclear.
