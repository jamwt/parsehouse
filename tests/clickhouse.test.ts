import { describe, expect, test } from "vitest";

import {
  ClickHouseDialect,
  parseExpr,
  parseStatement,
  parseSql,
  toSql,
  type CreateTableStatement,
  type FunctionTableSource,
  type SelectStatement,
} from "../src/index";

const dialect = new ClickHouseDialect();

function roundTrip(sql: string, canonical = sql) {
  const statement = parseStatement(sql, { dialect });
  expect(toSql(statement)).toBe(canonical);
  return statement;
}

function select(sql: string): SelectStatement {
  const statement = parseStatement(sql, { dialect });
  expect(statement.kind).toBe("select_statement");
  return statement as SelectStatement;
}

describe("upstream clickhouse coverage", () => {
  test("map access expression round-trips", () => {
    roundTrip(
      "SELECT string_values[indexOf(string_names, 'endpoint')] FROM foos WHERE id = 'test' AND string_value[indexOf(string_name, 'app')] <> 'foo'",
    );
  });

  test("array literals and array functions round-trip", () => {
    roundTrip("SELECT ['1', '2'] FROM test");
    roundTrip("SELECT array(x1, x2) FROM foo");
  });

  test("kill mutation statement parses", () => {
    const statement = roundTrip("KILL MUTATION 5");
    expect(statement.kind).toBe("kill_statement");
  });

  test("quoted identifiers are preserved", () => {
    roundTrip(
      'SELECT "alias"."bar baz", "myfun"(), "simple id" AS "column alias" FROM "a table" AS "alias"',
    );
    roundTrip('CREATE TABLE "foo" ("bar" "int")');
  });

  test("create table merge tree cases round-trip", () => {
    roundTrip('CREATE TABLE "x" ("a" "int") ENGINE = MergeTree ORDER BY ("x")');
    roundTrip('CREATE TABLE "x" ("a" "int") ENGINE = MergeTree ORDER BY "x"');
    roundTrip(
      'CREATE TABLE "x" ("a" "int") ENGINE = MergeTree ORDER BY "x" AS SELECT * FROM "t" WHERE true',
    );
    roundTrip(
      "CREATE TABLE x (a int) ENGINE = MergeTree() ORDER BY a",
      "CREATE TABLE x (a INT) ENGINE = MergeTree ORDER BY a",
    );
  });

  test("insert into function variants round-trip", () => {
    roundTrip(
      "INSERT INTO TABLE FUNCTION remote('localhost', default.simple_table) VALUES (100, 'inserted via remote()')",
    );
    roundTrip(
      "INSERT INTO FUNCTION remote('localhost', default.simple_table) VALUES (100, 'inserted via remote()')",
    );
  });

  test("alter table clickhouse projection and partition statements round-trip", () => {
    roundTrip("ALTER TABLE t0 ATTACH PARTITION part");
    roundTrip("ALTER TABLE t1 DETACH PART part");
    roundTrip("ALTER TABLE t0 ADD PROJECTION IF NOT EXISTS my_name (SELECT a, b GROUP BY a ORDER BY b)");
    roundTrip("ALTER TABLE t0 DROP PROJECTION IF EXISTS my_name");
    roundTrip("ALTER TABLE t0 CLEAR PROJECTION IF EXISTS my_name IN PARTITION p0");
    roundTrip("ALTER TABLE t0 MATERIALIZE PROJECTION my_name");
  });

  test("optimize table final and deduplicate forms round-trip", () => {
    roundTrip("OPTIMIZE TABLE t0");
    roundTrip("OPTIMIZE TABLE db.t0");
    roundTrip("OPTIMIZE TABLE t0 ON CLUSTER 'cluster'");
    roundTrip("OPTIMIZE TABLE t0 ON CLUSTER 'cluster' FINAL");
    roundTrip("OPTIMIZE TABLE t0 FINAL DEDUPLICATE");
    roundTrip("OPTIMIZE TABLE t0 DEDUPLICATE");
    roundTrip("OPTIMIZE TABLE t0 DEDUPLICATE BY id");
    roundTrip("OPTIMIZE TABLE t0 FINAL DEDUPLICATE BY id");
    roundTrip("OPTIMIZE TABLE t0 PARTITION tuple('2023-04-22') DEDUPLICATE BY id");
    roundTrip("OPTIMIZE TABLE t0 ON CLUSTER cluster PARTITION ID '2024-07' FINAL DEDUPLICATE BY id");
  });

  test("clickhouse data types parse through create table", () => {
    const statement = roundTrip(
      "CREATE TABLE table (a1 UInt8, a2 UInt16, a3 UInt32, a4 UInt64, a5 UInt128, a6 UInt256, b1 Int8, b2 Int16, b3 Int32, b4 Int64, b5 Int128, b6 Int256, c1 Float32, c2 Float64, d1 Date32, d2 DateTime64(3), d3 DateTime64(3, 'UTC'), e1 FixedString(255), f1 LowCardinality(Int32)) ORDER BY (a1)",
      "CREATE TABLE table (a1 UInt8, a2 UInt16, a3 UInt32, a4 UInt64, a5 UInt128, a6 UInt256, b1 INT8, b2 INT16, b3 INT32, b4 INT64, b5 INT128, b6 INT256, c1 FLOAT32, c2 FLOAT64, d1 Date32, d2 DateTime64(3), d3 DateTime64(3, 'UTC'), e1 FixedString(255), f1 LowCardinality(INT32)) ORDER BY (a1)",
    );
    expect((statement as CreateTableStatement).columns).toHaveLength(19);
  });

  test("nullable and nested data types round-trip", () => {
    roundTrip(
      "CREATE TABLE table (k UInt8, `a` Nullable(String), `b` Nullable(DateTime64(9, 'UTC')), c Nullable(DateTime64(9)), d Date32 NULL) ENGINE = MergeTree ORDER BY (`k`)",
      "CREATE TABLE table (k UInt8, `a` Nullable(STRING), `b` Nullable(DateTime64(9, 'UTC')), c Nullable(DateTime64(9)), d Date32 NULL) ENGINE = MergeTree ORDER BY (`k`)",
    );
    const nested = parseStatement(
      "CREATE TABLE table (i Nested(a Array(Int16), b LowCardinality(String)), k Array(Tuple(FixedString(128), Int128)), l Tuple(a DateTime64(9), b Array(UUID)), m Map(String, UInt16)) ENGINE = MergeTree ORDER BY (k)",
      { dialect },
    );
    expect(nested.kind).toBe("create_table_statement");
  });

  test("primary key and variant default expressions round-trip", () => {
    roundTrip(
      "CREATE TABLE db.table (`i` INT, `k` INT) ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}') PRIMARY KEY tuple(i) ORDER BY tuple(i)",
    );
    roundTrip(
      "CREATE TABLE table (a DATETIME MATERIALIZED now(), b DATETIME EPHEMERAL now(), c DATETIME EPHEMERAL, d STRING ALIAS toString(c)) ENGINE = MergeTree",
    );
  });

  test("create view with typed columns round-trips", () => {
    roundTrip('CREATE VIEW v (i "int", f "String") AS SELECT * FROM t');
    expect(() => parseStatement("CREATE VIEW v (i, f) AS SELECT * FROM t", { dialect })).toThrow();
  });

  test("double equal canonicalizes to equals", () => {
    roundTrip("SELECT foo FROM bar WHERE buz == 'buz'", "SELECT foo FROM bar WHERE buz = 'buz'");
  });

  test("limit by and settings clauses parse", () => {
    roundTrip(
      "SELECT * FROM default.last_asset_runs_mv ORDER BY created_at DESC LIMIT 1 BY asset",
    );
    roundTrip(
      "SELECT * FROM default.last_asset_runs_mv ORDER BY created_at DESC LIMIT 1 BY asset, toStartOfDay(created_at)",
    );
    roundTrip(
      "SELECT * FROM t SETTINGS max_threads = 1, max_block_size = 10000",
    );
    roundTrip(
      "SELECT * FROM t SETTINGS additional_table_filters = {'table_1': 'x != 2'}",
    );
    roundTrip(
      "SELECT * FROM t SETTINGS additional_result_filter = 'x != 2', query_plan_optimize_lazy_materialization = false",
    );
  });

  test("star except canonicalizes with parens", () => {
    roundTrip("SELECT * EXCEPT (prev_status) FROM anomalies");
    roundTrip(
      "SELECT * EXCEPT prev_status FROM anomalies",
      "SELECT * EXCEPT (prev_status) FROM anomalies",
    );
  });

  test("parametric functions parse in selects and expressions", () => {
    roundTrip("SELECT HISTOGRAM(0.5, 0.6)(x, y) FROM t");
    const expression = parseExpr("HISTOGRAM(0.5, 0.6)(x, y)", { dialect });
    expect(toSql(expression)).toBe("HISTOGRAM(0.5, 0.6)(x, y)");
  });

  test("materialized view parses", () => {
    roundTrip(
      "CREATE MATERIALIZED VIEW analytics.monthly_aggregated_data_mv TO analytics.monthly_aggregated_data AS SELECT toDate(toStartOfMonth(event_time)) AS month, domain_name, sumState(count_views) AS sumCountViews FROM analytics.hourly_data GROUP BY domain_name, month",
    );
  });

  test("with fill and interpolate clauses round-trip", () => {
    roundTrip(
      "SELECT id, fname, lname FROM customer WHERE id < 5 ORDER BY fname ASC NULLS FIRST WITH FILL FROM 10 TO 20 STEP 2, lname DESC NULLS LAST WITH FILL FROM 30 TO 40 STEP 3 INTERPOLATE (col1 AS col1 + 1) LIMIT 2",
    );
    roundTrip("SELECT fname FROM customer ORDER BY fname WITH FILL FROM 10 TO 20 STEP 2");
    roundTrip(
      "SELECT fname FROM customer ORDER BY fname WITH FILL INTERPOLATE (col1 AS col1 + 1, col2 AS col3, col4 AS col4 + 4)",
    );
    roundTrip("SELECT fname FROM customer ORDER BY fname WITH FILL INTERPOLATE");
    roundTrip("SELECT fname FROM customer ORDER BY fname WITH FILL INTERPOLATE ()");
    expect(() =>
      parseStatement("SELECT id, fname, lname FROM customer ORDER BY fname WITH FILL FROM TO 20", { dialect }),
    ).toThrow();
    expect(() =>
      parseStatement(
        "SELECT id, fname, lname FROM customer ORDER BY fname WITH FILL FROM TO 20, lname WITH FILL FROM TO STEP 1",
        { dialect },
      ),
    ).toThrow();
  });

  test("invalid interpolate, limit by, and format cases throw", () => {
    expect(() =>
      parseStatement(
        "SELECT id, fname, lname FROM customer ORDER BY fname WITH FILL INTERPOLATE (col1 AS col1 + 1) INTERPOLATE (col2 AS col2 + 2)",
        { dialect },
      ),
    ).toThrow();
    expect(() =>
      parseStatement(
        "SELECT id, fname, lname FROM customer ORDER BY fname INTERPOLATE (col2 AS col2 + 2), lname",
        { dialect },
      ),
    ).toThrow();
    expect(() =>
      parseStatement(
        "SELECT * FROM default.last_asset_runs_mv ORDER BY created_at DESC BY asset, toStartOfDay(created_at)",
        { dialect },
      ),
    ).toThrow();
    expect(() => parseStatement("SELECT * FROM T OFFSET 5 BY foo", { dialect })).toThrow();
    expect(() => parseStatement("SELECT * FROM t FORMAT", { dialect })).toThrow();
    expect(() =>
      parseStatement("SELECT * FROM t FORMAT TabSeparated JSONCompact", { dialect }),
    ).toThrow();
    expect(() => parseStatement("SELECT * FROM t SETTINGS a", { dialect })).toThrow();
    expect(() => parseStatement("SELECT * FROM t SETTINGS a=", { dialect })).toThrow();
    expect(() => parseStatement("SELECT * FROM t SETTINGS a=1, b", { dialect })).toThrow();
    expect(() => parseStatement("SELECT * FROM t SETTINGS a=1, b=", { dialect })).toThrow();
    expect(() => parseStatement("SELECT * FROM t SETTINGS a = {", { dialect })).toThrow();
    expect(() => parseStatement("SELECT * FROM t SETTINGS a = {'b'", { dialect })).toThrow();
    expect(() => parseStatement("SELECT * FROM t SETTINGS a = {'b': ", { dialect })).toThrow();
    expect(() => parseStatement("SELECT * FROM t SETTINGS a = {'b': 'c',}", { dialect })).toThrow();
    expect(() => parseStatement("SELECT * FROM t SETTINGS a = {'b': 'c', 'd'}", { dialect })).toThrow();
    expect(() => parseStatement("SELECT * FROM t SETTINGS a = {'b': 'c', 'd': }", { dialect })).toThrow();
    expect(() => parseStatement("SELECT * FROM t SETTINGS a = {ANY(b)}", { dialect })).toThrow();
  });

  test("prewhere is tracked separately", () => {
    const statement = select("SELECT * FROM t PREWHERE x = 1 WHERE y = 2");
    expect(statement.prewhere).toBeTruthy();
    expect(statement.where).toBeTruthy();
    expect(toSql(statement)).toBe("SELECT * FROM t PREWHERE x = 1 WHERE y = 2");
  });

  test("use statements preserve quoting", () => {
    roundTrip("USE mydb");
    roundTrip('USE "DEFAULT"');
    roundTrip("USE `DATABASE`");
  });

  test("select format and insert format clauses round-trip", () => {
    roundTrip("SELECT * FROM t FORMAT TabSeparated");
    roundTrip("SELECT * FROM t FORMAT JSONCompact");
    roundTrip("SELECT * FROM t FORMAT NULL");
    roundTrip("INSERT INTO tbl FORMAT JSONEachRow {\"id\": 1, \"value\": \"foo\"}, {\"id\": 2, \"value\": \"bar\"}");
    roundTrip("INSERT INTO tbl FORMAT JSONEachRow [\"first\", \"second\", \"third\"]");
    roundTrip("INSERT INTO tbl FORMAT JSONEachRow [{\"first\": 1}]");
    roundTrip("INSERT INTO tbl (foo) FORMAT JSONAsObject {\"foo\": {\"bar\": {\"x\": \"y\"}, \"baz\": 1}}");
    roundTrip("INSERT INTO tbl (foo, bar) FORMAT JSON {\"foo\": 1, \"bar\": 2}");
    roundTrip("INSERT INTO tbl FORMAT CSV col1, col2, col3");
    roundTrip("INSERT INTO tbl FORMAT LineAsString \"I love apple\", \"I love banana\", \"I love orange\"");
    roundTrip(
      "INSERT INTO tbl (foo) SETTINGS input_format_json_read_bools_as_numbers = true FORMAT JSONEachRow {\"id\": 1, \"value\": \"foo\"}",
    );
    roundTrip(
      "INSERT INTO tbl SETTINGS format_template_resultset = '/some/path/resultset.format', format_template_row = '/some/path/row.format' FORMAT Template",
    );
  });

  test("temporary create table with on commit and select parses", () => {
    const statement = roundTrip("CREATE LOCAL TEMPORARY TABLE test ON COMMIT PRESERVE ROWS AS SELECT 1");
    expect(statement.kind).toBe("create_table_statement");
    const table = statement as CreateTableStatement;
    expect(table.local).toBe(true);
    expect(table.temporary).toBe(true);
    expect(table.onCommit).toBe("PRESERVE ROWS");
    expect(table.asSelect?.projection).toHaveLength(1);
  });

  test("freeze and unfreeze alter statements round-trip", () => {
    roundTrip("ALTER TABLE t FREEZE PARTITION '2024-08-14'");
    roundTrip("ALTER TABLE t UNFREEZE PARTITION '2024-08-14' WITH NAME 'hello'");
    expect(() => parseStatement("ALTER TABLE t0 FREEZE PARTITION", { dialect })).toThrow();
    expect(() => parseStatement("ALTER TABLE t0 UNFREEZE PARTITION p0 WITH", { dialect })).toThrow();
    expect(() => parseStatement("ALTER TABLE t0 FREEZE PARTITION p0 WITH NAME", { dialect })).toThrow();
  });

  test("table function settings are preserved", () => {
    const statement = select("SELECT * FROM table_function(arg, SETTINGS s0 = 3, s1 = 's')");
    const from = statement.from?.[0] as FunctionTableSource;
    expect(from.kind).toBe("function_table_source");
    expect(from.function.settings).toHaveLength(2);
    expect(toSql(statement)).toBe("SELECT * FROM table_function(arg, SETTINGS s0 = 3, s1 = 's')");
    roundTrip("SELECT * FROM table_function(arg)");
    roundTrip("SELECT * FROM table_function(SETTINGS s0 = 3, s1 = 's')");
    expect(() => parseStatement("SELECT * FROM t(SETTINGS a)", { dialect })).toThrow();
    expect(() => parseStatement("SELECT * FROM t(SETTINGS a=)", { dialect })).toThrow();
    expect(() => parseStatement("SELECT * FROM t(SETTINGS a=1, b)", { dialect })).toThrow();
    expect(() => parseStatement("SELECT * FROM t(SETTINGS a=1, b=)", { dialect })).toThrow();
  });

  test("describe, desc, and explain table round-trip", () => {
    roundTrip("DESCRIBE test.table");
    roundTrip("DESCRIBE TABLE test.table");
    roundTrip("DESC test.table");
    roundTrip("DESC TABLE test.table");
    roundTrip("EXPLAIN TABLE test_identifier");
  });

  test("sample clause round-trips", () => {
    roundTrip("SELECT * FROM tbl SAMPLE 0.1");
    roundTrip("SELECT * FROM tbl SAMPLE 1000");
    roundTrip("SELECT * FROM tbl SAMPLE 1 / 10");
    const statement = select("SELECT * FROM tbl SAMPLE 1 / 10 OFFSET 1 / 2");
    expect(statement.sample).toBeTruthy();
    expect(toSql(statement)).toBe("SELECT * FROM tbl SAMPLE 1 / 10 OFFSET 1 / 2");
  });

  test("optimize and projection invalid cases throw", () => {
    expect(() => parseStatement("OPTIMIZE TABLE t0 DEDUPLICATE BY", { dialect })).toThrow();
    expect(() => parseStatement("OPTIMIZE TABLE t0 PARTITION", { dialect })).toThrow();
    expect(() => parseStatement("OPTIMIZE TABLE t0 PARTITION ID", { dialect })).toThrow();
    expect(() => parseStatement("ALTER TABLE t0 DROP PROJECTION", { dialect })).toThrow();
    expect(() => parseStatement("ALTER TABLE t0 ADD PROJECTION my_name", { dialect })).toThrow();
    expect(() => parseStatement("ALTER TABLE t0 ADD PROJECTION my_name ()", { dialect })).toThrow();
    expect(() => parseStatement("ALTER TABLE t0 ADD PROJECTION my_name (SELECT)", { dialect })).toThrow();
    expect(() => parseStatement("ALTER TABLE t0 CLEAR PROJECTION", { dialect })).toThrow();
    expect(() => parseStatement("ALTER TABLE t0 CLEAR PROJECTION my_name IN PARTITION", { dialect })).toThrow();
    expect(() => parseStatement("ALTER TABLE t0 CLEAR PROJECTION my_name IN", { dialect })).toThrow();
    expect(() => parseStatement("ALTER TABLE t0 ATTACH PARTITION", { dialect })).toThrow();
    expect(() => parseStatement("ALTER TABLE t0 DETACH PART", { dialect })).toThrow();
  });

  test("not null aliases canonicalize inside expressions but not column options", () => {
    roundTrip(
      "CREATE TABLE foo (abc INT DEFAULT (42 NOT NULL) NOT NULL, not_null BOOL MATERIALIZED (abc NOT NULL), CHECK (abc NOT NULL))",
      "CREATE TABLE foo (abc INT DEFAULT (42 IS NOT NULL) NOT NULL, not_null BOOL MATERIALIZED (abc IS NOT NULL), CHECK (abc IS NOT NULL))",
    );
  });

  test("final in from clause remains explicit", () => {
    roundTrip("SELECT * FROM events FINAL PREWHERE team_id = 1");
    const statements = parseSql("USE default; SELECT ['a', 'b'] FROM t FINAL", { dialect });
    expect(statements.map((statement) => toSql(statement))).toEqual([
      "USE default",
      "SELECT ['a', 'b'] FROM t FINAL",
    ]);
  });
});
