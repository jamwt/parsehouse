import { bench, describe } from "vitest";

import {
  ClickHouseDialect,
  parseSql,
  parseStatement,
  toSql,
  type Statement,
} from "../src/index";

const dialect = new ClickHouseDialect();
const parseStatementFn = parseStatement;
const parseSqlFn = parseSql;
const toSqlFn = toSql;

type ParsedStatements = Statement | Statement[];

type BenchmarkCase = {
  label: string;
  parse: () => ParsedStatements;
  generate: () => string;
};

function parseOne(sql: string): Statement {
  return parseStatementFn(sql, { dialect });
}

function parseMany(sql: string): Statement[] {
  return parseSqlFn(sql, { dialect });
}

function serialize(parsed: ParsedStatements): string {
  return Array.isArray(parsed)
    ? parsed.map((statement) => toSqlFn(statement)).join("; ")
    : toSqlFn(parsed);
}

function createStatementCase(label: string, sql: string): BenchmarkCase {
  const prepared = parseOne(sql);
  return {
    label,
    parse: () => parseOne(sql),
    generate: () => serialize(prepared),
  };
}

function createMultiStatementCase(label: string, sql: string): BenchmarkCase {
  const prepared = parseMany(sql);
  return {
    label,
    parse: () => parseMany(sql),
    generate: () => serialize(prepared),
  };
}

function assertParsed(parsed: ParsedStatements): number {
  return Array.isArray(parsed) ? parsed.length : parsed.kind.length;
}

const benchmarkCases: BenchmarkCase[] = [
  createStatementCase("tiny / select limit", "SELECT * FROM sample_events LIMIT 10"),
  createStatementCase(
    "small / clause-heavy select",
    "SELECT * FROM events FINAL PREWHERE team_id = 1 WHERE success = true ORDER BY ts DESC LIMIT 1 BY user_id SETTINGS max_threads = 2 FORMAT JSONEachRow",
  ),
  createStatementCase(
    "medium / named window",
    "SELECT\n    user_id,\n    event_name,\n    event_value,\n    SUM(event_value) OVER w AS running_sum,\n    AVG(event_value) OVER w AS running_avg\nFROM sample_events\nWINDOW w AS (PARTITION BY user_id ORDER BY timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)\nORDER BY user_id, timestamp",
  ),
  createStatementCase(
    "large / multi-level cte",
    "WITH\n    daily AS (\n        SELECT\n            toDate(timestamp) AS day,\n            user_id,\n            COUNT(*) AS daily_events\n        FROM sample_events\n        GROUP BY day, user_id\n    ),\n    user_stats AS (\n        SELECT\n            user_id,\n            AVG(daily_events) AS avg_daily,\n            MAX(daily_events) AS max_daily\n        FROM daily\n        GROUP BY user_id\n    )\nSELECT\n    user_id,\n    avg_daily,\n    max_daily,\n    max_daily / avg_daily AS burst_ratio\nFROM user_stats\nWHERE avg_daily > 5\nORDER BY burst_ratio DESC\nLIMIT 20",
  ),
  createMultiStatementCase(
    "xlarge / aggregating mv",
    "CREATE TABLE events_daily_agg (\n    day Date,\n    event_name LowCardinality(String),\n    count_state AggregateFunction(count),\n    uniq_users_state AggregateFunction(uniq, UInt64),\n    sum_value_state AggregateFunction(sum, Float64)\n) ENGINE = AggregatingMergeTree()\nORDER BY (day, event_name);\n\nCREATE MATERIALIZED VIEW events_daily_mv TO events_daily_agg AS\nSELECT\n    toDate(timestamp) AS day,\n    event_name,\n    countState() AS count_state,\n    uniqState(user_id) AS uniq_users_state,\n    sumState(event_value) AS sum_value_state\nFROM sample_events\nGROUP BY day, event_name;",
  ),
];

describe("parse", () => {
  for (const benchmarkCase of benchmarkCases) {
    bench(benchmarkCase.label, () => {
      if (assertParsed(benchmarkCase.parse()) === 0) {
        throw new Error("expected parsed output");
      }
    });
  }
});

describe("generate", () => {
  for (const benchmarkCase of benchmarkCases) {
    bench(benchmarkCase.label, () => {
      if (benchmarkCase.generate().length === 0) {
        throw new Error("expected serialized SQL");
      }
    });
  }
});
