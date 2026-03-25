import { describe, expect, test } from "vitest";

import {
  ClickHouseDialect,
  parseExpr,
  parseStatement,
  toSql,
  type CreateTableStatement,
  type OrderByItem,
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

describe("clickhouse upstream parity", () => {
  test("parse_alter_table_attach_and_detach_partition", () => {
    const attachPartition = statement("ALTER TABLE t0 ATTACH PARTITION part");
    expect(toSql(attachPartition)).toBe("ALTER TABLE t0 ATTACH PARTITION part");
    expect(attachPartition.kind).toBe("alter_table_statement");
    if (attachPartition.kind === "alter_table_statement") {
      expect(attachPartition.operations[0]?.kind).toBe("attach_partition_operation");
    }
    expect(toSql(statement("ALTER TABLE t1 ATTACH PART part"))).toBe("ALTER TABLE t1 ATTACH PART part");
    const detachPartition = statement("ALTER TABLE t0 DETACH PARTITION part");
    expect(toSql(detachPartition)).toBe("ALTER TABLE t0 DETACH PARTITION part");
    if (detachPartition.kind === "alter_table_statement") {
      expect(detachPartition.operations[0]?.kind).toBe("detach_partition_operation");
    }
    expect(toSql(statement("ALTER TABLE t1 DETACH PART part"))).toBe("ALTER TABLE t1 DETACH PART part");

    expect(() => statement("ALTER TABLE t0 ATTACH PARTITION")).toThrow();
    expect(() => statement("ALTER TABLE t0 DETACH PART")).toThrow();
  });

  test("parse_alter_table_add_projection", () => {
    const withIfNotExists = statement("ALTER TABLE t0 ADD PROJECTION IF NOT EXISTS my_name (SELECT a, b GROUP BY a ORDER BY b)");
    expect(toSql(withIfNotExists)).toBe("ALTER TABLE t0 ADD PROJECTION IF NOT EXISTS my_name (SELECT a, b GROUP BY a ORDER BY b)");
    if (withIfNotExists.kind === "alter_table_statement") {
      expect(withIfNotExists.operations[0]?.kind).toBe("add_projection_operation");
    }
    expect(toSql(statement("ALTER TABLE t0 ADD PROJECTION my_name (SELECT a, b ORDER BY b)"))).toBe(
      "ALTER TABLE t0 ADD PROJECTION my_name (SELECT a, b ORDER BY b)",
    );
    expect(toSql(statement("ALTER TABLE t0 ADD PROJECTION my_name (SELECT a, b GROUP BY a)"))).toBe(
      "ALTER TABLE t0 ADD PROJECTION my_name (SELECT a, b GROUP BY a)",
    );

    expect(() => statement("ALTER TABLE t0 ADD PROJECTION my_name")).toThrow();
    expect(() => statement("ALTER TABLE t0 ADD PROJECTION my_name ()")).toThrow();
    expect(() => statement("ALTER TABLE t0 ADD PROJECTION my_name (SELECT)")).toThrow();
  });

  test("parse_alter_table_drop_projection", () => {
    expect(toSql(statement("ALTER TABLE t0 DROP PROJECTION IF EXISTS my_name"))).toBe(
      "ALTER TABLE t0 DROP PROJECTION IF EXISTS my_name",
    );
    expect(toSql(statement("ALTER TABLE t0 DROP PROJECTION my_name"))).toBe(
      "ALTER TABLE t0 DROP PROJECTION my_name",
    );
    expect(() => statement("ALTER TABLE t0 DROP PROJECTION")).toThrow();
  });

  test("parse_alter_table_clear_and_materialize_projection", () => {
    for (const keyword of ["CLEAR", "MATERIALIZE"]) {
      const stmt = statement(`ALTER TABLE t0 ${keyword} PROJECTION IF EXISTS my_name IN PARTITION p0`);
      expect(toSql(stmt)).toBe(`ALTER TABLE t0 ${keyword} PROJECTION IF EXISTS my_name IN PARTITION p0`);
      if (stmt.kind === "alter_table_statement") {
        expect(stmt.operations[0]?.kind).toBe(
          keyword === "CLEAR" ? "clear_projection_operation" : "materialize_projection_operation",
        );
      }
      expect(toSql(statement(`ALTER TABLE t0 ${keyword} PROJECTION my_name IN PARTITION p0`))).toBe(
        `ALTER TABLE t0 ${keyword} PROJECTION my_name IN PARTITION p0`,
      );
      expect(toSql(statement(`ALTER TABLE t0 ${keyword} PROJECTION my_name`))).toBe(
        `ALTER TABLE t0 ${keyword} PROJECTION my_name`,
      );
      expect(() => statement(`ALTER TABLE t0 ${keyword} PROJECTION`)).toThrow();
      expect(() => statement(`ALTER TABLE t0 ${keyword} PROJECTION my_name IN PARTITION`)).toThrow();
      expect(() => statement(`ALTER TABLE t0 ${keyword} PROJECTION my_name IN`)).toThrow();
    }
  });

  test("parse_create_table_with_primary_key", () => {
    const stmt = statement(
      "CREATE TABLE db.table (`i` INT, `k` INT) ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}') PRIMARY KEY tuple(i) ORDER BY tuple(i)",
    ) as CreateTableStatement;

    expect(stmt.kind).toBe("create_table_statement");
    expect(stmt.primaryKey).toBeTruthy();
    expect(stmt.orderBy).toBeTruthy();
    expect(toSql(stmt)).toBe(
      "CREATE TABLE db.table (`i` INT, `k` INT) ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}') PRIMARY KEY tuple(i) ORDER BY tuple(i)",
    );

    expect(() =>
      statement("CREATE TABLE db.table (`i` Int, `k` Int) ORDER BY tuple(i), tuple(k)"),
    ).toThrow();
  });

  test("parse_select_parametric_function", () => {
    const stmt = select("SELECT HISTOGRAM(0.5, 0.6)(x, y) FROM t");
    const projection = stmt.projection[0];
    expect(projection.kind).toBe("expression_select_item");
    if (projection.kind !== "expression_select_item") {
      throw new Error("expected expression select item");
    }

    const expr = projection.expression;
    expect(expr.kind).toBe("function_call_expr");
    if (expr.kind !== "function_call_expr") {
      throw new Error("expected function call");
    }

    expect(expr.parameters).toHaveLength(2);
    expect(expr.args).toHaveLength(2);
    expect(toSql(expr)).toBe("HISTOGRAM(0.5, 0.6)(x, y)");

    const standalone = parseExpr("HISTOGRAM(0.5, 0.6)(x, y)", { dialect });
    expect(toSql(standalone)).toBe("HISTOGRAM(0.5, 0.6)(x, y)");
  });

  test("parse_select_order_by_with_fill_interpolate", () => {
    const stmt = select(
      "SELECT id, fname, lname FROM customer WHERE id < 5 ORDER BY fname ASC NULLS FIRST WITH FILL FROM 10 TO 20 STEP 2, lname DESC NULLS LAST WITH FILL FROM 30 TO 40 STEP 3 INTERPOLATE (col1 AS col1 + 1) LIMIT 2",
    );

    expect(stmt.orderBy).toHaveLength(2);
    expect(stmt.interpolate?.items).toHaveLength(1);
    expect(stmt.limit?.limit).toBeTruthy();

    const [first, second] = stmt.orderBy as OrderByItem[];
    expect(first.direction).toBe("ASC");
    expect(first.nulls).toBe("FIRST");
    expect(first.withFill?.from).toBeTruthy();
    expect(second.direction).toBe("DESC");
    expect(second.nulls).toBe("LAST");
    expect(second.withFill?.step).toBeTruthy();
  });

  test("parse_with_fill_and_interpolate_variants", () => {
    const withFill = select("SELECT fname FROM customer ORDER BY fname WITH FILL FROM 10 TO 20 STEP 2");
    expect(withFill.orderBy?.[0]?.withFill?.from).toBeTruthy();
    expect(withFill.orderBy?.[0]?.withFill?.to).toBeTruthy();
    expect(withFill.orderBy?.[0]?.withFill?.step).toBeTruthy();

    const interpolateBody = select(
      "SELECT fname FROM customer ORDER BY fname WITH FILL INTERPOLATE (col1 AS col1 + 1, col2 AS col3, col4 AS col4 + 4)",
    );
    expect(interpolateBody.interpolate?.items).toHaveLength(3);

    const interpolateNoBody = select("SELECT fname FROM customer ORDER BY fname WITH FILL INTERPOLATE");
    expect(interpolateNoBody.interpolate?.items).toBeUndefined();

    const interpolateEmpty = select("SELECT fname FROM customer ORDER BY fname WITH FILL INTERPOLATE ()");
    expect(interpolateEmpty.interpolate?.items).toEqual([]);
  });

  test("parse_use_variants", () => {
    for (const name of ["mydb", "SCHEMA", "DATABASE", "CATALOG", "WAREHOUSE", "DEFAULT"]) {
      expect(toSql(statement(`USE ${name}`))).toBe(`USE ${name}`);
      expect(toSql(statement(`USE "${name}"`))).toBe(`USE "${name}"`);
      expect(toSql(statement(`USE \`${name}\``))).toBe(`USE \`${name}\``);
    }
  });

  test("parse_query_with_format_clause", () => {
    for (const format of ["TabSeparated", "JSONCompact", "NULL"]) {
      const stmt = select(`SELECT * FROM t FORMAT ${format}`);
      expect(stmt.format?.name).toBe(format);
    }

    expect(() => statement("SELECT * FROM t FORMAT")).toThrow();
    expect(() => statement("SELECT * FROM t FORMAT TabSeparated JSONCompact")).toThrow();
    expect(() => statement("SELECT * FROM t FORMAT TabSeparated TabSeparated")).toThrow();
  });

  test("parse_explain_table_and_describe_aliases", () => {
    const describe = statement("DESCRIBE test.table");
    expect(describe.kind).toBe("describe_statement");
    if (describe.kind === "describe_statement") {
      expect(describe.alias).toBe("DESCRIBE");
      expect(describe.hasTableKeyword).toBe(false);
    }

    const desc = statement("DESC TABLE test.table");
    expect(desc.kind).toBe("describe_statement");
    if (desc.kind === "describe_statement") {
      expect(desc.alias).toBe("DESC");
      expect(desc.hasTableKeyword).toBe(true);
    }

    const explain = statement("EXPLAIN TABLE test_identifier");
    expect(explain.kind).toBe("explain_statement");
    expect(toSql(explain)).toBe("EXPLAIN TABLE test_identifier");
  });

  test("parse_freeze_and_unfreeze_partition_ast", () => {
    const freeze = statement("ALTER TABLE t FREEZE PARTITION '2024-08-14' WITH NAME 'hello'");
    expect(freeze.kind).toBe("alter_table_statement");
    if (freeze.kind === "alter_table_statement") {
      expect(freeze.operations[0]?.kind).toBe("freeze_partition_operation");
    }

    const unfreeze = statement("ALTER TABLE t UNFREEZE PARTITION '2024-08-14'");
    if (unfreeze.kind === "alter_table_statement") {
      expect(unfreeze.operations[0]?.kind).toBe("unfreeze_partition_operation");
    }
  });
});
