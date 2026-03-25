import { describe, expect, test } from "vitest";

import { ClickHouseDialect, parseSql, parseStatement, toSql } from "../src/index";

const dialect = new ClickHouseDialect();

function expectSingleRaw(sql: string) {
  const statements = parseSql(sql, { dialect });
  expect(statements).toHaveLength(1);
  expect(statements[0]?.kind).toBe("raw_statement");
  expect(toSql(statements[0]!)).toBe(sql.trim());
  expect(() => parseStatement(sql, { dialect })).toThrow();
}

describe("raw fallback", () => {
  test("preserves join queries as one raw statement", () => {
    expectSingleRaw(
      "SELECT e.user_id, u.user_name FROM sample_events AS e INNER JOIN users AS u ON e.user_id = u.user_id",
    );
  });

  test("preserves array join queries as one raw statement", () => {
    expectSingleRaw("SELECT s, arr, a FROM arrays_test ARRAY JOIN arr AS a");
    expectSingleRaw("SELECT s, `n.x`, `n.y`, `nest.x`, `nest.y` FROM nested_test ARRAY JOIN nest AS n");
  });

  test("preserves grouping sets and set operations as one raw statement", () => {
    expectSingleRaw(
      "SELECT fact_1_id, fact_2_id, fact_3_id, SUM(sales_value) AS sales_value FROM grouping_sets GROUP BY GROUPING SETS ((fact_1_id, fact_2_id), (fact_1_id, fact_3_id)) ORDER BY fact_1_id, fact_2_id, fact_3_id",
    );
    expectSingleRaw("SELECT user_id FROM page_views UNION ALL SELECT user_id FROM purchases");
  });

  test("preserves select output clauses as one raw statement", () => {
    expectSingleRaw("SELECT order_id, amount FROM orders INTO OUTFILE '/tmp/out.parquet' FORMAT Parquet");
  });

  test("preserves create table ttl clauses as one raw statement", () => {
    expectSingleRaw(
      "CREATE TABLE sessions (ts DateTime, user_id UInt64) ENGINE = MergeTree() ORDER BY ts TTL ts + INTERVAL 7 DAY",
    );
  });

  test("preserves unsupported expression forms as one raw statement", () => {
    expectSingleRaw("SELECT CASE WHEN score > 90 THEN 'great' ELSE 'ok' END AS rating FROM grades");
    expectSingleRaw("SELECT user_id FROM users WHERE user_id NOT IN (SELECT user_id FROM blocked_users)");
  });
});
