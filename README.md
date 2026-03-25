# parsehouse

[![CI](https://github.com/jamwt/parsehouse/actions/workflows/ci.yml/badge.svg)](https://github.com/jamwt/parsehouse/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/parsehouse.svg)](https://www.npmjs.com/package/parsehouse)
[![npm downloads](https://img.shields.io/npm/dm/parsehouse.svg)](https://www.npmjs.com/package/parsehouse)

Pure TypeScript ClickHouse SQL parser with a typed AST, tree traversal helpers, and canonical SQL serialization.

`parsehouse` is built for tools that need to parse SQL, inspect it, validate it, modify it, and turn it back into normalized SQL.

## What it does

- Parse ClickHouse SQL into a typed AST
- Traverse the AST with discriminated unions and `kind` checks
- Modify statements and expressions in memory
- Serialize AST nodes back to canonical SQL with `toSql()`
- Drop comments and normalize whitespace during serialization

## Install

```bash
npm install parsehouse
```

## Quick Start

```ts
import {
  ClickHouseDialect,
  parseStatement,
  toSql,
} from "parsehouse";

const dialect = new ClickHouseDialect();

const statement = parseStatement(
  "SELECT user_id FROM events FINAL PREWHERE team_id = 1 LIMIT 10",
  { dialect },
);

if (statement.kind === "select_statement") {
  const source = statement.from?.[0];

  if (source?.kind === "table_reference" && source.final) {
    console.log("query uses FINAL");
  }

  statement.limit = {
    kind: "limit_clause",
    limit: { kind: "literal", literalType: "number", value: 100 },
  };
}

console.log(toSql(statement));
// SELECT user_id FROM events FINAL PREWHERE team_id = 1 LIMIT 100
```

## Basic API

```ts
import {
  ClickHouseDialect,
  parseExpr,
  parseSql,
  parseStatement,
  toSql,
  tokenize,
  visit,
} from "parsehouse";
```

- `parseStatement(sql, options?)` parses one statement and throws if the input contains more than one
- `parseSql(sql, options?)` parses one or more semicolon-separated statements
- `parseExpr(sql, options?)` parses a standalone expression
- `tokenize(sql)` returns lexer tokens
- `toSql(node)` serializes a statement or expression back to canonical SQL
- `visit(node, visitor)` walks the tree for analysis or collection
- `ClickHouseDialect` enables ClickHouse-specific syntax such as `FINAL`, `PREWHERE`, `LIMIT BY`, `SETTINGS`, and projection operations

## Typical Workflow

### 1. Parse

```ts
import { ClickHouseDialect, parseStatement } from "parsehouse";

const stmt = parseStatement(
  "SELECT * FROM metrics FINAL PREWHERE team_id = 42 WHERE ts >= now() - INTERVAL 1 HOUR",
  { dialect: new ClickHouseDialect() },
);
```

### 2. Inspect

```ts
if (stmt.kind === "select_statement") {
  console.log(stmt.prewhere);
  console.log(stmt.where);
  console.log(stmt.settings);
}
```

### 3. Validate

```ts
if (stmt.kind === "select_statement") {
  const source = stmt.from?.[0];

  if (source?.kind === "table_reference" && source.final) {
    throw new Error("FINAL is not allowed for user-facing queries");
  }

  if (!stmt.limit) {
    throw new Error("Queries must include LIMIT");
  }
}
```

### 4. Modify

```ts
if (stmt.kind === "select_statement") {
  stmt.limit = {
    kind: "limit_clause",
    limit: { kind: "literal", literalType: "number", value: 500 },
  };
}
```

### 5. Serialize

```ts
import { toSql } from "parsehouse";

const sql = toSql(stmt);
```

## Subquery Example

Subqueries can appear both in `FROM (...)` and inside expressions.

### Subquery in `FROM`

```ts
import { ClickHouseDialect, parseStatement } from "parsehouse";

const stmt = parseStatement(
  `
  SELECT user_id, cnt
  FROM (
    SELECT user_id, count() AS cnt
    FROM events
    GROUP BY user_id
  ) AS aggregated
  WHERE cnt > 10
  ORDER BY cnt DESC
  `,
  { dialect: new ClickHouseDialect() },
);

if (stmt.kind === "select_statement") {
  const source = stmt.from?.[0];

  if (source?.kind === "subquery_source" && source.query.kind === "select_statement") {
    console.log(source.query.projection);
    console.log(source.query.groupBy);
  }
}
```

### Scalar subquery in an expression

```ts
import { ClickHouseDialect, parseStatement } from "parsehouse";

const stmt = parseStatement(
  `
  SELECT
    user_id,
    (SELECT avg(score) FROM scores) AS average_score
  FROM users
  `,
  { dialect: new ClickHouseDialect() },
);

if (stmt.kind === "select_statement") {
  const firstItem = stmt.projection[1];

  if (firstItem?.kind === "expression_select_item" && firstItem.expression.kind === "subquery_expr") {
    console.log(firstItem.expression.query);
  }
}
```

## AST Overview

The AST is a set of discriminated unions keyed by `kind`.

### Statements

Top-level nodes are `Statement` values.

- `select_statement`
- `create_table_statement`
- `create_view_statement`
- `insert_statement`
- `alter_table_statement`
- `optimize_table_statement`
- `use_statement`
- `describe_statement`
- `explain_statement`
- `kill_statement`
- `raw_statement`

### Expressions

Expressions are `Expr` values.

- `identifier_expr`
- `literal`
- `binary_expr`
- `unary_expr`
- `function_call_expr`
- `subscript_expr`
- `field_access_expr`
- `array_expr`
- `tuple_expr`
- `dictionary_expr`
- `subquery_expr`
- `interval_expr`
- `wildcard_expr`
- `raw_expr`

### Naming Nodes

- `identifier` represents a single identifier like `user_id`
- `object_name` represents dotted names like `db.events`

### Query Nodes

`select_statement` is the most important node for validation and rewriting.

Important fields:

- `projection`: selected expressions or wildcards
- `from`: table references, subqueries, or table functions
- `sample`: ClickHouse `SAMPLE` clause
- `prewhere`: ClickHouse `PREWHERE`
- `where`: regular filter
- `groupBy`: grouping expressions
- `having`: post-aggregation filter
- `orderBy`: `ORDER BY` items, including `WITH FILL`
- `interpolate`: ClickHouse `INTERPOLATE`
- `limit`: regular `LIMIT`, `LIMIT BY`, and `WITH TIES`
- `settings`: ClickHouse query settings
- `format`: output format identifier

Example:

```ts
if (stmt.kind === "select_statement") {
  console.log(stmt.projection);
  console.log(stmt.from);
  console.log(stmt.prewhere);
  console.log(stmt.limit);
}
```

### Table Sources

The `from` array contains `FromSource` nodes.

- `table_reference` for normal tables
- `function_table_source` for table functions like `numbers(10)` or `s3(...)`
- `subquery_source` for `FROM (...)`

`table_reference` includes ClickHouse `FINAL` directly:

```ts
if (stmt.kind === "select_statement") {
  const source = stmt.from?.[0];
  if (source?.kind === "table_reference") {
    console.log(source.name);
    console.log(source.final);
  }
}
```

### Function Calls

`function_call_expr` models both normal and ClickHouse parametric functions.

- `name`: function name as `object_name`
- `args`: normal call arguments
- `parameters`: parametric function parameters, if present
- `settings`: function-local `SETTINGS`, if present

Example:

```ts
import { ClickHouseDialect, parseExpr } from "parsehouse";

const expr = parseExpr("HISTOGRAM(0.5, 0.9)(value)", {
  dialect: new ClickHouseDialect(),
});

if (expr.kind === "function_call_expr") {
  console.log(expr.parameters);
  console.log(expr.args);
}
```

### DDL Nodes

`create_table_statement` includes the main ClickHouse table-shape pieces:

- `name`
- `columns`
- `engine`
- `primaryKey`
- `orderBy`
- `asSelect`

Each `column_definition` contains:

- `name`
- `dataType`
- `options`

`data_type` captures nested type structures such as `Nullable(String)`, `Map(String, UInt64)`, `Tuple(...)`, and `AggregateFunction(...)`.

### ALTER TABLE Operations

`alter_table_statement` contains typed operations in `operations`.

Supported ClickHouse-oriented operation nodes include:

- `attach_partition_operation`
- `detach_partition_operation`
- `add_projection_operation`
- `drop_projection_operation`
- `clear_projection_operation`
- `materialize_projection_operation`
- `freeze_partition_operation`
- `unfreeze_partition_operation`
- `raw_alter_operation` as a fallback for unsupported forms

Example:

```ts
import { ClickHouseDialect, parseStatement } from "parsehouse";

const stmt = parseStatement(
  "ALTER TABLE events ADD PROJECTION p0 (SELECT user_id, count() GROUP BY user_id)",
  { dialect: new ClickHouseDialect() },
);

if (stmt.kind === "alter_table_statement") {
  for (const op of stmt.operations) {
    console.log(op.kind);
  }
}
```

## Traversal

Use `visit()` to inspect the tree without writing your own walker.

```ts
import { visit } from "parsehouse";

const identifiers: string[] = [];
const functions: string[] = [];

visit(stmt, {
  enter(node) {
    if (node.kind === "identifier_expr") {
      identifiers.push(node.name.kind === "identifier" ? node.name.name : node.name.parts.map((part) => part.name).join("."));
    }

    if (node.kind === "function_call_expr") {
      functions.push(node.name.parts.map((part) => part.name).join("."));
    }
  },
});
```

## Validation Patterns

`parsehouse` is a syntax parser and AST toolkit. It does not try to enforce your business rules.

Typical validations you can build on top of the AST:

- require a tenant filter in `WHERE` or `PREWHERE`
- reject `FINAL` for latency-sensitive queries
- require `LIMIT` for interactive queries
- ban mutation statements like `ALTER TABLE ... UPDATE`
- restrict access to specific tables or databases
- validate allowed functions or settings

## Serialization Notes

- `toSql()` produces normalized SQL, not source-faithful SQL
- comments are dropped
- whitespace is normalized
- output may differ textually from the original even when the AST meaning is preserved

## Example: Validate, Rewrite, Serialize

```ts
import {
  ClickHouseDialect,
  parseStatement,
  toSql,
  visit,
} from "parsehouse";

const stmt = parseStatement(
  "SELECT user_id, count() FROM events FINAL WHERE ts >= now() - INTERVAL 1 DAY GROUP BY user_id",
  { dialect: new ClickHouseDialect() },
);

if (stmt.kind !== "select_statement") {
  throw new Error("expected SELECT");
}

const source = stmt.from?.[0];
if (source?.kind === "table_reference" && source.final) {
  source.final = false;
}

stmt.limit = {
  kind: "limit_clause",
  limit: { kind: "literal", literalType: "number", value: 100 },
};

const usedFunctions: string[] = [];
visit(stmt, {
  enter(node) {
    if (node.kind === "function_call_expr") {
      usedFunctions.push(node.name.parts.map((part) => part.name).join("."));
    }
  },
});

console.log(usedFunctions);
console.log(toSql(stmt));
```

## Current Coverage

- ClickHouse-focused parser surface
- typed AST for common statements, expressions, DDL, and major ClickHouse operations
- canonical serializer via `toSql()`
- explicit Vitest coverage for upstream ClickHouse cases and a generated 150-query real-world corpus

## Non-Goals

- preserving original comments
- preserving original whitespace
- full semantic validation against a running ClickHouse server
- exact source formatting round-trips

## License

Apache-2.0
