import { describe, expect, test } from "vitest";

import {
  ClickHouseDialect,
  parseExpr,
  parseStatement,
  toSql,
  type AlterTableStatement,
  type CreateTableStatement,
  type Expr,
  type FunctionTableSource,
  type OptimizeTableStatement,
  type RawExpr,
  type SelectStatement,
} from "../src/index";

const dialect = new ClickHouseDialect();

function statement(sql: string) {
  return parseStatement(sql, { dialect });
}

function select(sql: string): SelectStatement {
  const stmt = statement(sql);
  expect(stmt.kind).toBe("select_statement");
  return stmt as SelectStatement;
}

function expression(sql: string): Expr {
  return parseExpr(sql, { dialect });
}

describe("ast shape", () => {
  describe("expressions and select tails", () => {
    test("ports parse_array_expr and test_dictionary_syntax", () => {
      const arrayExpr = expression("['1', '2']");
      expect(arrayExpr.kind).toBe("array_expr");
      if (arrayExpr.kind !== "array_expr") {
        throw new Error("expected array expr");
      }
      expect(arrayExpr.items).toHaveLength(2);
      expect(toSql(arrayExpr)).toBe("['1', '2']");

      const dictionaryExpr = expression("{'Alberta': 'Edmonton', 'Manitoba': 'Winnipeg'}");
      expect(dictionaryExpr.kind).toBe("dictionary_expr");
      if (dictionaryExpr.kind !== "dictionary_expr") {
        throw new Error("expected dictionary expr");
      }
      expect(dictionaryExpr.entries).toHaveLength(2);
      expect(dictionaryExpr.entries[0]?.key.kind).toBe("literal");
      expect(dictionaryExpr.entries[0]?.value.kind).toBe("literal");
      expect(toSql(dictionaryExpr)).toBe("{'Alberta': 'Edmonton', 'Manitoba': 'Winnipeg'}");
    });

    test("ports parse_settings_in_query", () => {
      const stmt = select(
        "SELECT * FROM t SETTINGS additional_result_filter = 'x != 2', query_plan_optimize_lazy_materialization = false",
      );

      expect(stmt.settings).toHaveLength(2);
      expect(stmt.settings?.[0]?.key.name).toBe("additional_result_filter");
      expect(stmt.settings?.[0]?.value && toSql(stmt.settings[0].value)).toBe("'x != 2'");
      expect(stmt.settings?.[1]?.key.name).toBe("query_plan_optimize_lazy_materialization");
      expect(stmt.settings?.[1]?.value && toSql(stmt.settings[1].value)).toBe("false");
    });

    test("ports parse_select_table_function_settings", () => {
      const stmt = select("SELECT * FROM table_function(arg, SETTINGS s0 = 3, s1 = 's')");

      expect(stmt.from).toHaveLength(1);
      const from = stmt.from?.[0] as FunctionTableSource;
      expect(from.kind).toBe("function_table_source");
      expect(from.function.args).toHaveLength(1);
      expect(from.function.settings).toHaveLength(2);
      expect(from.function.settings?.[0]?.key.name).toBe("s0");
      expect(from.function.settings?.[1]?.key.name).toBe("s1");
      expect(toSql(stmt)).toBe("SELECT * FROM table_function(arg, SETTINGS s0 = 3, s1 = 's')");
    });

    test("ports parse_limit_by and parse_offset_and_limit", () => {
      const limitBy = select(
        "SELECT * FROM default.last_asset_runs_mv ORDER BY created_at DESC LIMIT 1 BY asset, toStartOfDay(created_at)",
      );
      expect(limitBy.limit?.by).toBeTruthy();
      expect(limitBy.limit?.by?.by).toHaveLength(2);
      expect(limitBy.limit?.limit).toBeUndefined();

      const limitOffset = select("SELECT foo FROM bar LIMIT 1 + 2 OFFSET 3 * 4");
      expect(limitOffset.limit?.limit).toBeTruthy();
      expect(limitOffset.limit?.offset).toBeTruthy();
      expect(limitOffset.limit?.limit?.kind).toBe("binary_expr");
      expect(limitOffset.limit?.offset?.kind).toBe("binary_expr");
      expect(toSql(limitOffset)).toBe("SELECT foo FROM bar LIMIT 1 + 2 OFFSET 3 * 4");
    });

    test("ports test_query_with_format_clause", () => {
      const stmt = select("SELECT * FROM t FORMAT JSONCompact");
      expect(stmt.format?.name).toBe("JSONCompact");
      expect(toSql(stmt)).toBe("SELECT * FROM t FORMAT JSONCompact");
    });
  });

  describe("alter optimize and create table", () => {
    test("ports parse_alter_table_add_projection", () => {
      const stmt = statement(
        "ALTER TABLE t0 ADD PROJECTION IF NOT EXISTS my_name (SELECT a, b GROUP BY a ORDER BY b)",
      ) as AlterTableStatement;

      expect(stmt.kind).toBe("alter_table_statement");
      expect(stmt.operations).toHaveLength(1);
      expect(stmt.operations[0]?.kind).toBe("add_projection_operation");
      if (stmt.operations[0]?.kind !== "add_projection_operation") {
        throw new Error("expected add projection operation");
      }
      expect(stmt.operations[0].ifNotExists).toBe(true);
      expect(stmt.operations[0].name.name).toBe("my_name");
      expect(stmt.operations[0].query.groupBy).toHaveLength(1);
      expect(stmt.operations[0].query.orderBy).toHaveLength(1);
    });

    test("ports parse_alter_table_clear_and_materialize_projection", () => {
      const clearStmt = statement(
        "ALTER TABLE t0 CLEAR PROJECTION IF EXISTS my_name IN PARTITION p0",
      ) as AlterTableStatement;
      expect(clearStmt.operations[0]?.kind).toBe("clear_projection_operation");
      if (clearStmt.operations[0]?.kind !== "clear_projection_operation") {
        throw new Error("expected clear projection operation");
      }
      expect(clearStmt.operations[0].ifExists).toBe(true);
      expect(clearStmt.operations[0].partition?.name).toBe("p0");

      const materializeStmt = statement(
        "ALTER TABLE t0 MATERIALIZE PROJECTION my_name IN PARTITION p0",
      ) as AlterTableStatement;
      expect(materializeStmt.operations[0]?.kind).toBe("materialize_projection_operation");
      if (materializeStmt.operations[0]?.kind !== "materialize_projection_operation") {
        throw new Error("expected materialize projection operation");
      }
      expect(materializeStmt.operations[0].partition?.name).toBe("p0");
    });

    test("ports parse_optimize_table", () => {
      const stmt = statement(
        "OPTIMIZE TABLE t0 ON CLUSTER cluster PARTITION ID '2024-07' FINAL DEDUPLICATE BY id",
      ) as OptimizeTableStatement;

      expect(stmt.kind).toBe("optimize_table_statement");
      expect(stmt.onCluster).toBeTruthy();
      expect(stmt.partitionId?.name).toBe("2024-07");
      expect(stmt.final).toBe(true);
      expect(stmt.deduplicate).toBe(true);
      expect(stmt.deduplicateBy && toSql(stmt.deduplicateBy)).toBe("id");
    });

    test("ports parse_create_table and parse_create_table_with_primary_key", () => {
      const stmt = statement(
        "CREATE TABLE db.table (`i` INT, `k` INT) ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}') PARTITION BY tuple(i) PRIMARY KEY tuple(i) ORDER BY tuple(i) SETTINGS index_granularity = 8192",
      ) as CreateTableStatement;

      expect(stmt.kind).toBe("create_table_statement");
      expect(stmt.engine).toBeTruthy();
      expect(stmt.partitionBy).toBeTruthy();
      expect(stmt.primaryKey).toBeTruthy();
      expect(stmt.orderBy).toBeTruthy();
      expect(stmt.settings).toHaveLength(1);
      expect(toSql(stmt)).toBe(
        "CREATE TABLE db.table (`i` INT, `k` INT) ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}') PARTITION BY tuple(i) PRIMARY KEY tuple(i) ORDER BY tuple(i) SETTINGS index_granularity = 8192",
      );
    });
  });

  describe("ctes subqueries and windows", () => {
    test("ports parse_ctes", () => {
      const topLevel = select("WITH a AS (SELECT 1 AS foo), b AS (SELECT 2 AS bar) SELECT foo + bar FROM a, b");
      expect(topLevel.with).toHaveLength(2);
      expect(topLevel.with?.[0]?.name.name).toBe("a");
      expect(topLevel.with?.[0]?.value.kind).toBe("select_statement");
      expect(topLevel.from).toHaveLength(2);

      const nestedExpr = expression("(WITH a AS (SELECT 1 AS foo), b AS (SELECT 2 AS bar) SELECT foo + bar FROM a, b)");
      expect(nestedExpr.kind).toBe("subquery_expr");
      if (nestedExpr.kind !== "subquery_expr") {
        throw new Error("expected subquery expr");
      }
      expect(nestedExpr.query.kind).toBe("select_statement");
      if (nestedExpr.query.kind !== "select_statement") {
        throw new Error("expected select statement");
      }
      expect(nestedExpr.query.with).toHaveLength(2);
    });

    test("ports parse_derived_tables", () => {
      const stmt = select("SELECT * FROM (SELECT x FROM foo) AS a");
      expect(stmt.from).toHaveLength(1);
      expect(stmt.from?.[0]?.kind).toBe("subquery_source");
      if (stmt.from?.[0]?.kind !== "subquery_source") {
        throw new Error("expected subquery source");
      }
      expect(stmt.from[0].alias?.name).toBe("a");
      expect(stmt.from[0].query.kind).toBe("select_statement");
    });

    test("ports parse_scalar_subqueries", () => {
      const expr = expression("(SELECT 1) + (SELECT 2)");
      expect(expr.kind).toBe("binary_expr");
      if (expr.kind !== "binary_expr") {
        throw new Error("expected binary expr");
      }
      expect(expr.left.kind).toBe("subquery_expr");
      expect(expr.right.kind).toBe("subquery_expr");
    });

    test("ports parse_window_functions with raw OVER expressions", () => {
      const stmt = select(
        "SELECT row_number() OVER (ORDER BY dt DESC), sum(foo) OVER (PARTITION BY a, b ORDER BY c, d ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM foo",
      );

      expect(stmt.projection).toHaveLength(2);
      for (const item of stmt.projection) {
        expect(item.kind).toBe("expression_select_item");
        if (item.kind !== "expression_select_item") {
          throw new Error("expected expression select item");
        }
        expect(item.expression.kind).toBe("raw_expr");
        expect((item.expression as RawExpr).sql).toContain("OVER");
      }
    });

    test("ports parse_named_window_functions and parse_window_clause", () => {
      const stmt = select(
        "SELECT row_number() OVER w AS min1, sum(foo) OVER win AS max1 FROM foo WINDOW w AS (PARTITION BY x), win AS (ORDER BY y)",
      );

      expect(stmt.projection).toHaveLength(2);
      expect(stmt.windows).toHaveLength(2);
      expect(stmt.windows?.map((window) => window.sql)).toEqual([
        "w AS (PARTITION BY x)",
        "win AS (ORDER BY y)",
      ]);
      expect(toSql(stmt)).toBe(
        "SELECT row_number() OVER w AS min1, sum(foo) OVER win AS max1 FROM foo WINDOW w AS (PARTITION BY x), win AS (ORDER BY y)",
      );
    });
  });
});
