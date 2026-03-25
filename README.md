# parsehouse

Pure TypeScript ClickHouse-oriented SQL parser with a typed AST, visitor utilities, and canonical SQL serialization.

This project is being built against `apache/datafusion-sqlparser-rs` as the behavioral reference, while exposing a more TypeScript-native API.

## Status

- Early foundation in place
- ClickHouse-first parser surface started
- `FINAL` support included for `FROM table FINAL` and `OPTIMIZE TABLE ... FINAL`
- Build, typecheck, and initial Vitest coverage are wired up

## Install

```bash
npm install parsehouse
```

## Usage

```ts
import {
  ClickHouseDialect,
  parseExpr,
  parseStatement,
  parseSql,
  toSql,
  visit,
} from "parsehouse";

const dialect = new ClickHouseDialect();

const statement = parseStatement(
  "SELECT * FROM events FINAL PREWHERE team_id = 1 LIMIT 1 BY user_id",
  { dialect },
);

visit(statement, {
  enter(node) {
    if (node.kind === "identifier_expr") {
      // inspect identifiers
    }
  },
});

console.log(toSql(statement));

const expression = parseExpr("HISTOGRAM(0.5, 0.6)(x, y)", { dialect });
console.log(toSql(expression));

const statements = parseSql("USE default; SELECT ['a', 'b'] FROM t FINAL", { dialect });
```

## Current API

- `parseSql(sql, options?)`
- `parseStatement(sql, options?)`
- `parseExpr(sql, options?)`
- `tokenize(sql)`
- `toSql(node)`
- `visit(node, visitor)`

## Roadmap

- Expand ClickHouse syntax coverage to match the upstream suite
- Port the upstream ClickHouse tests to Vitest
- Flesh out statement coverage across the common suite
- Add richer formatting and transformation helpers

## License

Apache-2.0
