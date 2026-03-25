import { describe, expect, test } from "vitest";

import { ClickHouseDialect, parseExpr, parseStatement, parseSql, toSql } from "../src/index";

describe("clickhouse parser", () => {
  test("parses select with final prewhere settings and limit by", () => {
    const statement = parseStatement(
      "SELECT * FROM events FINAL PREWHERE team_id = 1 WHERE success = true ORDER BY ts DESC LIMIT 1 BY user_id SETTINGS max_threads = 2 FORMAT JSONEachRow",
      { dialect: new ClickHouseDialect() },
    );

    expect(statement.kind).toBe("select_statement");
    expect(toSql(statement)).toBe(
      "SELECT * FROM events FINAL PREWHERE team_id = 1 WHERE success = true ORDER BY ts DESC LIMIT 1 BY user_id SETTINGS max_threads = 2 FORMAT JSONEachRow",
    );
  });

  test("parses create table with merge tree engine", () => {
    const statement = parseStatement(
      "CREATE TABLE events (id UInt64, user_id Nullable(String), created_at DateTime64(3, 'UTC')) ENGINE = MergeTree() ORDER BY created_at",
      { dialect: new ClickHouseDialect() },
    );

    expect(statement.kind).toBe("create_table_statement");
    expect(toSql(statement)).toBe(
      "CREATE TABLE events (id UInt64, user_id Nullable(STRING), created_at DateTime64(3, 'UTC')) ENGINE = MergeTree ORDER BY created_at",
    );
  });

  test("parses optimize final", () => {
    const statement = parseStatement("OPTIMIZE TABLE events FINAL DEDUPLICATE BY id", {
      dialect: new ClickHouseDialect(),
    });

    expect(statement.kind).toBe("optimize_table_statement");
    expect(toSql(statement)).toBe("OPTIMIZE TABLE events FINAL DEDUPLICATE BY id");
  });

  test("parses parametric function expression", () => {
    const expression = parseExpr("HISTOGRAM(0.5, 0.6)(x, y)", {
      dialect: new ClickHouseDialect(),
    });

    expect(expression.kind).toBe("function_call_expr");
    expect(toSql(expression)).toBe("HISTOGRAM(0.5, 0.6)(x, y)");
  });

  test("parses multiple statements", () => {
    const statements = parseSql("USE default; SELECT ['a', 'b'] FROM t FINAL", {
      dialect: new ClickHouseDialect(),
    });

    expect(statements).toHaveLength(2);
    expect(statements.map((statement) => toSql(statement))).toEqual([
      "USE default",
      "SELECT ['a', 'b'] FROM t FINAL",
    ]);
  });
});
