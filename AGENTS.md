# Agent Instructions

## Terminal Usage

CodeArts Agent may run terminal commands directly, but only one native command
per tool call. This avoids a known Windows hang in the Bash wrapper.

Preferred validation commands:

- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/eslint/bin/eslint.js .`
- `node node_modules/vitest/vitest.mjs run`
- `git status`
- `git diff`
- `git add`
- `git commit`
- `git push`

Do not use:

- `cmd.exe`, `powershell`, `bash -c`, or another shell wrapper.
- Pipes such as `|`, `tail`, or `tee`.
- Redirection such as `>`, `>>`, or `<`.
- Command chaining with `;`, `&&`, or `||`.
- `npm`, `pnpm`, `npx`, or `yarn` wrappers for validation. Run the direct Node
  entry points instead.
- `npm install`, `npm ci`, `pnpm install`, watch mode, dev servers, or
  background processes.

Run validation commands one at a time with a 120-second timeout. If one direct
command does not finish within 120 seconds, stop and report the failure.

After finishing code changes:

1. Run the relevant validation commands directly.
2. Fix failures within the current stage only.
3. Commit and push only when explicitly requested.
4. Report files changed, validation results, and remaining risks.

## Scope

Work only on the explicitly requested stage. Do not continue into later stages.
Do not modify unrelated files or revert existing user changes.

## TypeScript Runtime

The `cloud-demo/` package runs TypeScript directly with Node's type stripping.
Do not use TypeScript features that require code generation:

- Do not use constructor parameter properties.
- Do not use `enum`.
- Add explicit types to callback parameters when contextual typing is unclear.
