import { describe, expect, test } from "vitest";

import {
  ClickHouseDialect,
  parseSql,
  parseStatement,
  toSql,
  type CreateTableStatement,
  type SelectStatement,
} from "../src/index";

const dialect = new ClickHouseDialect();

function parseSingleStatement(sql: string) {
  const statements = parseSql(sql, { dialect });
  expect(statements).toHaveLength(1);
  return parseStatement(sql, { dialect });
}

describe("single statement regressions", () => {
  test("window partition by stays in one select statement", () => {
    const statement = parseSingleStatement(
      "SELECT user_id, event_name, timestamp, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY timestamp) AS row_num FROM sample_events",
    ) as SelectStatement;

    expect(statement.projection).toHaveLength(4);
    expect(statement.from).toHaveLength(1);
    expect(toSql(statement)).toBe(
      "SELECT user_id, event_name, timestamp, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY timestamp) AS row_num FROM sample_events",
    );
  });

  test("named window clause stays in one select statement", () => {
    const statement = parseSingleStatement(
      "SELECT user_id, event_name, event_value, SUM(event_value) OVER w AS running_sum, AVG(event_value) OVER w AS running_avg FROM sample_events WINDOW w AS (PARTITION BY user_id ORDER BY timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) ORDER BY user_id, timestamp",
    ) as SelectStatement;

    expect(statement.windows).toHaveLength(1);
    expect(statement.orderBy).toHaveLength(2);
    expect(toSql(statement)).toBe(
      "SELECT user_id, event_name, event_value, SUM(event_value) OVER w AS running_sum, AVG(event_value) OVER w AS running_avg FROM sample_events WINDOW w AS (PARTITION BY user_id ORDER BY timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) ORDER BY user_id, timestamp",
    );
  });

  test("clause-heavy select keeps typed clauses in one statement", () => {
    const statement = parseSingleStatement(
      "SELECT * FROM events FINAL PREWHERE team_id = 1 WHERE success = true ORDER BY ts DESC LIMIT 1 BY user_id SETTINGS max_threads = 2 FORMAT JSONEachRow",
    ) as SelectStatement;

    expect(statement.from).toHaveLength(1);
    expect(statement.from?.[0]?.kind).toBe("table_reference");
    expect(statement.from?.[0]?.kind === "table_reference" && statement.from[0].final).toBe(true);
    expect(statement.prewhere).toBeTruthy();
    expect(statement.where).toBeTruthy();
    expect(statement.orderBy).toHaveLength(1);
    expect(statement.limit?.by).toBeTruthy();
    expect(statement.limit?.limit).toBeUndefined();
    expect(statement.settings).toHaveLength(1);
    expect(statement.format?.name).toBe("JSONEachRow");
  });

  test("limit by followed by limit stays in one select statement", () => {
    const statement = parseSingleStatement(
      "SELECT user_id, event_name, timestamp, event_value FROM sample_events ORDER BY event_value DESC LIMIT 5 BY user_id LIMIT 100",
    ) as SelectStatement;

    expect(statement.limit?.by).toBeTruthy();
    expect(statement.limit?.limit).toBeTruthy();
    expect(toSql(statement)).toBe(
      "SELECT user_id, event_name, timestamp, event_value FROM sample_events ORDER BY event_value DESC LIMIT 5 BY user_id LIMIT 100",
    );
  });

  test("format before settings stays in one select statement", () => {
    const statement = parseSingleStatement(
      "SELECT database, table, formatReadableSize(total_bytes) AS size, total_rows FROM system.tables WHERE database = currentDatabase() ORDER BY total_bytes DESC LIMIT 20 FORMAT Pretty SETTINGS output_format_pretty_color = 1",
    ) as SelectStatement;

    expect(statement.limit?.limit).toBeTruthy();
    expect(statement.settings).toHaveLength(1);
    expect(statement.format?.name).toBe("Pretty");
    expect(toSql(statement)).toBe(
      "SELECT database, table, formatReadableSize(total_bytes) AS size, total_rows FROM system.tables WHERE database = currentDatabase() ORDER BY total_bytes DESC LIMIT 20 SETTINGS output_format_pretty_color = 1 FORMAT Pretty",
    );
  });

  test("cte pipeline stays in one select statement", () => {
    const statement = parseSingleStatement(
      "WITH daily AS (SELECT toDate(timestamp) AS day, user_id, COUNT(*) AS daily_events FROM sample_events GROUP BY day, user_id), user_stats AS (SELECT user_id, AVG(daily_events) AS avg_daily, MAX(daily_events) AS max_daily FROM daily GROUP BY user_id) SELECT user_id, avg_daily, max_daily, max_daily / avg_daily AS burst_ratio FROM user_stats WHERE avg_daily > 5 ORDER BY burst_ratio DESC LIMIT 20",
    ) as SelectStatement;

    expect(statement.with).toHaveLength(2);
    expect(statement.where).toBeTruthy();
    expect(statement.orderBy).toHaveLength(1);
    expect(statement.limit?.limit).toBeTruthy();
  });

  test("create table partition by stays in one statement and is typed", () => {
    const statement = parseSingleStatement(
      "CREATE TABLE events_log (timestamp DateTime, user_id UInt64, event_name LowCardinality(String), event_value Float64, properties Map(String, String)) ENGINE = MergeTree() PARTITION BY toYYYYMM(timestamp) ORDER BY (user_id, timestamp) SETTINGS index_granularity = 8192",
    ) as CreateTableStatement;

    expect(statement.partitionBy).toBeTruthy();
    expect(statement.orderBy).toBeTruthy();
    expect(statement.settings).toHaveLength(1);
    expect(toSql(statement)).toBe(
      "CREATE TABLE events_log (timestamp DATETIME, user_id UInt64, event_name LowCardinality(STRING), event_value FLOAT64, properties Map(STRING, STRING)) ENGINE = MergeTree PARTITION BY toYYYYMM(timestamp) ORDER BY (user_id, timestamp) SETTINGS index_granularity = 8192",
    );
  });
});
