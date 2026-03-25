# ClickHouse SQL Query Examples

A comprehensive collection of ~100 ClickHouse SQL query examples covering diverse features, syntax patterns, and edge cases. Suitable for use as a test suite for ClickHouse SQL parsing and execution.

---

## Basic SELECT & Filtering

### Q001 — Simple SELECT with LIMIT
```sql
SELECT * FROM sample_events LIMIT 10;
```
Demonstrates basic SELECT all columns with row limit.
*Source: Tinybird blog*

### Q002 — Selecting specific columns with alias
```sql
SELECT
    toDate(timestamp) AS event_date,
    user_id,
    event_name
FROM sample_events
LIMIT 100;
```
Demonstrates column selection with type conversion alias.
*Source: Tinybird blog*

### Q003 — WHERE clause with multiple conditions
```sql
SELECT user_id, event_name, timestamp
FROM sample_events
WHERE event_name = 'page_view'
  AND timestamp >= '2024-01-01'
  AND user_id > 1000;
```
Demonstrates basic filtering with AND conditions.
*Source: Tinybird blog*

### Q004 — Using startsWith and toYYYYMM for filtering
```sql
SELECT user_id, COUNT(*) AS event_count
FROM sample_events
WHERE startsWith(event_name, 'purchase')
  AND toYYYYMM(timestamp) = 202401
GROUP BY user_id;
```
Demonstrates ClickHouse string function and date-to-integer conversion for efficient filtering.
*Source: Tinybird blog*

### Q005 — PREWHERE clause
```sql
SELECT user_id, event_name, event_value
FROM sample_events
PREWHERE event_name = 'purchase'
WHERE event_value > 100;
```
Demonstrates PREWHERE for early column filtering before reading other columns (ClickHouse-specific).
*Source: synthetic*

### Q006 — SAMPLE clause for fast prototyping
```sql
SELECT event_name, COUNT(*) AS count
FROM sample_events
SAMPLE 0.1
GROUP BY event_name;
```
Demonstrates deterministic sampling of ~10% of the table.
*Source: Tinybird blog*

### Q007 — SAMPLE with offset for A/B testing
```sql
SELECT COUNT(*) FROM sample_events SAMPLE 1/2 OFFSET 1/2;
```
Demonstrates sample with offset to select the second half of a deterministic split.
*Source: Tinybird blog*

### Q008 — FORMAT clause
```sql
SELECT user_id, event_name, timestamp
FROM sample_events
LIMIT 5
FORMAT JSONEachRow;
```
Demonstrates output format specification.
*Source: synthetic*

---

## Aggregations & GROUP BY

### Q009 — Count distinct variants
```sql
SELECT
    uniq(user_id) AS approx_users,
    uniqExact(user_id) AS exact_users,
    uniqCombined(user_id) AS combined_users
FROM sample_events;
```
Demonstrates ClickHouse approximate and exact distinct counting functions.
*Source: Tinybird blog*

### Q010 — Quantile and topK
```sql
SELECT
    event_name,
    quantile(0.95)(event_value) AS p95_value,
    topK(5)(user_id) AS top_5_users
FROM sample_events
GROUP BY event_name;
```
Demonstrates parametric aggregate functions for percentiles and top-K values.
*Source: Tinybird blog*

### Q011 — WITH TOTALS
```sql
SELECT
    event_name,
    COUNT(*) AS event_count,
    AVG(event_value) AS avg_value
FROM sample_events
GROUP BY event_name
WITH TOTALS;
```
Demonstrates automatic grand total row generation.
*Source: Tinybird blog*

### Q012 — WITH ROLLUP
```sql
SELECT
    toDate(timestamp) AS day,
    event_name,
    COUNT(*) AS cnt,
    SUM(event_value) AS total_value
FROM sample_events
GROUP BY day, event_name
WITH ROLLUP
ORDER BY day, event_name;
```
Demonstrates hierarchical subtotals using ROLLUP.
*Source: synthetic*

### Q013 — WITH CUBE
```sql
SELECT
    toDate(timestamp) AS day,
    event_name,
    COUNT(*) AS cnt
FROM sample_events
GROUP BY day, event_name
WITH CUBE
ORDER BY day, event_name;
```
Demonstrates all possible subtotal combinations using CUBE.
*Source: synthetic*

### Q014 — GROUPING SETS
```sql
SELECT
    toDate(timestamp) AS day,
    event_name,
    user_id,
    COUNT(*) AS cnt
FROM sample_events
GROUP BY GROUPING SETS (
    (day, event_name),
    (day, user_id),
    (day)
)
ORDER BY day;
```
Demonstrates explicit grouping set definitions.
*Source: synthetic*

### Q015 — Multiple quantiles
```sql
SELECT
    event_name,
    quantiles(0.5, 0.9, 0.95, 0.99)(event_value) AS percentiles,
    min(event_value) AS min_val,
    max(event_value) AS max_val,
    stddevPop(event_value) AS stddev
FROM sample_events
GROUP BY event_name;
```
Demonstrates multiple quantile extraction and statistical functions.
*Source: synthetic*

### Q016 — argMax for latest value per group
```sql
SELECT
    user_id,
    argMax(user_name, updated_at) AS current_name,
    argMax(email, updated_at) AS current_email
FROM users
GROUP BY user_id;
```
Demonstrates argMax to get the value associated with the max of another column (avoids FINAL).
*Source: Tinybird blog*

### Q017 — sumMap for merging mapped values
```sql
SELECT
    date,
    sumMap(status_codes, counts) AS merged_status_counts
FROM http_log_daily
GROUP BY date
ORDER BY date;
```
Demonstrates sumMap for merging key-value maps across rows.
*Source: synthetic*

### Q018 — groupArray and groupUniqArray
```sql
SELECT
    user_id,
    groupArray(event_name) AS all_events,
    groupUniqArray(event_name) AS unique_events,
    groupArray(10)(event_name) AS last_10_events
FROM sample_events
GROUP BY user_id;
```
Demonstrates collecting values into arrays during aggregation.
*Source: synthetic*

---

## JOIN Operations

### Q019 — INNER JOIN
```sql
SELECT
    e.user_id,
    e.event_name,
    u.user_name
FROM sample_events e
INNER JOIN users u ON e.user_id = u.user_id
WHERE e.timestamp >= '2024-01-01';
```
Demonstrates standard inner join with filter on left table.
*Source: Tinybird blog*

### Q020 — LEFT JOIN
```sql
SELECT
    e.user_id,
    e.event_name,
    u.user_name
FROM sample_events e
LEFT JOIN users u ON e.user_id = u.user_id
WHERE e.timestamp >= '2024-01-01';
```
Demonstrates left outer join preserving all rows from left table.
*Source: Tinybird blog*

### Q021 — RIGHT JOIN
```sql
SELECT
    u.user_id,
    u.user_name,
    COUNT(e.event_name) AS event_count
FROM sample_events e
RIGHT JOIN users u ON e.user_id = u.user_id
GROUP BY u.user_id, u.user_name;
```
Demonstrates right join preserving all rows from right table.
*Source: synthetic*

### Q022 — FULL OUTER JOIN
```sql
SELECT
    COALESCE(a.user_id, b.user_id) AS user_id,
    a.event_count AS web_events,
    b.event_count AS mobile_events
FROM web_events a
FULL OUTER JOIN mobile_events b ON a.user_id = b.user_id;
```
Demonstrates full outer join combining two event sources.
*Source: synthetic*

### Q023 — CROSS JOIN
```sql
SELECT
    d.date,
    c.category
FROM (SELECT toDate('2024-01-01') + number AS date FROM numbers(31)) d
CROSS JOIN (SELECT arrayJoin(['electronics', 'clothing', 'food']) AS category) c;
```
Demonstrates cross join for generating a complete date × category grid.
*Source: synthetic*

### Q024 — LEFT SEMI JOIN
```sql
SELECT user_id, user_name
FROM users u
LEFT SEMI JOIN sample_events e ON u.user_id = e.user_id;
```
Demonstrates semi join returning only left rows that have a match in right table.
*Source: ClickHouse docs*

### Q025 — LEFT ANTI JOIN
```sql
SELECT user_id, user_name
FROM users u
LEFT ANTI JOIN sample_events e ON u.user_id = e.user_id;
```
Demonstrates anti join returning only left rows that have NO match in right table.
*Source: ClickHouse docs*

### Q026 — ANY LEFT JOIN
```sql
SELECT
    e.user_id,
    e.event_name,
    u.user_name
FROM sample_events e
ANY LEFT JOIN users u ON e.user_id = u.user_id;
```
Demonstrates ANY modifier which returns at most one matching row from the right table.
*Source: ClickHouse docs*

### Q027 — ASOF JOIN
```sql
SELECT
    trades.timestamp,
    trades.symbol,
    trades.price,
    quotes.bid,
    quotes.ask
FROM trades
ASOF LEFT JOIN quotes
ON trades.symbol = quotes.symbol AND trades.timestamp >= quotes.timestamp;
```
Demonstrates ASOF JOIN for matching the closest preceding record (common in time series/financial data).
*Source: ClickHouse docs*

### Q028 — PASTE JOIN
```sql
SELECT *
FROM (SELECT number AS a FROM numbers(3))
PASTE JOIN (SELECT number AS b FROM numbers(3));
```
Demonstrates PASTE JOIN which combines tables by row position without a key.
*Source: ClickHouse docs*

### Q029 — GLOBAL JOIN on distributed tables
```sql
SELECT
    e.user_id,
    e.event_count,
    u.signup_date
FROM distributed_events e
GLOBAL INNER JOIN users u ON e.user_id = u.user_id;
```
Demonstrates GLOBAL JOIN to broadcast right table to all shards in a distributed query.
*Source: Tinybird blog*

### Q030 — ARRAY JOIN clause
```sql
SELECT
    user_id,
    tag
FROM user_profiles
ARRAY JOIN tags AS tag;
```
Demonstrates ARRAY JOIN to unnest/flatten array columns into separate rows.
*Source: Tinybird blog*

---

## Window Functions

### Q031 — ROW_NUMBER
```sql
SELECT
    user_id,
    event_name,
    timestamp,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY timestamp) AS row_num
FROM sample_events;
```
Demonstrates row numbering within partitions.
*Source: ClickHouse docs*

### Q032 — RANK and DENSE_RANK
```sql
SELECT
    event_name,
    event_value,
    RANK() OVER (ORDER BY event_value DESC) AS rank,
    DENSE_RANK() OVER (ORDER BY event_value DESC) AS dense_rank
FROM sample_events;
```
Demonstrates ranking functions with gap (RANK) and without gap (DENSE_RANK).
*Source: ClickHouse docs*

### Q033 — LAG and LEAD
```sql
SELECT
    timestamp,
    event_value,
    LAG(event_value) OVER (ORDER BY timestamp) AS prev_value,
    LEAD(event_value) OVER (ORDER BY timestamp) AS next_value,
    event_value - LAG(event_value) OVER (ORDER BY timestamp) AS delta
FROM sample_events;
```
Demonstrates accessing previous and next row values in a window.
*Source: ClickHouse docs*

### Q034 — Running total with window function
```sql
SELECT
    toDate(timestamp) AS day,
    event_value,
    SUM(event_value) OVER (ORDER BY timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total
FROM sample_events;
```
Demonstrates cumulative sum using window frame specification.
*Source: ClickHouse docs*

### Q035 — Moving average
```sql
SELECT
    timestamp,
    event_value,
    AVG(event_value) OVER (
        ORDER BY timestamp
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    ) AS moving_avg_7
FROM sample_events;
```
Demonstrates 7-row moving average using ROWS frame.
*Source: synthetic*

### Q036 — NTILE function
```sql
SELECT
    user_id,
    event_value,
    NTILE(4) OVER (ORDER BY event_value) AS quartile
FROM sample_events;
```
Demonstrates dividing rows into N roughly equal buckets.
*Source: ClickHouse docs*

### Q037 — Named window definition
```sql
SELECT
    user_id,
    event_name,
    event_value,
    SUM(event_value) OVER w AS running_sum,
    AVG(event_value) OVER w AS running_avg
FROM sample_events
WINDOW w AS (PARTITION BY user_id ORDER BY timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
ORDER BY user_id, timestamp;
```
Demonstrates reusable named WINDOW clause.
*Source: ClickHouse docs*

### Q038 — percent_rank and first_value
```sql
SELECT
    user_id,
    event_value,
    percent_rank() OVER (ORDER BY event_value) AS pct_rank,
    first_value(event_name) OVER (PARTITION BY user_id ORDER BY timestamp) AS first_event
FROM sample_events;
```
Demonstrates percent_rank and first_value window functions.
*Source: ClickHouse docs*

---

## Array Functions & Higher-Order Functions

### Q039 — arrayMap
```sql
SELECT arrayMap(x -> x * 2, [1, 2, 3, 4, 5]) AS doubled;
```
Demonstrates applying a lambda to transform each array element.
*Source: ClickHouse docs*

### Q040 — arrayFilter
```sql
SELECT arrayFilter(x -> x > 3, [1, 2, 3, 4, 5, 6]) AS filtered;
```
Demonstrates filtering array elements with a predicate lambda.
*Source: ClickHouse docs*

### Q041 — arraySort and arrayReverseSort
```sql
SELECT
    arraySort([5, 3, 1, 4, 2]) AS sorted_asc,
    arrayReverseSort([5, 3, 1, 4, 2]) AS sorted_desc,
    arraySort((x) -> -x, [5, 3, 1, 4, 2]) AS custom_sorted;
```
Demonstrates array sorting with default and custom comparators.
*Source: ClickHouse docs*

### Q042 — arrayJoin function
```sql
SELECT
    arrayJoin([1, 2, 3]) AS value,
    'hello' AS greeting;
```
Demonstrates arrayJoin as a function to unnest an array into rows (multiplies other columns).
*Source: ClickHouse docs*

### Q043 — arrayFold (reduce)
```sql
SELECT arrayFold((acc, x) -> acc + x, [1, 2, 3, 4], toInt64(0)) AS sum_result;
```
Demonstrates folding/reducing an array to a single value with an accumulator.
*Source: ClickHouse docs*

### Q044 — arrayReduce with aggregate function name
```sql
SELECT
    arrayReduce('sum', [1, 2, 3, 4, 5]) AS total,
    arrayReduce('avg', [10, 20, 30]) AS average,
    arrayReduce('uniq', [1, 2, 2, 3, 3, 3]) AS distinct_count;
```
Demonstrates applying named aggregate functions to arrays.
*Source: ClickHouse docs*

### Q045 — arrayExists and arrayAll
```sql
SELECT
    arrayExists(x -> x > 10, [1, 5, 12, 3]) AS has_gt_10,
    arrayAll(x -> x > 0, [1, 5, 12, 3]) AS all_positive;
```
Demonstrates predicate checks: any-match and all-match on arrays.
*Source: ClickHouse docs*

### Q046 — arrayFill and arrayReverseFill
```sql
SELECT
    arrayFill(x -> x != 0, [0, 0, 3, 0, 0, 5, 0]) AS filled_forward,
    arrayReverseFill(x -> x != 0, [0, 0, 3, 0, 0, 5, 0]) AS filled_backward;
```
Demonstrates forward-fill and backward-fill of array elements based on a predicate.
*Source: ClickHouse docs*

### Q047 — arrayDifference and arrayCumSum
```sql
SELECT
    arrayDifference([1, 3, 6, 10, 15]) AS diffs,
    arrayCumSum([1, 2, 3, 4, 5]) AS cumulative;
```
Demonstrates computing differences between consecutive elements and cumulative sums.
*Source: ClickHouse docs*

### Q048 — arrayZip
```sql
SELECT arrayZip(['a', 'b', 'c'], [1, 2, 3]) AS zipped;
```
Demonstrates zipping two arrays into an array of tuples.
*Source: ClickHouse docs*

### Q049 — groupArray with ARRAY JOIN for sessionization
```sql
SELECT
    user_id,
    event_name,
    timestamp,
    idx
FROM (
    SELECT
        user_id,
        groupArray(event_name) AS events,
        groupArray(timestamp) AS timestamps
    FROM sample_events
    GROUP BY user_id
)
ARRAY JOIN events AS event_name, timestamps AS timestamp, arrayEnumerate(events) AS idx;
```
Demonstrates collecting arrays in aggregation then re-expanding with ARRAY JOIN.
*Source: synthetic*

### Q050 — arrayEnumerate and arrayEnumerateUniq
```sql
SELECT
    arrayEnumerate([10, 20, 30]) AS indices,
    arrayEnumerateUniq(['a', 'b', 'a', 'c', 'b', 'a']) AS uniq_counts;
```
Demonstrates generating sequential indices and occurrence counts for array elements.
*Source: ClickHouse docs*

---

## Time Series & Date Functions

### Q051 — toStartOfInterval for time bucketing
```sql
SELECT
    toStartOfInterval(timestamp, INTERVAL 5 MINUTE) AS bucket,
    COUNT(*) AS event_count,
    AVG(event_value) AS avg_value
FROM sample_events
GROUP BY bucket
ORDER BY bucket;
```
Demonstrates fixed-interval time bucketing.
*Source: ClickHouse docs*

### Q052 — WITH FILL for gap filling
```sql
SELECT
    toStartOfMinute(timestamp) AS minute,
    COUNT(*) AS cnt
FROM sample_events
GROUP BY minute
ORDER BY minute ASC WITH FILL
    FROM toStartOfMinute(now() - INTERVAL 1 HOUR)
    TO toStartOfMinute(now())
    STEP INTERVAL 1 MINUTE;
```
Demonstrates filling time series gaps with WITH FILL, FROM, TO, and STEP.
*Source: ClickHouse docs*

### Q053 — WITH FILL and INTERPOLATE
```sql
SELECT
    toDate(timestamp) AS day,
    COUNT(*) AS cnt,
    SUM(event_value) AS total
FROM sample_events
GROUP BY day
ORDER BY day ASC WITH FILL
    FROM toDate('2024-01-01')
    TO toDate('2024-01-31')
    STEP INTERVAL 1 DAY
    INTERPOLATE (cnt AS 0, total AS 0);
```
Demonstrates gap filling with explicit interpolation values for missing periods.
*Source: ClickHouse docs*

### Q054 — date_trunc
```sql
SELECT
    date_trunc('month', timestamp) AS month,
    COUNT(*) AS events,
    uniq(user_id) AS unique_users
FROM sample_events
GROUP BY month
ORDER BY month;
```
Demonstrates standard date_trunc function for time grouping.
*Source: synthetic*

### Q055 — dateDiff and date arithmetic
```sql
SELECT
    user_id,
    min(timestamp) AS first_event,
    max(timestamp) AS last_event,
    dateDiff('day', min(timestamp), max(timestamp)) AS active_days,
    dateDiff('hour', min(timestamp), max(timestamp)) AS active_hours
FROM sample_events
GROUP BY user_id;
```
Demonstrates date difference calculations.
*Source: synthetic*

### Q056 — toYYYYMMDD and date extraction
```sql
SELECT
    toYYYYMMDD(timestamp) AS date_int,
    toYear(timestamp) AS year,
    toMonth(timestamp) AS month,
    toDayOfWeek(timestamp) AS dow,
    toHour(timestamp) AS hour,
    COUNT(*) AS cnt
FROM sample_events
GROUP BY date_int, year, month, dow, hour
ORDER BY date_int, hour;
```
Demonstrates various date extraction functions.
*Source: synthetic*

### Q057 — Time zone handling
```sql
SELECT
    timestamp,
    toTimezone(timestamp, 'America/New_York') AS ny_time,
    toTimezone(timestamp, 'Europe/London') AS london_time,
    toStartOfDay(toTimezone(timestamp, 'Asia/Tokyo')) AS tokyo_day
FROM sample_events
LIMIT 5;
```
Demonstrates timezone conversion functions.
*Source: synthetic*

### Q058 — WITH FILL with multiple ORDER BY columns
```sql
SELECT
    toDate(timestamp) AS day,
    event_name,
    COUNT(*) AS cnt
FROM sample_events
GROUP BY day, event_name
ORDER BY
    day WITH FILL FROM toDate('2024-01-01') TO toDate('2024-01-07') STEP 1,
    event_name;
```
Demonstrates WITH FILL on one column in a multi-column ORDER BY.
*Source: ClickHouse docs*

---

## Parametric & Specialized Aggregate Functions

### Q059 — histogram
```sql
SELECT
    histogram(10)(event_value) AS hist
FROM sample_events;
```
Demonstrates adaptive histogram computation.
*Source: ClickHouse docs*

### Q060 — sequenceMatch
```sql
SELECT
    user_id,
    sequenceMatch('(?1)(?2)(?3)')(
        timestamp,
        event_name = 'page_view',
        event_name = 'add_to_cart',
        event_name = 'purchase'
    ) AS completed_funnel
FROM sample_events
GROUP BY user_id;
```
Demonstrates pattern matching on event sequences per user.
*Source: ClickHouse docs*

### Q061 — sequenceCount
```sql
SELECT
    user_id,
    sequenceCount('(?1)(?2)')(
        timestamp,
        event_name = 'search',
        event_name = 'page_view'
    ) AS search_to_view_count
FROM sample_events
GROUP BY user_id;
```
Demonstrates counting how many times a sequence pattern occurs.
*Source: ClickHouse docs*

### Q062 — windowFunnel
```sql
SELECT
    user_id,
    windowFunnel(86400)(
        toUInt32(timestamp),
        event_name = 'page_view',
        event_name = 'add_to_cart',
        event_name = 'checkout',
        event_name = 'purchase'
    ) AS funnel_step
FROM sample_events
GROUP BY user_id;
```
Demonstrates funnel analysis — returns the max step reached within a time window.
*Source: ClickHouse docs*

### Q063 — retention
```sql
SELECT
    retention(
        toDate(timestamp) = toDate('2024-01-01'),
        toDate(timestamp) = toDate('2024-01-02'),
        toDate(timestamp) = toDate('2024-01-03'),
        toDate(timestamp) = toDate('2024-01-07')
    ) AS retention_flags
FROM sample_events
GROUP BY user_id;
```
Demonstrates retention analysis — returns boolean array for each condition.
*Source: ClickHouse docs*

### Q064 — uniqUpTo
```sql
SELECT
    event_name,
    uniqUpTo(5)(user_id) AS up_to_5_users
FROM sample_events
GROUP BY event_name;
```
Demonstrates counting unique values up to a threshold (returns threshold+1 if exceeded).
*Source: ClickHouse docs*

### Q065 — sumMapFiltered
```sql
SELECT
    sumMapFiltered([200, 404, 500])(status_codes, counts) AS filtered_status_sums
FROM http_log_daily;
```
Demonstrates sumMap with key filtering — only sums values for specified keys.
*Source: ClickHouse docs*

### Q066 — sequenceNextNode
```sql
SELECT
    sequenceNextNode('forward', 'head')(
        timestamp,
        event_name,
        event_name = 'page_view',
        event_name = 'add_to_cart'
    ) AS next_after_cart
FROM sample_events
GROUP BY user_id;
```
Demonstrates finding the next event after a matched sequence pattern.
*Source: ClickHouse docs*

---

## String & Text Functions

### Q067 — match (regex matching)
```sql
SELECT
    event_name,
    match(event_name, '^(purchase|checkout)') AS is_conversion
FROM sample_events
WHERE match(event_name, 'cart|purchase');
```
Demonstrates regex matching with match() function.
*Source: Tinybird blog*

### Q068 — extract with regex
```sql
SELECT
    url,
    extract(url, '//([^/]+)') AS domain,
    extractAll(url, '([a-zA-Z0-9]+)') AS tokens
FROM web_logs
LIMIT 10;
```
Demonstrates extracting substrings using regex capture groups.
*Source: synthetic*

### Q069 — replaceRegexpAll and string manipulation
```sql
SELECT
    replaceRegexpAll(user_agent, '\\s+', ' ') AS cleaned_ua,
    replaceOne(event_name, 'page_', '') AS short_name,
    lower(trim(user_name)) AS normalized_name
FROM sample_events
LIMIT 5;
```
Demonstrates regex replacement and string normalization.
*Source: synthetic*

### Q070 — splitByChar and concat
```sql
SELECT
    splitByChar(',', 'a,b,c,d') AS parts,
    splitByString('::', 'key::value::extra') AS kv_parts,
    concat('user_', toString(user_id), '_', event_name) AS composite_key
FROM sample_events
LIMIT 5;
```
Demonstrates string splitting and concatenation.
*Source: synthetic*

### Q071 — format function and multiIf for string building
```sql
SELECT
    format('{} performed {} at {}', user_id, event_name, timestamp) AS description,
    multiIf(
        event_value > 100, 'high',
        event_value > 10, 'medium',
        'low'
    ) AS value_tier
FROM sample_events
LIMIT 10;
```
Demonstrates string formatting and multi-branch conditional.
*Source: synthetic*

---

## Table Functions & Data Generation

### Q072 — numbers() table function
```sql
SELECT
    number,
    number * number AS square,
    sqrt(number) AS root
FROM numbers(1, 20);
```
Demonstrates generating a sequence of numbers.
*Source: synthetic*

### Q073 — generateRandom()
```sql
SELECT *
FROM generateRandom('id UInt64, name String, score Float32', 42, 10, 3)
LIMIT 100;
```
Demonstrates generating random table data with a specified schema and seed.
*Source: synthetic*

### Q074 — numbers() for date range generation
```sql
SELECT
    toDate('2024-01-01') + number AS date,
    toDayOfWeek(toDate('2024-01-01') + number) AS dow
FROM numbers(365)
WHERE toDayOfWeek(toDate('2024-01-01') + number) <= 5;
```
Demonstrates using numbers() to generate a calendar of business days.
*Source: synthetic*

### Q075 — url() table function
```sql
SELECT *
FROM url('https://datasets-documentation.s3.eu-west-3.amazonaws.com/nyc-taxi/trips_0.gz', 'TabSeparatedWithNames')
LIMIT 10;
```
Demonstrates reading data directly from a URL.
*Source: synthetic*

### Q076 — s3() table function
```sql
SELECT count(*)
FROM s3('https://datasets-documentation.s3.eu-west-3.amazonaws.com/nyc-taxi/trips_*.gz', 'TabSeparatedWithNames');
```
Demonstrates reading from S3 with glob pattern matching.
*Source: synthetic*

---

## DDL & Table Engines

### Q077 — MergeTree with ORDER BY and PARTITION BY
```sql
CREATE TABLE events_log (
    timestamp DateTime,
    user_id UInt64,
    event_name LowCardinality(String),
    event_value Float64,
    properties Map(String, String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (user_id, timestamp)
SETTINGS index_granularity = 8192;
```
Demonstrates MergeTree with partitioning, ordering, LowCardinality, and Map type.
*Source: synthetic*

### Q078 — ReplacingMergeTree
```sql
CREATE TABLE user_profiles (
    user_id UInt64,
    user_name String,
    email String,
    updated_at DateTime
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY user_id;
```
Demonstrates ReplacingMergeTree which deduplicates rows by ORDER BY key, keeping the latest version.
*Source: synthetic*

### Q079 — AggregatingMergeTree with materialized view
```sql
CREATE TABLE events_daily_agg (
    day Date,
    event_name LowCardinality(String),
    count_state AggregateFunction(count),
    uniq_users_state AggregateFunction(uniq, UInt64),
    sum_value_state AggregateFunction(sum, Float64)
) ENGINE = AggregatingMergeTree()
ORDER BY (day, event_name);

CREATE MATERIALIZED VIEW events_daily_mv TO events_daily_agg AS
SELECT
    toDate(timestamp) AS day,
    event_name,
    countState() AS count_state,
    uniqState(user_id) AS uniq_users_state,
    sumState(event_value) AS sum_value_state
FROM sample_events
GROUP BY day, event_name;
```
Demonstrates AggregatingMergeTree with a materialized view for incremental aggregation using -State combinators.
*Source: synthetic*

### Q080 — CollapsingMergeTree
```sql
CREATE TABLE user_sessions (
    user_id UInt64,
    session_start DateTime,
    page_views UInt32,
    sign Int8
) ENGINE = CollapsingMergeTree(sign)
ORDER BY (user_id, session_start);
```
Demonstrates CollapsingMergeTree for mutable data using sign column (+1/-1).
*Source: synthetic*

### Q081 — TTL for automatic data expiration
```sql
CREATE TABLE logs_ttl (
    timestamp DateTime,
    level String,
    message String
) ENGINE = MergeTree()
ORDER BY timestamp
TTL timestamp + INTERVAL 30 DAY DELETE,
    timestamp + INTERVAL 7 DAY TO VOLUME 'cold';
```
Demonstrates TTL rules for automatic deletion and storage tiering.
*Source: synthetic*

### Q082 — Column codecs
```sql
CREATE TABLE compressed_events (
    timestamp DateTime CODEC(DoubleDelta, ZSTD(1)),
    user_id UInt64 CODEC(T64, LZ4),
    event_name LowCardinality(String) CODEC(ZSTD(3)),
    event_value Float64 CODEC(Gorilla, LZ4HC(9))
) ENGINE = MergeTree()
ORDER BY (timestamp);
```
Demonstrates column-level compression codec specifications.
*Source: synthetic*

### Q083 — Projection
```sql
ALTER TABLE sample_events ADD PROJECTION events_by_user (
    SELECT
        user_id,
        event_name,
        count(),
        sum(event_value)
    GROUP BY user_id, event_name
);

ALTER TABLE sample_events MATERIALIZE PROJECTION events_by_user;
```
Demonstrates adding a projection for automatic query acceleration.
*Source: synthetic*

### Q084 — CREATE TABLE with Nullable and DEFAULT
```sql
CREATE TABLE products (
    id UInt64,
    name String,
    description Nullable(String),
    price Decimal(10, 2),
    created_at DateTime DEFAULT now(),
    category LowCardinality(String) DEFAULT 'uncategorized'
) ENGINE = MergeTree()
ORDER BY id;
```
Demonstrates Nullable columns and DEFAULT expressions.
*Source: synthetic*

---

## ClickHouse-Specific Modifiers & Features

### Q085 — FINAL modifier
```sql
SELECT user_id, user_name, last_login
FROM users FINAL
WHERE user_id = 12345;
```
Demonstrates FINAL to force deduplication at query time on ReplacingMergeTree.
*Source: Tinybird blog*

### Q086 — LIMIT BY
```sql
SELECT
    user_id,
    event_name,
    timestamp,
    event_value
FROM sample_events
ORDER BY event_value DESC
LIMIT 5 BY user_id
LIMIT 100;
```
Demonstrates LIMIT BY for top-N-per-group queries, combined with global LIMIT.
*Source: Tinybird blog*

### Q087 — SETTINGS clause
```sql
SELECT COUNT(*) FROM sample_events
SETTINGS max_threads = 4, max_memory_usage = 10000000000;
```
Demonstrates per-query settings for thread and memory control.
*Source: Tinybird blog*

### Q088 — EXPLAIN
```sql
EXPLAIN PIPELINE
SELECT
    user_id,
    COUNT(*) AS cnt
FROM sample_events
WHERE event_name = 'purchase'
GROUP BY user_id
ORDER BY cnt DESC
LIMIT 10;
```
Demonstrates EXPLAIN PIPELINE for understanding query execution plan.
*Source: synthetic*

### Q089 — System tables: query_log
```sql
SELECT
    query_duration_ms,
    query,
    read_rows,
    read_bytes,
    memory_usage
FROM system.query_log
WHERE query_duration_ms > 1000
  AND type = 'QueryFinish'
ORDER BY query_duration_ms DESC
LIMIT 10;
```
Demonstrates querying the system query log for slow query analysis.
*Source: Tinybird blog*

### Q090 — System tables: metrics
```sql
SELECT metric, value
FROM system.metrics
WHERE metric LIKE '%Memory%'
   OR metric LIKE '%Query%';
```
Demonstrates querying system metrics for monitoring.
*Source: Tinybird blog*

### Q091 — ALTER TABLE mutations
```sql
ALTER TABLE sample_events
UPDATE event_name = 'page_impression'
WHERE event_name = 'page_view' AND timestamp < '2024-01-01';

ALTER TABLE sample_events
DELETE WHERE event_value < 0;
```
Demonstrates ALTER UPDATE and ALTER DELETE mutations.
*Source: synthetic*

### Q092 — OPTIMIZE TABLE
```sql
OPTIMIZE TABLE sample_events FINAL;

OPTIMIZE TABLE sample_events PARTITION '202401' FINAL DEDUPLICATE BY user_id, event_name;
```
Demonstrates forcing merge of parts and deduplication.
*Source: synthetic*

---

## Complex/Weird Queries

### Q093 — CTE with multiple levels
```sql
WITH
    daily AS (
        SELECT
            toDate(timestamp) AS day,
            user_id,
            COUNT(*) AS daily_events
        FROM sample_events
        GROUP BY day, user_id
    ),
    user_stats AS (
        SELECT
            user_id,
            AVG(daily_events) AS avg_daily,
            MAX(daily_events) AS max_daily
        FROM daily
        GROUP BY user_id
    )
SELECT
    user_id,
    avg_daily,
    max_daily,
    max_daily / avg_daily AS burst_ratio
FROM user_stats
WHERE avg_daily > 5
ORDER BY burst_ratio DESC
LIMIT 20;
```
Demonstrates multi-level CTEs for layered analytics.
*Source: synthetic*

### Q094 — Lambda within lambda (nested higher-order functions)
```sql
SELECT
    arrayMap(
        arr -> arrayFilter(x -> x % 2 = 0, arr),
        [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10]]
    ) AS even_per_subarray;
```
Demonstrates nested lambda functions applied to nested arrays.
*Source: synthetic*

### Q095 — Tuple operations
```sql
SELECT
    (1, 'hello', 3.14) AS t,
    t.1 AS first,
    t.2 AS second,
    tupleElement(t, 3) AS third,
    tupleToNameMap(tuple(1 AS a, 2 AS b, 3 AS c)) AS named;
```
Demonstrates tuple creation, element access, and named tuples.
*Source: synthetic*

### Q096 — Map type operations
```sql
SELECT
    map('key1', 1, 'key2', 2, 'key3', 3) AS m,
    m['key1'] AS val1,
    mapKeys(m) AS keys,
    mapValues(m) AS vals,
    mapContains(m, 'key2') AS has_key2,
    mapApply((k, v) -> (k, v * 10), m) AS scaled;
```
Demonstrates Map type creation, access, and transformation.
*Source: synthetic*

### Q097 — Nullable edge cases
```sql
SELECT
    NULL = NULL AS null_eq_null,
    isNull(NULL) AS is_null_check,
    ifNull(NULL, 'default') AS coalesced,
    assumeNotNull(toNullable(42)) AS unwrapped,
    toTypeName(toNullable(1)) AS nullable_type,
    nullIf(1, 1) AS nullified;
```
Demonstrates Nullable behavior and helper functions.
*Source: synthetic*

### Q098 — Conditional aggregates with -If combinator
```sql
SELECT
    toDate(timestamp) AS day,
    countIf(event_name = 'page_view') AS views,
    countIf(event_name = 'purchase') AS purchases,
    sumIf(event_value, event_name = 'purchase') AS revenue,
    uniqIf(user_id, event_name = 'purchase') AS buyers,
    avgIf(event_value, event_value > 0) AS avg_positive_value
FROM sample_events
GROUP BY day
ORDER BY day;
```
Demonstrates -If aggregate function combinator for conditional aggregation.
*Source: synthetic*

### Q099 — -State / -Merge combinators
```sql
-- Insert aggregated states
INSERT INTO events_daily_agg
SELECT
    toDate(timestamp) AS day,
    event_name,
    countState() AS count_state,
    uniqState(user_id) AS uniq_users_state,
    sumState(event_value) AS sum_value_state
FROM sample_events
GROUP BY day, event_name;

-- Query merged states
SELECT
    day,
    event_name,
    countMerge(count_state) AS total_count,
    uniqMerge(uniq_users_state) AS unique_users,
    sumMerge(sum_value_state) AS total_value
FROM events_daily_agg
GROUP BY day, event_name;
```
Demonstrates -State and -Merge aggregate function combinators for incremental aggregation.
*Source: synthetic*

### Q100 — Dictionary lookup with dictGet
```sql
SELECT
    user_id,
    dictGet('user_segments', 'segment_name', user_id) AS segment,
    dictGetOrDefault('user_segments', 'tier', user_id, 'unknown') AS tier
FROM sample_events
GROUP BY user_id;
```
Demonstrates dictionary lookups with dictGet and dictGetOrDefault.
*Source: synthetic*

### Q101 — Bitwise operations and bit functions
```sql
SELECT
    bitAnd(0xFF, 0x0F) AS masked,
    bitOr(0xF0, 0x0F) AS combined,
    bitShiftLeft(1, 10) AS kb,
    bitCount(toUInt32(255)) AS ones_in_255,
    bitmaskToArray(toUInt64(42)) AS bit_positions;
```
Demonstrates bitwise operations and bit manipulation functions.
*Source: synthetic*

### Q102 — Deeply nested subquery with multiple features
```sql
SELECT
    segment,
    avg_revenue,
    user_count,
    rank() OVER (ORDER BY avg_revenue DESC) AS revenue_rank
FROM (
    SELECT
        multiIf(
            total_purchases >= 10, 'power',
            total_purchases >= 3, 'regular',
            'casual'
        ) AS segment,
        AVG(total_revenue) AS avg_revenue,
        COUNT(*) AS user_count
    FROM (
        SELECT
            user_id,
            countIf(event_name = 'purchase') AS total_purchases,
            sumIf(event_value, event_name = 'purchase') AS total_revenue
        FROM sample_events
        WHERE timestamp >= '2024-01-01'
        GROUP BY user_id
        HAVING total_purchases > 0
    )
    GROUP BY segment
)
ORDER BY revenue_rank;
```
Demonstrates deeply nested subqueries combining conditional aggregation, multiIf segmentation, and window ranking.
*Source: synthetic*

---

## Subqueries & WITH (CTE) Expressions

### Q103 — Basic CTE with WITH clause
```sql
WITH top_users AS (
    SELECT user_id, count() AS cnt
    FROM events
    GROUP BY user_id
    ORDER BY cnt DESC
    LIMIT 100
)
SELECT e.event_name, count() AS freq
FROM events e
INNER JOIN top_users t ON e.user_id = t.user_id
GROUP BY e.event_name
ORDER BY freq DESC;
```
Classic CTE pattern: define a subset, then join back to the main table.

### Q104 — Multiple CTEs chained
```sql
WITH
    daily AS (
        SELECT toDate(ts) AS day, user_id, sum(amount) AS daily_total
        FROM transactions
        GROUP BY day, user_id
    ),
    ranked AS (
        SELECT *, row_number() OVER (PARTITION BY day ORDER BY daily_total DESC) AS rn
        FROM daily
    )
SELECT day, user_id, daily_total
FROM ranked
WHERE rn <= 5
ORDER BY day, rn;
```
Chained CTEs combining aggregation with window ranking.

### Q105 — CTE with scalar expression
```sql
WITH
    (SELECT avg(price) FROM products) AS avg_price
SELECT name, price, price - avg_price AS diff_from_avg
FROM products
ORDER BY diff_from_avg DESC
LIMIT 20;
```
ClickHouse-specific: a CTE can be a scalar subquery assigned to a name without AS (SELECT ...) table syntax.

### Q106 — IN with subquery
```sql
SELECT *
FROM orders
WHERE customer_id IN (
    SELECT customer_id
    FROM customers
    WHERE region = 'EMEA'
)
AND order_date >= '2024-01-01';
```
Subquery used as a set filter with IN.

### Q107 — NOT IN with subquery
```sql
SELECT user_id, email
FROM users
WHERE user_id NOT IN (
    SELECT DISTINCT user_id
    FROM logins
    WHERE login_date >= today() - 90
);
```
Find users who haven't logged in for 90 days using NOT IN subquery.

### Q108 — EXISTS subquery
```sql
SELECT d.name, d.department_id
FROM departments d
WHERE EXISTS (
    SELECT 1
    FROM employees e
    WHERE e.department_id = d.department_id
      AND e.salary > 150000
);
```
Correlated EXISTS subquery — find departments with high earners.

### Q109 — Subquery in SELECT list (scalar subquery)
```sql
SELECT
    product_id,
    name,
    price,
    (SELECT avg(price) FROM products) AS global_avg,
    price / (SELECT max(price) FROM products) AS pct_of_max
FROM products
WHERE price > (SELECT avg(price) FROM products)
ORDER BY price DESC;
```
Multiple scalar subqueries in SELECT and WHERE clauses.

### Q110 — Derived table (subquery in FROM)
```sql
SELECT
    category,
    avg(user_event_count) AS avg_events_per_user,
    max(user_event_count) AS max_events_per_user
FROM (
    SELECT user_id, category, count() AS user_event_count
    FROM events
    GROUP BY user_id, category
) sub
GROUP BY category
ORDER BY avg_events_per_user DESC;
```
Derived table / inline view pattern — aggregate of aggregates.

### Q111 — Nested subqueries three levels deep
```sql
SELECT user_id, total_spent
FROM (
    SELECT user_id, sum(amount) AS total_spent
    FROM orders
    WHERE product_id IN (
        SELECT product_id
        FROM products
        WHERE category IN (
            SELECT category
            FROM categories
            WHERE is_premium = 1
        )
    )
    GROUP BY user_id
) AS spending
WHERE total_spent > 1000
ORDER BY total_spent DESC;
```
Three levels of nested subqueries — stress test for parser and optimizer.

### Q112 — WITH + UNION ALL of subqueries
```sql
WITH
    web AS (
        SELECT user_id, 'web' AS source, count() AS cnt
        FROM web_events
        GROUP BY user_id
    ),
    mobile AS (
        SELECT user_id, 'mobile' AS source, count() AS cnt
        FROM mobile_events
        GROUP BY user_id
    )
SELECT user_id, source, cnt
FROM (
    SELECT * FROM web
    UNION ALL
    SELECT * FROM mobile
)
ORDER BY user_id, source;
```
CTEs combined with UNION ALL inside a derived table.

---

## EXPLAIN & Query Analysis

### Q113 — EXPLAIN AST of a simple SELECT with WHERE
```sql
EXPLAIN AST
SELECT user_id, event_type, created_at
FROM events
WHERE created_at >= '2025-01-01'
  AND event_type = 'purchase';
```
Shows the abstract syntax tree of the query, useful for understanding how ClickHouse parses expressions.

### Q114 — EXPLAIN PLAN for a JOIN query
```sql
EXPLAIN PLAN
SELECT
    o.order_id,
    o.amount,
    c.customer_name
FROM orders AS o
INNER JOIN customers AS c ON o.customer_id = c.customer_id
WHERE o.created_at >= '2025-06-01';
```
Displays the logical query plan including join strategy and predicate pushdown.

### Q115 — EXPLAIN PIPELINE for an aggregation query
```sql
EXPLAIN PIPELINE
SELECT
    region,
    count() AS order_count,
    sum(amount) AS total_revenue
FROM orders
WHERE status = 'completed'
GROUP BY region
ORDER BY total_revenue DESC;
```
Shows the execution pipeline with parallelism details and processor graph.

### Q116 — EXPLAIN ESTIMATE for a filtered query
```sql
EXPLAIN ESTIMATE
SELECT *
FROM events
WHERE event_date BETWEEN '2025-03-01' AND '2025-03-31'
  AND user_id = 42;
```
Returns estimated rows, marks, and bytes that would be read — useful for query cost estimation without execution.

---

## FORMAT Clause

### Q117 — SELECT with FORMAT JSON
```sql
SELECT
    user_id,
    count() AS page_views,
    max(created_at) AS last_visit
FROM page_views
WHERE event_date = today()
GROUP BY user_id
ORDER BY page_views DESC
LIMIT 100
FORMAT JSON;
```
Outputs the result set as a JSON object with metadata (rows, statistics, column types).

### Q118 — SELECT with FORMAT CSVWithNames
```sql
SELECT
    product_id,
    product_name,
    price,
    stock_quantity
FROM products
WHERE category = 'electronics'
ORDER BY price DESC
FORMAT CSVWithNames;
```
Exports results as CSV with a header row — convenient for spreadsheet imports.

### Q119 — SELECT INTO OUTFILE with FORMAT Parquet
```sql
SELECT
    order_id,
    customer_id,
    order_date,
    amount,
    status
FROM orders
WHERE order_date >= '2025-01-01'
INTO OUTFILE '/tmp/out.parquet'
FORMAT Parquet;
```
Writes query results directly to a Parquet file on the server filesystem.

### Q120 — SELECT with FORMAT Pretty and color settings
```sql
SELECT
    database,
    table,
    formatReadableSize(total_bytes) AS size,
    total_rows
FROM system.tables
WHERE database = currentDatabase()
ORDER BY total_bytes DESC
LIMIT 20
FORMAT Pretty
SETTINGS output_format_pretty_color = 1;
```
Renders a human-readable formatted table with ANSI color codes enabled.

---

## Lightweight DELETE & INSERT SELECT

### Q121 — Lightweight DELETE
```sql
DELETE FROM user_sessions
WHERE last_active_at < now() - INTERVAL 90 DAY
  AND is_anonymous = 1;
```
Lightweight delete marks rows for removal without rewriting entire parts — available on MergeTree tables.

### Q122 — INSERT INTO SELECT with transforms
```sql
INSERT INTO events_aggregated (event_date, user_id, event_type, event_count, first_seen, last_seen)
SELECT
    toDate(created_at) AS event_date,
    user_id,
    event_type,
    count() AS event_count,
    min(created_at) AS first_seen,
    max(created_at) AS last_seen
FROM events_raw
WHERE created_at >= '2025-03-01' AND created_at < '2025-04-01'
GROUP BY event_date, user_id, event_type;
```
Transforms and aggregates data during insert — a common ETL pattern in ClickHouse.

### Q123 — CREATE TABLE AS SELECT (CTAS)
```sql
CREATE TABLE top_customers
ENGINE = MergeTree()
ORDER BY total_spent
AS
SELECT
    customer_id,
    customer_name,
    sum(amount) AS total_spent,
    count() AS order_count,
    max(order_date) AS last_order_date
FROM orders
INNER JOIN customers USING (customer_id)
WHERE order_date >= '2025-01-01'
GROUP BY customer_id, customer_name
HAVING total_spent > 10000;
```
Creates a new table and populates it from a query result in a single statement.

---

## Set Operations

### Q124 — UNION ALL combining two aggregations
```sql
SELECT 'desktop' AS platform, count() AS sessions, uniq(user_id) AS unique_users
FROM desktop_sessions
WHERE session_date = today()
UNION ALL
SELECT 'mobile' AS platform, count() AS sessions, uniq(user_id) AS unique_users
FROM mobile_sessions
WHERE session_date = today();
```
Combines aggregated results from two different tables into a single result set.

### Q125 — INTERSECT to find common user_ids
```sql
SELECT user_id
FROM purchases
WHERE purchase_date >= '2025-03-01'
INTERSECT
SELECT user_id
FROM newsletter_subscribers
WHERE is_active = 1;
```
Returns only user_ids that appear in both result sets — users who purchased AND are active subscribers.

### Q126 — EXCEPT to find exclusive user_ids
```sql
SELECT user_id
FROM registered_users
WHERE registration_date >= '2025-01-01'
EXCEPT
SELECT user_id
FROM orders
WHERE order_date >= '2025-01-01';
```
Finds users who registered this year but have not placed any orders — useful for churn analysis.

---

## DISTINCT ON & WITH TIES

### Q127 — DISTINCT ON for latest row per user
```sql
SELECT DISTINCT ON (user_id)
    user_id,
    session_id,
    device_type,
    created_at
FROM user_sessions
ORDER BY user_id, created_at DESC;
```
Returns only the most recent session for each user — a concise alternative to ROW_NUMBER window functions.

### Q128 — LIMIT WITH TIES
```sql
SELECT
    player_name,
    score,
    game_date
FROM leaderboard
ORDER BY score DESC
LIMIT 10 WITH TIES;
```
Returns the top 10 scores, plus any additional rows that tie with the 10th score.

---

## JSON Functions

### Q129 — JSONExtractString and JSONExtractInt
```sql
SELECT
    event_id,
    JSONExtractString(payload, 'action') AS action,
    JSONExtractInt(payload, 'duration_ms') AS duration_ms,
    JSONExtractString(payload, 'metadata', 'source') AS source
FROM raw_events
WHERE JSONExtractString(payload, 'action') = 'click'
  AND event_date = today()
LIMIT 1000;
```
Extracts typed values from a JSON string column, including nested path access.

### Q130 — JSON_QUERY and JSON_VALUE (SQL/JSON standard)
```sql
SELECT
    request_id,
    JSON_VALUE(response_body, '$.status') AS status,
    JSON_QUERY(response_body, '$.errors') AS errors_array,
    JSON_VALUE(response_body, '$.data.total_count') AS total_count
FROM api_logs
WHERE JSON_VALUE(response_body, '$.status') != 'ok'
  AND logged_at >= now() - INTERVAL 1 HOUR;
```
Uses SQL/JSON standard functions with JSONPath syntax for extraction.

### Q131 — JSONExtractKeysAndValues
```sql
SELECT
    config_id,
    kv.1 AS key,
    kv.2 AS value
FROM feature_flags
ARRAY JOIN JSONExtractKeysAndValues(settings_json, 'String') AS kv
WHERE is_active = 1;
```
Unpacks a JSON object into key-value rows using ARRAY JOIN — useful for dynamic schemas.

### Q132 — simpleJSONExtractString for fast parsing
```sql
SELECT
    log_line,
    simpleJSONExtractString(log_line, 'level') AS log_level,
    simpleJSONExtractString(log_line, 'message') AS message,
    simpleJSONExtractString(log_line, 'trace_id') AS trace_id
FROM raw_logs
WHERE simpleJSONExtractString(log_line, 'level') = 'ERROR'
  AND ingested_at >= now() - INTERVAL 30 MINUTE
LIMIT 500;
```
Uses the fast simple JSON parser — works on flat JSON without nested structures, significantly faster than full JSON functions.

---

## Geo & H3 Functions

### Q133 — geoDistance between two coordinate pairs
```sql
SELECT
    store_id,
    store_name,
    latitude,
    longitude,
    round(geoDistance(longitude, latitude, -73.9857, 40.7484), 0) AS distance_meters
FROM stores
WHERE geoDistance(longitude, latitude, -73.9857, 40.7484) < 5000
ORDER BY distance_meters ASC;
```
Calculates the great-circle distance in meters between each store and a reference point (Empire State Building).

### Q134 — pointInPolygon for geofencing
```sql
SELECT
    event_id,
    user_id,
    latitude,
    longitude
FROM location_events
WHERE pointInPolygon(
    (longitude, latitude),
    [(-73.99, 40.75), (-73.97, 40.75), (-73.97, 40.74), (-73.99, 40.74)]
)
  AND event_date = today();
```
Checks whether GPS coordinates fall within a bounding polygon — geofencing use case.

### Q135 — h3ToGeo to convert H3 index to lat/lon
```sql
SELECT
    h3_index,
    count() AS event_count,
    h3ToGeo(h3_index).2 AS center_lat,
    h3ToGeo(h3_index).1 AS center_lon
FROM geo_events
WHERE event_date >= '2025-03-01'
GROUP BY h3_index
ORDER BY event_count DESC
LIMIT 50;
```
Converts H3 cell indexes back to geographic center coordinates for mapping.

### Q136 — geoToH3 and h3kRing for neighbor lookup
```sql
WITH
    target_cell AS (SELECT geoToH3(-73.9857, 40.7484, 7) AS h3_idx)
SELECT
    h3_index,
    count() AS events
FROM geo_events
WHERE h3_index IN (
    SELECT arrayJoin(h3kRing((SELECT h3_idx FROM target_cell), 1))
)
  AND event_date = today()
GROUP BY h3_index
ORDER BY events DESC;
```
Finds the H3 cell for a given coordinate, then queries all events in the cell and its immediate neighbors using h3kRing.

---

## IP Address Functions

### Q137 — IPv4NumToString and IPv4StringToNum conversions
```sql
SELECT
    IPv4NumToString(ip_num) AS ip_address,
    count() AS request_count,
    uniq(user_id) AS unique_users
FROM access_log
WHERE event_date = today()
GROUP BY ip_num
ORDER BY request_count DESC
LIMIT 25;
```
Converts between numeric and string representations of IPv4 addresses.

### Q138 — IPv4CIDRToRange for network range
```sql
SELECT
    IPv4CIDRToRange(toIPv4('10.0.0.0'), 16) AS network_range,
    (network_range.1) AS range_start,
    (network_range.2) AS range_end,
    toUInt32(range_end) - toUInt32(range_start) + 1 AS total_addresses;
```
Expands a CIDR notation into its start and end IP addresses and calculates the range size.

### Q139 — isIPAddressInRange for subnet matching
```sql
SELECT
    IPv4NumToString(client_ip) AS ip_address,
    request_path,
    response_code
FROM web_requests
WHERE isIPAddressInRange(IPv4NumToString(client_ip), '192.168.1.0/24')
  AND event_date = today()
  AND response_code >= 400
ORDER BY created_at DESC
LIMIT 100;
```
Filters requests originating from a specific subnet — useful for network security monitoring.

---

## Bitmap Functions

### Q140 — bitmapBuild and bitmapCardinality
```sql
SELECT
    campaign_id,
    bitmapCardinality(user_bitmap) AS reach,
    bitmapCardinality(click_bitmap) AS clickers,
    round(bitmapCardinality(click_bitmap) / bitmapCardinality(user_bitmap), 4) AS ctr
FROM (
    SELECT
        campaign_id,
        groupBitmapState(toUInt32(user_id)) AS user_bitmap,
        groupBitmapState(toUInt32(if(clicked = 1, user_id, 0))) AS click_bitmap
    FROM ad_impressions
    WHERE impression_date >= '2025-03-01'
    GROUP BY campaign_id
)
ORDER BY reach DESC;
```
Builds bitmaps from user IDs and computes cardinality for efficient reach and CTR calculations.

### Q141 — bitmapAnd / bitmapOr for set operations
```sql
WITH
    segment_a AS (
        SELECT groupBitmapState(toUInt32(user_id)) AS bm
        FROM user_segments WHERE segment_name = 'high_value'
    ),
    segment_b AS (
        SELECT groupBitmapState(toUInt32(user_id)) AS bm
        FROM user_segments WHERE segment_name = 'recently_active'
    )
SELECT
    bitmapCardinality(bitmapAnd(a.bm, b.bm)) AS intersection_size,
    bitmapCardinality(bitmapOr(a.bm, b.bm)) AS union_size,
    round(bitmapCardinality(bitmapAnd(a.bm, b.bm)) / bitmapCardinality(bitmapOr(a.bm, b.bm)), 4) AS jaccard_index
FROM segment_a AS a, segment_b AS b;
```
Computes intersection and union of two user segments using bitmap operations — orders of magnitude faster than JOIN-based approaches.

### Q142 — bitmapContains for membership check
```sql
WITH user_set AS (
    SELECT groupBitmapState(toUInt32(user_id)) AS bm
    FROM purchase_history
    WHERE purchase_date >= '2025-01-01'
      AND total_amount > 500
)
SELECT
    user_id,
    user_name,
    email
FROM users
WHERE bitmapContains(
    (SELECT bm FROM user_set),
    toUInt32(user_id)
)
ORDER BY user_name;
```
Tests membership of individual user IDs against a precomputed bitmap set.

---

## Conditional Logic

### Q143 — multiIf with multiple branches
```sql
SELECT
    order_id,
    amount,
    multiIf(
        amount < 10,    'micro',
        amount < 100,   'small',
        amount < 1000,  'medium',
        amount < 10000, 'large',
        'enterprise'
    ) AS order_tier,
    count() OVER (PARTITION BY multiIf(amount < 10, 'micro', amount < 100, 'small', amount < 1000, 'medium', amount < 10000, 'large', 'enterprise')) AS tier_count
FROM orders
WHERE order_date = today()
ORDER BY amount DESC;
```
Uses multiIf for concise multi-branch classification with a window function counting per tier.

### Q144 — CASE WHEN with nested conditions
```sql
SELECT
    user_id,
    total_orders,
    total_spent,
    CASE
        WHEN total_orders = 0 THEN 'never_purchased'
        WHEN total_orders = 1 AND total_spent < 50 THEN 'one_time_low'
        WHEN total_orders BETWEEN 2 AND 5 AND total_spent < 500 THEN 'occasional'
        WHEN total_orders > 5 AND total_spent >= 500 AND last_order_days_ago <= 30 THEN 'loyal_active'
        WHEN total_orders > 5 AND last_order_days_ago > 90 THEN 'loyal_churned'
        ELSE 'other'
    END AS customer_segment
FROM (
    SELECT
        user_id,
        count() AS total_orders,
        sum(amount) AS total_spent,
        dateDiff('day', max(order_date), today()) AS last_order_days_ago
    FROM orders
    GROUP BY user_id
);
```
Demonstrates CASE WHEN with compound conditions combining multiple columns for customer segmentation.

### Q145 — countIf vs sum(if(...))
```sql
SELECT
    toStartOfWeek(event_date) AS week,
    count() AS total_events,
    countIf(event_type = 'purchase') AS purchases,
    countIf(event_type = 'signup') AS signups,
    sum(if(event_type = 'purchase', amount, 0)) AS purchase_revenue,
    round(countIf(event_type = 'purchase') / countIf(event_type = 'visit'), 4) AS conversion_rate
FROM events
WHERE event_date >= today() - INTERVAL 12 WEEK
GROUP BY week
ORDER BY week;
```
Compares countIf (specialized aggregate) with sum(if(...)) pattern for conditional aggregation.

---

## Hash Functions

### Q146 — cityHash64 for deterministic hashing and sharding
```sql
SELECT
    user_id,
    cityHash64(user_id) AS hash_value,
    cityHash64(user_id) % 16 AS shard_id,
    cityHash64(user_id) % 100 < 10 AS in_experiment_group
FROM users
WHERE registration_date >= '2025-01-01'
LIMIT 20;
```
Uses cityHash64 for deterministic shard assignment and consistent experiment bucketing.

### Q147 — sipHash128 + hex() for row fingerprinting
```sql
SELECT
    order_id,
    hex(sipHash128(
        toString(order_id),
        toString(customer_id),
        toString(amount),
        toString(order_date),
        status
    )) AS row_fingerprint
FROM orders
WHERE order_date = today()
ORDER BY order_id
LIMIT 50;
```
Generates a 128-bit hash fingerprint of a row for change detection and deduplication.

---

## Parameterized Views & SYSTEM Commands

### Q148 — Parameterized view with {param:Type} syntax
```sql
CREATE VIEW user_activity_report AS
SELECT
    user_id,
    count() AS event_count,
    uniq(event_type) AS distinct_events,
    min(created_at) AS first_event,
    max(created_at) AS last_event
FROM events
WHERE event_date >= {start_date:Date}
  AND event_date <= {end_date:Date}
  AND (event_type = {event_filter:String} OR {event_filter:String} = '')
GROUP BY user_id
ORDER BY event_count DESC;
```
Creates a parameterized view — callers supply start_date, end_date, and event_filter at query time.

### Q149 — SYSTEM FLUSH LOGS
```sql
SYSTEM FLUSH LOGS;
```
Forces all buffered log entries (query_log, part_log, etc.) to be written to their respective system tables immediately — essential before querying recent log data.

### Q150 — SYSTEM RELOAD DICTIONARY
```sql
SYSTEM RELOAD DICTIONARY geo_ip_lookup;
```
Reloads a specific external dictionary from its source, picking up any data changes without restarting the server.

---

## Summary

| Category | Count |
|---|---|
| Basic SELECT & Filtering | 8 |
| Aggregations & GROUP BY | 10 |
| JOIN Operations | 12 |
| Window Functions | 8 |
| Array Functions & Higher-Order Functions | 12 |
| Time Series & Date Functions | 8 |
| Parametric & Specialized Aggregate Functions | 8 |
| String & Text Functions | 5 |
| Table Functions & Data Generation | 5 |
| DDL & Table Engines | 8 |
| ClickHouse-Specific Modifiers & Features | 8 |
| Complex/Weird Queries | 10 |
| Subqueries & WITH (CTE) Expressions | 10 |
| EXPLAIN & Query Analysis | 4 |
| FORMAT Clause | 4 |
| Lightweight DELETE & INSERT SELECT | 3 |
| Set Operations | 3 |
| DISTINCT ON & WITH TIES | 2 |
| JSON Functions | 4 |
| Geo & H3 Functions | 4 |
| IP Address Functions | 3 |
| Bitmap Functions | 3 |
| Conditional Logic | 3 |
| Hash Functions | 2 |
| Parameterized Views & SYSTEM Commands | 3 |
| **Total** | **150** |
