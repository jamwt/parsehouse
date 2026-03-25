# AGENTS.md

## Purpose

This repository contains `parsehouse`, a pure TypeScript ClickHouse-oriented SQL parser with:
- a typed AST
- AST traversal helpers
- canonical SQL serialization

Treat this as a library project, not an application or service.

## Repository Shape

Core tracked files:
- `src/ast.ts` - AST node types and unions
- `src/dialect.ts` - dialect abstraction and default ClickHouse dialect
- `src/tokenizer.ts` - lexer/tokenization
- `src/parser.ts` - hand-written parser
- `src/serializer.ts` - canonical SQL serializer
- `src/visitor.ts` - AST walker
- `src/index.ts` - public exports
- `tests/*.test.ts` - Vitest coverage
- `README.md` - user-facing API and examples

Do not treat these as normal edit targets:
- `dist/` - build output
- `external/` - untracked upstream/reference material
- `node_modules/` - installed dependencies

## Environment And Commands

Use npm in this repo.

Common commands:
- `npm run check` - type-check with `tsc --noEmit`
- `npm test` - run Vitest once
- `npm run test:watch` - run Vitest in watch mode
- `npm run build` - build package with `tsup`

Before finishing a non-trivial change, prefer to run:
1. `npm run check`
2. `npm test`
3. `npm run build`

## Architecture Notes

The normal data flow is:
1. `tokenize(sql)`
2. parser builds typed AST nodes
3. callers inspect or mutate AST
4. `toSql()` serializes back to canonical SQL

Important behavior:
- default parsing dialect is ClickHouse
- serializer normalizes output rather than preserving original formatting
- comments are discarded during tokenization/serialization
- some unsupported syntax is preserved as `raw_statement`, `raw_expr`, or `raw_alter_operation` instead of being fully typed

When changing parser behavior, check whether serializer and visitor behavior also need updates.

## Editing Guidance

When making changes:
- prefer minimal, surgical edits
- preserve the current TypeScript style: double quotes, semicolons, trailing commas
- keep the public API in `src/index.ts` intentional
- do not hand-edit `dist/`
- do not rely on `external/` as if it were production code in this package

If you add a new AST node or clause:
1. define/update types in `src/ast.ts`
2. parse it in `src/parser.ts`
3. serialize it in `src/serializer.ts`
4. traverse it in `src/visitor.ts` if relevant
5. export it through `src/index.ts` if it is public
6. add tests

## Testing Expectations

Favor round-trip tests:
- parse SQL
- assert AST shape where important
- serialize with `toSql()`
- assert canonical output

Existing suites cover:
- basic parser behavior
- ClickHouse feature coverage
- upstream parity cases
- a large generated query corpus

Add or update tests in the nearest existing file unless a new suite is clearly justified.

## Scope And Non-Goals

This project is ClickHouse-focused.
Do not assume source-faithful formatting is required.
Do not add business-rule validation unless explicitly requested; this library is primarily a syntax parser and AST toolkit.

## Safe Defaults For Agents

If a request is ambiguous, prefer:
- ClickHouse behavior over generic SQL behavior
- canonical serialization over formatting preservation
- extending typed AST support when practical
- raw-node fallback when full support would be risky or too large for the change

Avoid broad refactors unless they are necessary for correctness or requested explicitly.
