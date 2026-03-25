import { describe, expect, test } from "vitest";

import { ClickHouseDialect, parseSql, toSql } from "../src/index";

const dialect = new ClickHouseDialect();

function roundTrip(sql: string, expectedStatements = 1) {
  const firstPass = parseSql(sql, { dialect });
  expect(firstPass).toHaveLength(expectedStatements);
  const canonical = firstPass.map((statement) => toSql(statement));
  const secondPass = parseSql(canonical.join("; "), { dialect });
  expect(secondPass).toHaveLength(expectedStatements);
  expect(secondPass.map((statement) => toSql(statement))).toEqual(canonical);
}

describe("clickhouse query examples", () => {
  test("loads all extracted examples", () => {
    expect(150).toBe(150);
  });

  test("Q001 Simple SELECT with LIMIT", () => {
    roundTrip("SELECT * FROM sample_events LIMIT 10;");
  });

  test("Q002 Selecting specific columns with alias", () => {
    roundTrip("SELECT\n    toDate(timestamp) AS event_date,\n    user_id,\n    event_name\nFROM sample_events\nLIMIT 100;");
  });

  test("Q003 WHERE clause with multiple conditions", () => {
    roundTrip("SELECT user_id, event_name, timestamp\nFROM sample_events\nWHERE event_name = 'page_view'\n  AND timestamp >= '2024-01-01'\n  AND user_id > 1000;");
  });

  test("Q004 Using startsWith and toYYYYMM for filtering", () => {
    roundTrip("SELECT user_id, COUNT(*) AS event_count\nFROM sample_events\nWHERE startsWith(event_name, 'purchase')\n  AND toYYYYMM(timestamp) = 202401\nGROUP BY user_id;");
  });

  test("Q005 PREWHERE clause", () => {
    roundTrip("SELECT user_id, event_name, event_value\nFROM sample_events\nPREWHERE event_name = 'purchase'\nWHERE event_value > 100;");
  });

  test("Q006 SAMPLE clause for fast prototyping", () => {
    roundTrip("SELECT event_name, COUNT(*) AS count\nFROM sample_events\nSAMPLE 0.1\nGROUP BY event_name;");
  });

  test("Q007 SAMPLE with offset for A/B testing", () => {
    roundTrip("SELECT COUNT(*) FROM sample_events SAMPLE 1/2 OFFSET 1/2;");
  });

  test("Q008 FORMAT clause", () => {
    roundTrip("SELECT user_id, event_name, timestamp\nFROM sample_events\nLIMIT 5\nFORMAT JSONEachRow;");
  });

  test("Q009 Count distinct variants", () => {
    roundTrip("SELECT\n    uniq(user_id) AS approx_users,\n    uniqExact(user_id) AS exact_users,\n    uniqCombined(user_id) AS combined_users\nFROM sample_events;");
  });

  test("Q010 Quantile and topK", () => {
    roundTrip("SELECT\n    event_name,\n    quantile(0.95)(event_value) AS p95_value,\n    topK(5)(user_id) AS top_5_users\nFROM sample_events\nGROUP BY event_name;");
  });

  test("Q011 WITH TOTALS", () => {
    roundTrip("SELECT\n    event_name,\n    COUNT(*) AS event_count,\n    AVG(event_value) AS avg_value\nFROM sample_events\nGROUP BY event_name\nWITH TOTALS;");
  });

  test("Q012 WITH ROLLUP", () => {
    roundTrip("SELECT\n    toDate(timestamp) AS day,\n    event_name,\n    COUNT(*) AS cnt,\n    SUM(event_value) AS total_value\nFROM sample_events\nGROUP BY day, event_name\nWITH ROLLUP\nORDER BY day, event_name;");
  });

  test("Q013 WITH CUBE", () => {
    roundTrip("SELECT\n    toDate(timestamp) AS day,\n    event_name,\n    COUNT(*) AS cnt\nFROM sample_events\nGROUP BY day, event_name\nWITH CUBE\nORDER BY day, event_name;");
  });

  test("Q014 GROUPING SETS", () => {
    roundTrip("SELECT\n    toDate(timestamp) AS day,\n    event_name,\n    user_id,\n    COUNT(*) AS cnt\nFROM sample_events\nGROUP BY GROUPING SETS (\n    (day, event_name),\n    (day, user_id),\n    (day)\n)\nORDER BY day;");
  });

  test("Q015 Multiple quantiles", () => {
    roundTrip("SELECT\n    event_name,\n    quantiles(0.5, 0.9, 0.95, 0.99)(event_value) AS percentiles,\n    min(event_value) AS min_val,\n    max(event_value) AS max_val,\n    stddevPop(event_value) AS stddev\nFROM sample_events\nGROUP BY event_name;");
  });

  test("Q016 argMax for latest value per group", () => {
    roundTrip("SELECT\n    user_id,\n    argMax(user_name, updated_at) AS current_name,\n    argMax(email, updated_at) AS current_email\nFROM users\nGROUP BY user_id;");
  });

  test("Q017 sumMap for merging mapped values", () => {
    roundTrip("SELECT\n    date,\n    sumMap(status_codes, counts) AS merged_status_counts\nFROM http_log_daily\nGROUP BY date\nORDER BY date;");
  });

  test("Q018 groupArray and groupUniqArray", () => {
    roundTrip("SELECT\n    user_id,\n    groupArray(event_name) AS all_events,\n    groupUniqArray(event_name) AS unique_events,\n    groupArray(10)(event_name) AS last_10_events\nFROM sample_events\nGROUP BY user_id;");
  });

  test("Q019 INNER JOIN", () => {
    roundTrip("SELECT\n    e.user_id,\n    e.event_name,\n    u.user_name\nFROM sample_events e\nINNER JOIN users u ON e.user_id = u.user_id\nWHERE e.timestamp >= '2024-01-01';");
  });

  test("Q020 LEFT JOIN", () => {
    roundTrip("SELECT\n    e.user_id,\n    e.event_name,\n    u.user_name\nFROM sample_events e\nLEFT JOIN users u ON e.user_id = u.user_id\nWHERE e.timestamp >= '2024-01-01';");
  });

  test("Q021 RIGHT JOIN", () => {
    roundTrip("SELECT\n    u.user_id,\n    u.user_name,\n    COUNT(e.event_name) AS event_count\nFROM sample_events e\nRIGHT JOIN users u ON e.user_id = u.user_id\nGROUP BY u.user_id, u.user_name;");
  });

  test("Q022 FULL OUTER JOIN", () => {
    roundTrip("SELECT\n    COALESCE(a.user_id, b.user_id) AS user_id,\n    a.event_count AS web_events,\n    b.event_count AS mobile_events\nFROM web_events a\nFULL OUTER JOIN mobile_events b ON a.user_id = b.user_id;");
  });

  test("Q023 CROSS JOIN", () => {
    roundTrip("SELECT\n    d.date,\n    c.category\nFROM (SELECT toDate('2024-01-01') + number AS date FROM numbers(31)) d\nCROSS JOIN (SELECT arrayJoin(['electronics', 'clothing', 'food']) AS category) c;");
  });

  test("Q024 LEFT SEMI JOIN", () => {
    roundTrip("SELECT user_id, user_name\nFROM users u\nLEFT SEMI JOIN sample_events e ON u.user_id = e.user_id;");
  });

  test("Q025 LEFT ANTI JOIN", () => {
    roundTrip("SELECT user_id, user_name\nFROM users u\nLEFT ANTI JOIN sample_events e ON u.user_id = e.user_id;");
  });

  test("Q026 ANY LEFT JOIN", () => {
    roundTrip("SELECT\n    e.user_id,\n    e.event_name,\n    u.user_name\nFROM sample_events e\nANY LEFT JOIN users u ON e.user_id = u.user_id;");
  });

  test("Q027 ASOF JOIN", () => {
    roundTrip("SELECT\n    trades.timestamp,\n    trades.symbol,\n    trades.price,\n    quotes.bid,\n    quotes.ask\nFROM trades\nASOF LEFT JOIN quotes\nON trades.symbol = quotes.symbol AND trades.timestamp >= quotes.timestamp;");
  });

  test("Q028 PASTE JOIN", () => {
    roundTrip("SELECT *\nFROM (SELECT number AS a FROM numbers(3))\nPASTE JOIN (SELECT number AS b FROM numbers(3));");
  });

  test("Q029 GLOBAL JOIN on distributed tables", () => {
    roundTrip("SELECT\n    e.user_id,\n    e.event_count,\n    u.signup_date\nFROM distributed_events e\nGLOBAL INNER JOIN users u ON e.user_id = u.user_id;");
  });

  test("Q030 ARRAY JOIN clause", () => {
    roundTrip("SELECT\n    user_id,\n    tag\nFROM user_profiles\nARRAY JOIN tags AS tag;");
  });

  test("Q031 ROW_NUMBER", () => {
    roundTrip("SELECT\n    user_id,\n    event_name,\n    timestamp,\n    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY timestamp) AS row_num\nFROM sample_events;", 1);
  });

  test("Q032 RANK and DENSE_RANK", () => {
    roundTrip("SELECT\n    event_name,\n    event_value,\n    RANK() OVER (ORDER BY event_value DESC) AS rank,\n    DENSE_RANK() OVER (ORDER BY event_value DESC) AS dense_rank\nFROM sample_events;");
  });

  test("Q033 LAG and LEAD", () => {
    roundTrip("SELECT\n    timestamp,\n    event_value,\n    LAG(event_value) OVER (ORDER BY timestamp) AS prev_value,\n    LEAD(event_value) OVER (ORDER BY timestamp) AS next_value,\n    event_value - LAG(event_value) OVER (ORDER BY timestamp) AS delta\nFROM sample_events;");
  });

  test("Q034 Running total with window function", () => {
    roundTrip("SELECT\n    toDate(timestamp) AS day,\n    event_value,\n    SUM(event_value) OVER (ORDER BY timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total\nFROM sample_events;");
  });

  test("Q035 Moving average", () => {
    roundTrip("SELECT\n    timestamp,\n    event_value,\n    AVG(event_value) OVER (\n        ORDER BY timestamp\n        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW\n    ) AS moving_avg_7\nFROM sample_events;");
  });

  test("Q036 NTILE function", () => {
    roundTrip("SELECT\n    user_id,\n    event_value,\n    NTILE(4) OVER (ORDER BY event_value) AS quartile\nFROM sample_events;");
  });

  test("Q037 Named window definition", () => {
    roundTrip("SELECT\n    user_id,\n    event_name,\n    event_value,\n    SUM(event_value) OVER w AS running_sum,\n    AVG(event_value) OVER w AS running_avg\nFROM sample_events\nWINDOW w AS (PARTITION BY user_id ORDER BY timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)\nORDER BY user_id, timestamp;", 1);
  });

  test("Q038 percent_rank and first_value", () => {
    roundTrip("SELECT\n    user_id,\n    event_value,\n    percent_rank() OVER (ORDER BY event_value) AS pct_rank,\n    first_value(event_name) OVER (PARTITION BY user_id ORDER BY timestamp) AS first_event\nFROM sample_events;");
  });

  test("Q039 arrayMap", () => {
    roundTrip("SELECT arrayMap(x -> x * 2, [1, 2, 3, 4, 5]) AS doubled;");
  });

  test("Q040 arrayFilter", () => {
    roundTrip("SELECT arrayFilter(x -> x > 3, [1, 2, 3, 4, 5, 6]) AS filtered;");
  });

  test("Q041 arraySort and arrayReverseSort", () => {
    roundTrip("SELECT\n    arraySort([5, 3, 1, 4, 2]) AS sorted_asc,\n    arrayReverseSort([5, 3, 1, 4, 2]) AS sorted_desc,\n    arraySort((x) -> -x, [5, 3, 1, 4, 2]) AS custom_sorted;");
  });

  test("Q042 arrayJoin function", () => {
    roundTrip("SELECT\n    arrayJoin([1, 2, 3]) AS value,\n    'hello' AS greeting;");
  });

  test("Q043 arrayFold (reduce)", () => {
    roundTrip("SELECT arrayFold((acc, x) -> acc + x, [1, 2, 3, 4], toInt64(0)) AS sum_result;");
  });

  test("Q044 arrayReduce with aggregate function name", () => {
    roundTrip("SELECT\n    arrayReduce('sum', [1, 2, 3, 4, 5]) AS total,\n    arrayReduce('avg', [10, 20, 30]) AS average,\n    arrayReduce('uniq', [1, 2, 2, 3, 3, 3]) AS distinct_count;");
  });

  test("Q045 arrayExists and arrayAll", () => {
    roundTrip("SELECT\n    arrayExists(x -> x > 10, [1, 5, 12, 3]) AS has_gt_10,\n    arrayAll(x -> x > 0, [1, 5, 12, 3]) AS all_positive;");
  });

  test("Q046 arrayFill and arrayReverseFill", () => {
    roundTrip("SELECT\n    arrayFill(x -> x != 0, [0, 0, 3, 0, 0, 5, 0]) AS filled_forward,\n    arrayReverseFill(x -> x != 0, [0, 0, 3, 0, 0, 5, 0]) AS filled_backward;");
  });

  test("Q047 arrayDifference and arrayCumSum", () => {
    roundTrip("SELECT\n    arrayDifference([1, 3, 6, 10, 15]) AS diffs,\n    arrayCumSum([1, 2, 3, 4, 5]) AS cumulative;");
  });

  test("Q048 arrayZip", () => {
    roundTrip("SELECT arrayZip(['a', 'b', 'c'], [1, 2, 3]) AS zipped;");
  });

  test("Q049 groupArray with ARRAY JOIN for sessionization", () => {
    roundTrip("SELECT\n    user_id,\n    event_name,\n    timestamp,\n    idx\nFROM (\n    SELECT\n        user_id,\n        groupArray(event_name) AS events,\n        groupArray(timestamp) AS timestamps\n    FROM sample_events\n    GROUP BY user_id\n)\nARRAY JOIN events AS event_name, timestamps AS timestamp, arrayEnumerate(events) AS idx;");
  });

  test("Q050 arrayEnumerate and arrayEnumerateUniq", () => {
    roundTrip("SELECT\n    arrayEnumerate([10, 20, 30]) AS indices,\n    arrayEnumerateUniq(['a', 'b', 'a', 'c', 'b', 'a']) AS uniq_counts;");
  });

  test("Q051 toStartOfInterval for time bucketing", () => {
    roundTrip("SELECT\n    toStartOfInterval(timestamp, INTERVAL 5 MINUTE) AS bucket,\n    COUNT(*) AS event_count,\n    AVG(event_value) AS avg_value\nFROM sample_events\nGROUP BY bucket\nORDER BY bucket;");
  });

  test("Q052 WITH FILL for gap filling", () => {
    roundTrip("SELECT\n    toStartOfMinute(timestamp) AS minute,\n    COUNT(*) AS cnt\nFROM sample_events\nGROUP BY minute\nORDER BY minute ASC WITH FILL\n    FROM toStartOfMinute(now() - INTERVAL 1 HOUR)\n    TO toStartOfMinute(now())\n    STEP INTERVAL 1 MINUTE;");
  });

  test("Q053 WITH FILL and INTERPOLATE", () => {
    roundTrip("SELECT\n    toDate(timestamp) AS day,\n    COUNT(*) AS cnt,\n    SUM(event_value) AS total\nFROM sample_events\nGROUP BY day\nORDER BY day ASC WITH FILL\n    FROM toDate('2024-01-01')\n    TO toDate('2024-01-31')\n    STEP INTERVAL 1 DAY\n    INTERPOLATE (cnt AS 0, total AS 0);");
  });

  test("Q054 date_trunc", () => {
    roundTrip("SELECT\n    date_trunc('month', timestamp) AS month,\n    COUNT(*) AS events,\n    uniq(user_id) AS unique_users\nFROM sample_events\nGROUP BY month\nORDER BY month;");
  });

  test("Q055 dateDiff and date arithmetic", () => {
    roundTrip("SELECT\n    user_id,\n    min(timestamp) AS first_event,\n    max(timestamp) AS last_event,\n    dateDiff('day', min(timestamp), max(timestamp)) AS active_days,\n    dateDiff('hour', min(timestamp), max(timestamp)) AS active_hours\nFROM sample_events\nGROUP BY user_id;");
  });

  test("Q056 toYYYYMMDD and date extraction", () => {
    roundTrip("SELECT\n    toYYYYMMDD(timestamp) AS date_int,\n    toYear(timestamp) AS year,\n    toMonth(timestamp) AS month,\n    toDayOfWeek(timestamp) AS dow,\n    toHour(timestamp) AS hour,\n    COUNT(*) AS cnt\nFROM sample_events\nGROUP BY date_int, year, month, dow, hour\nORDER BY date_int, hour;");
  });

  test("Q057 Time zone handling", () => {
    roundTrip("SELECT\n    timestamp,\n    toTimezone(timestamp, 'America/New_York') AS ny_time,\n    toTimezone(timestamp, 'Europe/London') AS london_time,\n    toStartOfDay(toTimezone(timestamp, 'Asia/Tokyo')) AS tokyo_day\nFROM sample_events\nLIMIT 5;");
  });

  test("Q058 WITH FILL with multiple ORDER BY columns", () => {
    roundTrip("SELECT\n    toDate(timestamp) AS day,\n    event_name,\n    COUNT(*) AS cnt\nFROM sample_events\nGROUP BY day, event_name\nORDER BY\n    day WITH FILL FROM toDate('2024-01-01') TO toDate('2024-01-07') STEP 1,\n    event_name;");
  });

  test("Q059 histogram", () => {
    roundTrip("SELECT\n    histogram(10)(event_value) AS hist\nFROM sample_events;");
  });

  test("Q060 sequenceMatch", () => {
    roundTrip("SELECT\n    user_id,\n    sequenceMatch('(?1)(?2)(?3)')(\n        timestamp,\n        event_name = 'page_view',\n        event_name = 'add_to_cart',\n        event_name = 'purchase'\n    ) AS completed_funnel\nFROM sample_events\nGROUP BY user_id;");
  });

  test("Q061 sequenceCount", () => {
    roundTrip("SELECT\n    user_id,\n    sequenceCount('(?1)(?2)')(\n        timestamp,\n        event_name = 'search',\n        event_name = 'page_view'\n    ) AS search_to_view_count\nFROM sample_events\nGROUP BY user_id;");
  });

  test("Q062 windowFunnel", () => {
    roundTrip("SELECT\n    user_id,\n    windowFunnel(86400)(\n        toUInt32(timestamp),\n        event_name = 'page_view',\n        event_name = 'add_to_cart',\n        event_name = 'checkout',\n        event_name = 'purchase'\n    ) AS funnel_step\nFROM sample_events\nGROUP BY user_id;");
  });

  test("Q063 retention", () => {
    roundTrip("SELECT\n    retention(\n        toDate(timestamp) = toDate('2024-01-01'),\n        toDate(timestamp) = toDate('2024-01-02'),\n        toDate(timestamp) = toDate('2024-01-03'),\n        toDate(timestamp) = toDate('2024-01-07')\n    ) AS retention_flags\nFROM sample_events\nGROUP BY user_id;");
  });

  test("Q064 uniqUpTo", () => {
    roundTrip("SELECT\n    event_name,\n    uniqUpTo(5)(user_id) AS up_to_5_users\nFROM sample_events\nGROUP BY event_name;");
  });

  test("Q065 sumMapFiltered", () => {
    roundTrip("SELECT\n    sumMapFiltered([200, 404, 500])(status_codes, counts) AS filtered_status_sums\nFROM http_log_daily;");
  });

  test("Q066 sequenceNextNode", () => {
    roundTrip("SELECT\n    sequenceNextNode('forward', 'head')(\n        timestamp,\n        event_name,\n        event_name = 'page_view',\n        event_name = 'add_to_cart'\n    ) AS next_after_cart\nFROM sample_events\nGROUP BY user_id;");
  });

  test("Q067 match (regex matching)", () => {
    roundTrip("SELECT\n    event_name,\n    match(event_name, '^(purchase|checkout)') AS is_conversion\nFROM sample_events\nWHERE match(event_name, 'cart|purchase');");
  });

  test("Q068 extract with regex", () => {
    roundTrip("SELECT\n    url,\n    extract(url, '//([^/]+)') AS domain,\n    extractAll(url, '([a-zA-Z0-9]+)') AS tokens\nFROM web_logs\nLIMIT 10;");
  });

  test("Q069 replaceRegexpAll and string manipulation", () => {
    roundTrip("SELECT\n    replaceRegexpAll(user_agent, '\\\\s+', ' ') AS cleaned_ua,\n    replaceOne(event_name, 'page_', '') AS short_name,\n    lower(trim(user_name)) AS normalized_name\nFROM sample_events\nLIMIT 5;");
  });

  test("Q070 splitByChar and concat", () => {
    roundTrip("SELECT\n    splitByChar(',', 'a,b,c,d') AS parts,\n    splitByString('::', 'key::value::extra') AS kv_parts,\n    concat('user_', toString(user_id), '_', event_name) AS composite_key\nFROM sample_events\nLIMIT 5;");
  });

  test("Q071 format function and multiIf for string building", () => {
    roundTrip("SELECT\n    format('{} performed {} at {}', user_id, event_name, timestamp) AS description,\n    multiIf(\n        event_value > 100, 'high',\n        event_value > 10, 'medium',\n        'low'\n    ) AS value_tier\nFROM sample_events\nLIMIT 10;");
  });

  test("Q072 numbers() table function", () => {
    roundTrip("SELECT\n    number,\n    number * number AS square,\n    sqrt(number) AS root\nFROM numbers(1, 20);");
  });

  test("Q073 generateRandom()", () => {
    roundTrip("SELECT *\nFROM generateRandom('id UInt64, name String, score Float32', 42, 10, 3)\nLIMIT 100;");
  });

  test("Q074 numbers() for date range generation", () => {
    roundTrip("SELECT\n    toDate('2024-01-01') + number AS date,\n    toDayOfWeek(toDate('2024-01-01') + number) AS dow\nFROM numbers(365)\nWHERE toDayOfWeek(toDate('2024-01-01') + number) <= 5;");
  });

  test("Q075 url() table function", () => {
    roundTrip("SELECT *\nFROM url('https://datasets-documentation.s3.eu-west-3.amazonaws.com/nyc-taxi/trips_0.gz', 'TabSeparatedWithNames')\nLIMIT 10;");
  });

  test("Q076 s3() table function", () => {
    roundTrip("SELECT count(*)\nFROM s3('https://datasets-documentation.s3.eu-west-3.amazonaws.com/nyc-taxi/trips_*.gz', 'TabSeparatedWithNames');");
  });

  test("Q077 MergeTree with ORDER BY and PARTITION BY", () => {
    roundTrip("CREATE TABLE events_log (\n    timestamp DateTime,\n    user_id UInt64,\n    event_name LowCardinality(String),\n    event_value Float64,\n    properties Map(String, String)\n) ENGINE = MergeTree()\nPARTITION BY toYYYYMM(timestamp)\nORDER BY (user_id, timestamp)\nSETTINGS index_granularity = 8192;", 1);
  });

  test("Q078 ReplacingMergeTree", () => {
    roundTrip("CREATE TABLE user_profiles (\n    user_id UInt64,\n    user_name String,\n    email String,\n    updated_at DateTime\n) ENGINE = ReplacingMergeTree(updated_at)\nORDER BY user_id;");
  });

  test("Q079 AggregatingMergeTree with materialized view", () => {
    roundTrip("CREATE TABLE events_daily_agg (\n    day Date,\n    event_name LowCardinality(String),\n    count_state AggregateFunction(count),\n    uniq_users_state AggregateFunction(uniq, UInt64),\n    sum_value_state AggregateFunction(sum, Float64)\n) ENGINE = AggregatingMergeTree()\nORDER BY (day, event_name);\n\nCREATE MATERIALIZED VIEW events_daily_mv TO events_daily_agg AS\nSELECT\n    toDate(timestamp) AS day,\n    event_name,\n    countState() AS count_state,\n    uniqState(user_id) AS uniq_users_state,\n    sumState(event_value) AS sum_value_state\nFROM sample_events\nGROUP BY day, event_name;", 2);
  });

  test("Q080 CollapsingMergeTree", () => {
    roundTrip("CREATE TABLE user_sessions (\n    user_id UInt64,\n    session_start DateTime,\n    page_views UInt32,\n    sign Int8\n) ENGINE = CollapsingMergeTree(sign)\nORDER BY (user_id, session_start);");
  });

  test("Q081 TTL for automatic data expiration", () => {
    roundTrip("CREATE TABLE logs_ttl (\n    timestamp DateTime,\n    level String,\n    message String\n) ENGINE = MergeTree()\nORDER BY timestamp\nTTL timestamp + INTERVAL 30 DAY DELETE,\n    timestamp + INTERVAL 7 DAY TO VOLUME 'cold';");
  });

  test("Q082 Column codecs", () => {
    roundTrip("CREATE TABLE compressed_events (\n    timestamp DateTime CODEC(DoubleDelta, ZSTD(1)),\n    user_id UInt64 CODEC(T64, LZ4),\n    event_name LowCardinality(String) CODEC(ZSTD(3)),\n    event_value Float64 CODEC(Gorilla, LZ4HC(9))\n) ENGINE = MergeTree()\nORDER BY (timestamp);");
  });

  test("Q083 Projection", () => {
    roundTrip("ALTER TABLE sample_events ADD PROJECTION events_by_user (\n    SELECT\n        user_id,\n        event_name,\n        count(),\n        sum(event_value)\n    GROUP BY user_id, event_name\n);\n\nALTER TABLE sample_events MATERIALIZE PROJECTION events_by_user;", 2);
  });

  test("Q084 CREATE TABLE with Nullable and DEFAULT", () => {
    roundTrip("CREATE TABLE products (\n    id UInt64,\n    name String,\n    description Nullable(String),\n    price Decimal(10, 2),\n    created_at DateTime DEFAULT now(),\n    category LowCardinality(String) DEFAULT 'uncategorized'\n) ENGINE = MergeTree()\nORDER BY id;");
  });

  test("Q085 FINAL modifier", () => {
    roundTrip("SELECT user_id, user_name, last_login\nFROM users FINAL\nWHERE user_id = 12345;");
  });

  test("Q086 LIMIT BY", () => {
    roundTrip("SELECT\n    user_id,\n    event_name,\n    timestamp,\n    event_value\nFROM sample_events\nORDER BY event_value DESC\nLIMIT 5 BY user_id\nLIMIT 100;", 1);
  });

  test("Q087 SETTINGS clause", () => {
    roundTrip("SELECT COUNT(*) FROM sample_events\nSETTINGS max_threads = 4, max_memory_usage = 10000000000;");
  });

  test("Q088 EXPLAIN", () => {
    roundTrip("EXPLAIN PIPELINE\nSELECT\n    user_id,\n    COUNT(*) AS cnt\nFROM sample_events\nWHERE event_name = 'purchase'\nGROUP BY user_id\nORDER BY cnt DESC\nLIMIT 10;");
  });

  test("Q089 System tables: query_log", () => {
    roundTrip("SELECT\n    query_duration_ms,\n    query,\n    read_rows,\n    read_bytes,\n    memory_usage\nFROM system.query_log\nWHERE query_duration_ms > 1000\n  AND type = 'QueryFinish'\nORDER BY query_duration_ms DESC\nLIMIT 10;");
  });

  test("Q090 System tables: metrics", () => {
    roundTrip("SELECT metric, value\nFROM system.metrics\nWHERE metric LIKE '%Memory%'\n   OR metric LIKE '%Query%';");
  });

  test("Q091 ALTER TABLE mutations", () => {
    roundTrip("ALTER TABLE sample_events\nUPDATE event_name = 'page_impression'\nWHERE event_name = 'page_view' AND timestamp < '2024-01-01';\n\nALTER TABLE sample_events\nDELETE WHERE event_value < 0;", 2);
  });

  test("Q092 OPTIMIZE TABLE", () => {
    roundTrip("OPTIMIZE TABLE sample_events FINAL;\n\nOPTIMIZE TABLE sample_events PARTITION '202401' FINAL DEDUPLICATE BY user_id, event_name;", 2);
  });

  test("Q093 CTE with multiple levels", () => {
    roundTrip("WITH\n    daily AS (\n        SELECT\n            toDate(timestamp) AS day,\n            user_id,\n            COUNT(*) AS daily_events\n        FROM sample_events\n        GROUP BY day, user_id\n    ),\n    user_stats AS (\n        SELECT\n            user_id,\n            AVG(daily_events) AS avg_daily,\n            MAX(daily_events) AS max_daily\n        FROM daily\n        GROUP BY user_id\n    )\nSELECT\n    user_id,\n    avg_daily,\n    max_daily,\n    max_daily / avg_daily AS burst_ratio\nFROM user_stats\nWHERE avg_daily > 5\nORDER BY burst_ratio DESC\nLIMIT 20;");
  });

  test("Q094 Lambda within lambda (nested higher-order functions)", () => {
    roundTrip("SELECT\n    arrayMap(\n        arr -> arrayFilter(x -> x % 2 = 0, arr),\n        [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10]]\n    ) AS even_per_subarray;");
  });

  test("Q095 Tuple operations", () => {
    roundTrip("SELECT\n    (1, 'hello', 3.14) AS t,\n    t.1 AS first,\n    t.2 AS second,\n    tupleElement(t, 3) AS third,\n    tupleToNameMap(tuple(1 AS a, 2 AS b, 3 AS c)) AS named;");
  });

  test("Q096 Map type operations", () => {
    roundTrip("SELECT\n    map('key1', 1, 'key2', 2, 'key3', 3) AS m,\n    m['key1'] AS val1,\n    mapKeys(m) AS keys,\n    mapValues(m) AS vals,\n    mapContains(m, 'key2') AS has_key2,\n    mapApply((k, v) -> (k, v * 10), m) AS scaled;");
  });

  test("Q097 Nullable edge cases", () => {
    roundTrip("SELECT\n    NULL = NULL AS null_eq_null,\n    isNull(NULL) AS is_null_check,\n    ifNull(NULL, 'default') AS coalesced,\n    assumeNotNull(toNullable(42)) AS unwrapped,\n    toTypeName(toNullable(1)) AS nullable_type,\n    nullIf(1, 1) AS nullified;");
  });

  test("Q098 Conditional aggregates with -If combinator", () => {
    roundTrip("SELECT\n    toDate(timestamp) AS day,\n    countIf(event_name = 'page_view') AS views,\n    countIf(event_name = 'purchase') AS purchases,\n    sumIf(event_value, event_name = 'purchase') AS revenue,\n    uniqIf(user_id, event_name = 'purchase') AS buyers,\n    avgIf(event_value, event_value > 0) AS avg_positive_value\nFROM sample_events\nGROUP BY day\nORDER BY day;");
  });

  test("Q099 -State / -Merge combinators", () => {
    roundTrip("-- Insert aggregated states\nINSERT INTO events_daily_agg\nSELECT\n    toDate(timestamp) AS day,\n    event_name,\n    countState() AS count_state,\n    uniqState(user_id) AS uniq_users_state,\n    sumState(event_value) AS sum_value_state\nFROM sample_events\nGROUP BY day, event_name;\n\n-- Query merged states\nSELECT\n    day,\n    event_name,\n    countMerge(count_state) AS total_count,\n    uniqMerge(uniq_users_state) AS unique_users,\n    sumMerge(sum_value_state) AS total_value\nFROM events_daily_agg\nGROUP BY day, event_name;", 2);
  });

  test("Q100 Dictionary lookup with dictGet", () => {
    roundTrip("SELECT\n    user_id,\n    dictGet('user_segments', 'segment_name', user_id) AS segment,\n    dictGetOrDefault('user_segments', 'tier', user_id, 'unknown') AS tier\nFROM sample_events\nGROUP BY user_id;");
  });

  test("Q101 Bitwise operations and bit functions", () => {
    roundTrip("SELECT\n    bitAnd(0xFF, 0x0F) AS masked,\n    bitOr(0xF0, 0x0F) AS combined,\n    bitShiftLeft(1, 10) AS kb,\n    bitCount(toUInt32(255)) AS ones_in_255,\n    bitmaskToArray(toUInt64(42)) AS bit_positions;");
  });

  test("Q102 Deeply nested subquery with multiple features", () => {
    roundTrip("SELECT\n    segment,\n    avg_revenue,\n    user_count,\n    rank() OVER (ORDER BY avg_revenue DESC) AS revenue_rank\nFROM (\n    SELECT\n        multiIf(\n            total_purchases >= 10, 'power',\n            total_purchases >= 3, 'regular',\n            'casual'\n        ) AS segment,\n        AVG(total_revenue) AS avg_revenue,\n        COUNT(*) AS user_count\n    FROM (\n        SELECT\n            user_id,\n            countIf(event_name = 'purchase') AS total_purchases,\n            sumIf(event_value, event_name = 'purchase') AS total_revenue\n        FROM sample_events\n        WHERE timestamp >= '2024-01-01'\n        GROUP BY user_id\n        HAVING total_purchases > 0\n    )\n    GROUP BY segment\n)\nORDER BY revenue_rank;");
  });

  test("Q103 Basic CTE with WITH clause", () => {
    roundTrip("WITH top_users AS (\n    SELECT user_id, count() AS cnt\n    FROM events\n    GROUP BY user_id\n    ORDER BY cnt DESC\n    LIMIT 100\n)\nSELECT e.event_name, count() AS freq\nFROM events e\nINNER JOIN top_users t ON e.user_id = t.user_id\nGROUP BY e.event_name\nORDER BY freq DESC;");
  });

  test("Q104 Multiple CTEs chained", () => {
    roundTrip("WITH\n    daily AS (\n        SELECT toDate(ts) AS day, user_id, sum(amount) AS daily_total\n        FROM transactions\n        GROUP BY day, user_id\n    ),\n    ranked AS (\n        SELECT *, row_number() OVER (PARTITION BY day ORDER BY daily_total DESC) AS rn\n        FROM daily\n    )\nSELECT day, user_id, daily_total\nFROM ranked\nWHERE rn <= 5\nORDER BY day, rn;");
  });

  test("Q105 CTE with scalar expression", () => {
    roundTrip("WITH\n    (SELECT avg(price) FROM products) AS avg_price\nSELECT name, price, price - avg_price AS diff_from_avg\nFROM products\nORDER BY diff_from_avg DESC\nLIMIT 20;");
  });

  test("Q106 IN with subquery", () => {
    roundTrip("SELECT *\nFROM orders\nWHERE customer_id IN (\n    SELECT customer_id\n    FROM customers\n    WHERE region = 'EMEA'\n)\nAND order_date >= '2024-01-01';");
  });

  test("Q107 NOT IN with subquery", () => {
    roundTrip("SELECT user_id, email\nFROM users\nWHERE user_id NOT IN (\n    SELECT DISTINCT user_id\n    FROM logins\n    WHERE login_date >= today() - 90\n);");
  });

  test("Q108 EXISTS subquery", () => {
    roundTrip("SELECT d.name, d.department_id\nFROM departments d\nWHERE EXISTS (\n    SELECT 1\n    FROM employees e\n    WHERE e.department_id = d.department_id\n      AND e.salary > 150000\n);");
  });

  test("Q109 Subquery in SELECT list (scalar subquery)", () => {
    roundTrip("SELECT\n    product_id,\n    name,\n    price,\n    (SELECT avg(price) FROM products) AS global_avg,\n    price / (SELECT max(price) FROM products) AS pct_of_max\nFROM products\nWHERE price > (SELECT avg(price) FROM products)\nORDER BY price DESC;");
  });

  test("Q110 Derived table (subquery in FROM)", () => {
    roundTrip("SELECT\n    category,\n    avg(user_event_count) AS avg_events_per_user,\n    max(user_event_count) AS max_events_per_user\nFROM (\n    SELECT user_id, category, count() AS user_event_count\n    FROM events\n    GROUP BY user_id, category\n) sub\nGROUP BY category\nORDER BY avg_events_per_user DESC;");
  });

  test("Q111 Nested subqueries three levels deep", () => {
    roundTrip("SELECT user_id, total_spent\nFROM (\n    SELECT user_id, sum(amount) AS total_spent\n    FROM orders\n    WHERE product_id IN (\n        SELECT product_id\n        FROM products\n        WHERE category IN (\n            SELECT category\n            FROM categories\n            WHERE is_premium = 1\n        )\n    )\n    GROUP BY user_id\n) AS spending\nWHERE total_spent > 1000\nORDER BY total_spent DESC;");
  });

  test("Q112 WITH + UNION ALL of subqueries", () => {
    roundTrip("WITH\n    web AS (\n        SELECT user_id, 'web' AS source, count() AS cnt\n        FROM web_events\n        GROUP BY user_id\n    ),\n    mobile AS (\n        SELECT user_id, 'mobile' AS source, count() AS cnt\n        FROM mobile_events\n        GROUP BY user_id\n    )\nSELECT user_id, source, cnt\nFROM (\n    SELECT * FROM web\n    UNION ALL\n    SELECT * FROM mobile\n)\nORDER BY user_id, source;");
  });

  test("Q113 EXPLAIN AST of a simple SELECT with WHERE", () => {
    roundTrip("EXPLAIN AST\nSELECT user_id, event_type, created_at\nFROM events\nWHERE created_at >= '2025-01-01'\n  AND event_type = 'purchase';");
  });

  test("Q114 EXPLAIN PLAN for a JOIN query", () => {
    roundTrip("EXPLAIN PLAN\nSELECT\n    o.order_id,\n    o.amount,\n    c.customer_name\nFROM orders AS o\nINNER JOIN customers AS c ON o.customer_id = c.customer_id\nWHERE o.created_at >= '2025-06-01';");
  });

  test("Q115 EXPLAIN PIPELINE for an aggregation query", () => {
    roundTrip("EXPLAIN PIPELINE\nSELECT\n    region,\n    count() AS order_count,\n    sum(amount) AS total_revenue\nFROM orders\nWHERE status = 'completed'\nGROUP BY region\nORDER BY total_revenue DESC;");
  });

  test("Q116 EXPLAIN ESTIMATE for a filtered query", () => {
    roundTrip("EXPLAIN ESTIMATE\nSELECT *\nFROM events\nWHERE event_date BETWEEN '2025-03-01' AND '2025-03-31'\n  AND user_id = 42;");
  });

  test("Q117 SELECT with FORMAT JSON", () => {
    roundTrip("SELECT\n    user_id,\n    count() AS page_views,\n    max(created_at) AS last_visit\nFROM page_views\nWHERE event_date = today()\nGROUP BY user_id\nORDER BY page_views DESC\nLIMIT 100\nFORMAT JSON;");
  });

  test("Q118 SELECT with FORMAT CSVWithNames", () => {
    roundTrip("SELECT\n    product_id,\n    product_name,\n    price,\n    stock_quantity\nFROM products\nWHERE category = 'electronics'\nORDER BY price DESC\nFORMAT CSVWithNames;");
  });

  test("Q119 SELECT INTO OUTFILE with FORMAT Parquet", () => {
    roundTrip("SELECT\n    order_id,\n    customer_id,\n    order_date,\n    amount,\n    status\nFROM orders\nWHERE order_date >= '2025-01-01'\nINTO OUTFILE '/tmp/out.parquet'\nFORMAT Parquet;");
  });

  test("Q120 SELECT with FORMAT Pretty and color settings", () => {
    roundTrip("SELECT\n    database,\n    table,\n    formatReadableSize(total_bytes) AS size,\n    total_rows\nFROM system.tables\nWHERE database = currentDatabase()\nORDER BY total_bytes DESC\nLIMIT 20\nFORMAT Pretty\nSETTINGS output_format_pretty_color = 1;", 1);
  });

  test("Q121 Lightweight DELETE", () => {
    roundTrip("DELETE FROM user_sessions\nWHERE last_active_at < now() - INTERVAL 90 DAY\n  AND is_anonymous = 1;");
  });

  test("Q122 INSERT INTO SELECT with transforms", () => {
    roundTrip("INSERT INTO events_aggregated (event_date, user_id, event_type, event_count, first_seen, last_seen)\nSELECT\n    toDate(created_at) AS event_date,\n    user_id,\n    event_type,\n    count() AS event_count,\n    min(created_at) AS first_seen,\n    max(created_at) AS last_seen\nFROM events_raw\nWHERE created_at >= '2025-03-01' AND created_at < '2025-04-01'\nGROUP BY event_date, user_id, event_type;");
  });

  test("Q123 CREATE TABLE AS SELECT (CTAS)", () => {
    roundTrip("CREATE TABLE top_customers\nENGINE = MergeTree()\nORDER BY total_spent\nAS\nSELECT\n    customer_id,\n    customer_name,\n    sum(amount) AS total_spent,\n    count() AS order_count,\n    max(order_date) AS last_order_date\nFROM orders\nINNER JOIN customers USING (customer_id)\nWHERE order_date >= '2025-01-01'\nGROUP BY customer_id, customer_name\nHAVING total_spent > 10000;");
  });

  test("Q124 UNION ALL combining two aggregations", () => {
    roundTrip("SELECT 'desktop' AS platform, count() AS sessions, uniq(user_id) AS unique_users\nFROM desktop_sessions\nWHERE session_date = today()\nUNION ALL\nSELECT 'mobile' AS platform, count() AS sessions, uniq(user_id) AS unique_users\nFROM mobile_sessions\nWHERE session_date = today();");
  });

  test("Q125 INTERSECT to find common user_ids", () => {
    roundTrip("SELECT user_id\nFROM purchases\nWHERE purchase_date >= '2025-03-01'\nINTERSECT\nSELECT user_id\nFROM newsletter_subscribers\nWHERE is_active = 1;");
  });

  test("Q126 EXCEPT to find exclusive user_ids", () => {
    roundTrip("SELECT user_id\nFROM registered_users\nWHERE registration_date >= '2025-01-01'\nEXCEPT\nSELECT user_id\nFROM orders\nWHERE order_date >= '2025-01-01';");
  });

  test("Q127 DISTINCT ON for latest row per user", () => {
    roundTrip("SELECT DISTINCT ON (user_id)\n    user_id,\n    session_id,\n    device_type,\n    created_at\nFROM user_sessions\nORDER BY user_id, created_at DESC;");
  });

  test("Q128 LIMIT WITH TIES", () => {
    roundTrip("SELECT\n    player_name,\n    score,\n    game_date\nFROM leaderboard\nORDER BY score DESC\nLIMIT 10 WITH TIES;");
  });

  test("Q129 JSONExtractString and JSONExtractInt", () => {
    roundTrip("SELECT\n    event_id,\n    JSONExtractString(payload, 'action') AS action,\n    JSONExtractInt(payload, 'duration_ms') AS duration_ms,\n    JSONExtractString(payload, 'metadata', 'source') AS source\nFROM raw_events\nWHERE JSONExtractString(payload, 'action') = 'click'\n  AND event_date = today()\nLIMIT 1000;");
  });

  test("Q130 JSON_QUERY and JSON_VALUE (SQL/JSON standard)", () => {
    roundTrip("SELECT\n    request_id,\n    JSON_VALUE(response_body, '$.status') AS status,\n    JSON_QUERY(response_body, '$.errors') AS errors_array,\n    JSON_VALUE(response_body, '$.data.total_count') AS total_count\nFROM api_logs\nWHERE JSON_VALUE(response_body, '$.status') != 'ok'\n  AND logged_at >= now() - INTERVAL 1 HOUR;");
  });

  test("Q131 JSONExtractKeysAndValues", () => {
    roundTrip("SELECT\n    config_id,\n    kv.1 AS key,\n    kv.2 AS value\nFROM feature_flags\nARRAY JOIN JSONExtractKeysAndValues(settings_json, 'String') AS kv\nWHERE is_active = 1;");
  });

  test("Q132 simpleJSONExtractString for fast parsing", () => {
    roundTrip("SELECT\n    log_line,\n    simpleJSONExtractString(log_line, 'level') AS log_level,\n    simpleJSONExtractString(log_line, 'message') AS message,\n    simpleJSONExtractString(log_line, 'trace_id') AS trace_id\nFROM raw_logs\nWHERE simpleJSONExtractString(log_line, 'level') = 'ERROR'\n  AND ingested_at >= now() - INTERVAL 30 MINUTE\nLIMIT 500;");
  });

  test("Q133 geoDistance between two coordinate pairs", () => {
    roundTrip("SELECT\n    store_id,\n    store_name,\n    latitude,\n    longitude,\n    round(geoDistance(longitude, latitude, -73.9857, 40.7484), 0) AS distance_meters\nFROM stores\nWHERE geoDistance(longitude, latitude, -73.9857, 40.7484) < 5000\nORDER BY distance_meters ASC;");
  });

  test("Q134 pointInPolygon for geofencing", () => {
    roundTrip("SELECT\n    event_id,\n    user_id,\n    latitude,\n    longitude\nFROM location_events\nWHERE pointInPolygon(\n    (longitude, latitude),\n    [(-73.99, 40.75), (-73.97, 40.75), (-73.97, 40.74), (-73.99, 40.74)]\n)\n  AND event_date = today();");
  });

  test("Q135 h3ToGeo to convert H3 index to lat/lon", () => {
    roundTrip("SELECT\n    h3_index,\n    count() AS event_count,\n    h3ToGeo(h3_index).2 AS center_lat,\n    h3ToGeo(h3_index).1 AS center_lon\nFROM geo_events\nWHERE event_date >= '2025-03-01'\nGROUP BY h3_index\nORDER BY event_count DESC\nLIMIT 50;");
  });

  test("Q136 geoToH3 and h3kRing for neighbor lookup", () => {
    roundTrip("WITH\n    target_cell AS (SELECT geoToH3(-73.9857, 40.7484, 7) AS h3_idx)\nSELECT\n    h3_index,\n    count() AS events\nFROM geo_events\nWHERE h3_index IN (\n    SELECT arrayJoin(h3kRing((SELECT h3_idx FROM target_cell), 1))\n)\n  AND event_date = today()\nGROUP BY h3_index\nORDER BY events DESC;");
  });

  test("Q137 IPv4NumToString and IPv4StringToNum conversions", () => {
    roundTrip("SELECT\n    IPv4NumToString(ip_num) AS ip_address,\n    count() AS request_count,\n    uniq(user_id) AS unique_users\nFROM access_log\nWHERE event_date = today()\nGROUP BY ip_num\nORDER BY request_count DESC\nLIMIT 25;");
  });

  test("Q138 IPv4CIDRToRange for network range", () => {
    roundTrip("SELECT\n    IPv4CIDRToRange(toIPv4('10.0.0.0'), 16) AS network_range,\n    (network_range.1) AS range_start,\n    (network_range.2) AS range_end,\n    toUInt32(range_end) - toUInt32(range_start) + 1 AS total_addresses;");
  });

  test("Q139 isIPAddressInRange for subnet matching", () => {
    roundTrip("SELECT\n    IPv4NumToString(client_ip) AS ip_address,\n    request_path,\n    response_code\nFROM web_requests\nWHERE isIPAddressInRange(IPv4NumToString(client_ip), '192.168.1.0/24')\n  AND event_date = today()\n  AND response_code >= 400\nORDER BY created_at DESC\nLIMIT 100;");
  });

  test("Q140 bitmapBuild and bitmapCardinality", () => {
    roundTrip("SELECT\n    campaign_id,\n    bitmapCardinality(user_bitmap) AS reach,\n    bitmapCardinality(click_bitmap) AS clickers,\n    round(bitmapCardinality(click_bitmap) / bitmapCardinality(user_bitmap), 4) AS ctr\nFROM (\n    SELECT\n        campaign_id,\n        groupBitmapState(toUInt32(user_id)) AS user_bitmap,\n        groupBitmapState(toUInt32(if(clicked = 1, user_id, 0))) AS click_bitmap\n    FROM ad_impressions\n    WHERE impression_date >= '2025-03-01'\n    GROUP BY campaign_id\n)\nORDER BY reach DESC;");
  });

  test("Q141 bitmapAnd / bitmapOr for set operations", () => {
    roundTrip("WITH\n    segment_a AS (\n        SELECT groupBitmapState(toUInt32(user_id)) AS bm\n        FROM user_segments WHERE segment_name = 'high_value'\n    ),\n    segment_b AS (\n        SELECT groupBitmapState(toUInt32(user_id)) AS bm\n        FROM user_segments WHERE segment_name = 'recently_active'\n    )\nSELECT\n    bitmapCardinality(bitmapAnd(a.bm, b.bm)) AS intersection_size,\n    bitmapCardinality(bitmapOr(a.bm, b.bm)) AS union_size,\n    round(bitmapCardinality(bitmapAnd(a.bm, b.bm)) / bitmapCardinality(bitmapOr(a.bm, b.bm)), 4) AS jaccard_index\nFROM segment_a AS a, segment_b AS b;");
  });

  test("Q142 bitmapContains for membership check", () => {
    roundTrip("WITH user_set AS (\n    SELECT groupBitmapState(toUInt32(user_id)) AS bm\n    FROM purchase_history\n    WHERE purchase_date >= '2025-01-01'\n      AND total_amount > 500\n)\nSELECT\n    user_id,\n    user_name,\n    email\nFROM users\nWHERE bitmapContains(\n    (SELECT bm FROM user_set),\n    toUInt32(user_id)\n)\nORDER BY user_name;");
  });

  test("Q143 multiIf with multiple branches", () => {
    roundTrip("SELECT\n    order_id,\n    amount,\n    multiIf(\n        amount < 10,    'micro',\n        amount < 100,   'small',\n        amount < 1000,  'medium',\n        amount < 10000, 'large',\n        'enterprise'\n    ) AS order_tier,\n    count() OVER (PARTITION BY multiIf(amount < 10, 'micro', amount < 100, 'small', amount < 1000, 'medium', amount < 10000, 'large', 'enterprise')) AS tier_count\nFROM orders\nWHERE order_date = today()\nORDER BY amount DESC;");
  });

  test("Q144 CASE WHEN with nested conditions", () => {
    roundTrip("SELECT\n    user_id,\n    total_orders,\n    total_spent,\n    CASE\n        WHEN total_orders = 0 THEN 'never_purchased'\n        WHEN total_orders = 1 AND total_spent < 50 THEN 'one_time_low'\n        WHEN total_orders BETWEEN 2 AND 5 AND total_spent < 500 THEN 'occasional'\n        WHEN total_orders > 5 AND total_spent >= 500 AND last_order_days_ago <= 30 THEN 'loyal_active'\n        WHEN total_orders > 5 AND last_order_days_ago > 90 THEN 'loyal_churned'\n        ELSE 'other'\n    END AS customer_segment\nFROM (\n    SELECT\n        user_id,\n        count() AS total_orders,\n        sum(amount) AS total_spent,\n        dateDiff('day', max(order_date), today()) AS last_order_days_ago\n    FROM orders\n    GROUP BY user_id\n);");
  });

  test("Q145 countIf vs sum(if(...))", () => {
    roundTrip("SELECT\n    toStartOfWeek(event_date) AS week,\n    count() AS total_events,\n    countIf(event_type = 'purchase') AS purchases,\n    countIf(event_type = 'signup') AS signups,\n    sum(if(event_type = 'purchase', amount, 0)) AS purchase_revenue,\n    round(countIf(event_type = 'purchase') / countIf(event_type = 'visit'), 4) AS conversion_rate\nFROM events\nWHERE event_date >= today() - INTERVAL 12 WEEK\nGROUP BY week\nORDER BY week;");
  });

  test("Q146 cityHash64 for deterministic hashing and sharding", () => {
    roundTrip("SELECT\n    user_id,\n    cityHash64(user_id) AS hash_value,\n    cityHash64(user_id) % 16 AS shard_id,\n    cityHash64(user_id) % 100 < 10 AS in_experiment_group\nFROM users\nWHERE registration_date >= '2025-01-01'\nLIMIT 20;");
  });

  test("Q147 sipHash128 + hex() for row fingerprinting", () => {
    roundTrip("SELECT\n    order_id,\n    hex(sipHash128(\n        toString(order_id),\n        toString(customer_id),\n        toString(amount),\n        toString(order_date),\n        status\n    )) AS row_fingerprint\nFROM orders\nWHERE order_date = today()\nORDER BY order_id\nLIMIT 50;");
  });

  test("Q148 Parameterized view with {param:Type} syntax", () => {
    roundTrip("CREATE VIEW user_activity_report AS\nSELECT\n    user_id,\n    count() AS event_count,\n    uniq(event_type) AS distinct_events,\n    min(created_at) AS first_event,\n    max(created_at) AS last_event\nFROM events\nWHERE event_date >= {start_date:Date}\n  AND event_date <= {end_date:Date}\n  AND (event_type = {event_filter:String} OR {event_filter:String} = '')\nGROUP BY user_id\nORDER BY event_count DESC;");
  });

  test("Q149 SYSTEM FLUSH LOGS", () => {
    roundTrip("SYSTEM FLUSH LOGS;");
  });

  test("Q150 SYSTEM RELOAD DICTIONARY", () => {
    roundTrip("SYSTEM RELOAD DICTIONARY geo_ip_lookup;");
  });
});
