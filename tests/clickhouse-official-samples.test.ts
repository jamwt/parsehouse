import { describe, expect, test } from "vitest";

import {
  ClickHouseDialect,
  parseSql,
  parseStatement,
  toSql,
  type CreateTableStatement,
  type FunctionTableSource,
  type SelectStatement,
} from "../src/index";

const dialect = new ClickHouseDialect();

function statement(sql: string) {
  return parseStatement(sql, { dialect });
}

describe("official clickhouse samples", () => {
  test("00800_versatile_storage_join create table with join settings stays typed", () => {
    const stmt = statement(
      "CREATE TABLE join_any_left_null (s String, k UInt64) ENGINE = Join(ANY, LEFT, k) SETTINGS join_use_nulls = 1",
    ) as CreateTableStatement;

    expect(stmt.kind).toBe("create_table_statement");
    expect(stmt.engine).toBeTruthy();
    expect(stmt.settings).toHaveLength(1);
    expect(stmt.settings?.[0]?.key.name).toBe("join_use_nulls");
    expect(toSql(stmt)).toBe(
      "CREATE TABLE join_any_left_null (s STRING, k UInt64) ENGINE = Join(ANY, LEFT, k) SETTINGS join_use_nulls = 1",
    );
  });

  test("00800_versatile_storage_join joinGet select stays typed", () => {
    const stmt = statement("SELECT joinGet('join_any_left', 's', number) FROM numbers(3)") as SelectStatement;

    expect(stmt.kind).toBe("select_statement");
    expect(stmt.projection).toHaveLength(1);
    expect(stmt.from).toHaveLength(1);
    expect(stmt.from?.[0]?.kind).toBe("function_table_source");
    const source = stmt.from?.[0] as FunctionTableSource;
    expect(source.function.name.parts.map((part) => part.name)).toEqual(["numbers"]);
    expect(source.function.args).toHaveLength(1);
  });

  test("01883_with_grouping_sets sample stays one raw statement", () => {
    const sql =
      "SELECT fact_1_id, fact_2_id, fact_3_id, SUM(sales_value) AS sales_value FROM grouping_sets GROUP BY GROUPING SETS ((fact_1_id, fact_2_id), (fact_1_id, fact_3_id)) ORDER BY fact_1_id, fact_2_id, fact_3_id";

    const statements = parseSql(sql, { dialect });
    expect(statements).toHaveLength(1);
    expect(statements[0]?.kind).toBe("raw_statement");
    expect(toSql(statements[0]!)).toBe(sql);
  });
});
