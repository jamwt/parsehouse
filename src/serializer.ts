import type {
  AddProjectionOperation,
  AlterTableStatement,
  AlterTableOperation,
  AttachPartitionOperation,
  ClearProjectionOperation,
  ColumnDefinition,
  ColumnOption,
  CreateTableStatement,
  CreateViewStatement,
  DataType,
  DetachPartitionOperation,
  DescribeStatement,
  DropProjectionOperation,
  Expr,
  ExplainStatement,
  FreezePartitionOperation,
  FromSource,
  FunctionCallExpr,
  Identifier,
  InsertStatement,
  InterpolateClause,
  LiteralExpr,
  MaterializeProjectionOperation,
  OptimizeTableStatement,
  OrderByItem,
  RawAlterOperation,
  SelectItem,
  SelectStatement,
  Setting,
  Statement,
  TypeArgument,
  UnfreezePartitionOperation,
  UseStatement,
  ViewColumnDefinition,
} from "./ast";

function quoteIdentifier(identifier: Identifier): string {
  return identifier.quoted ? `${identifier.quoted}${identifier.name}${identifier.quoted}` : identifier.name;
}

function toObjectName(parts: Identifier[]): string {
  return parts.map(quoteIdentifier).join(".");
}

function normalizeDataTypeName(dataType: DataType): string {
  if (dataType.name.parts.length !== 1) {
    return toObjectName(dataType.name.parts);
  }
  const [part] = dataType.name.parts;
  if (part.quoted) {
    return quoteIdentifier(part);
  }
  const key = part.name.toLowerCase();
  const normalized: Record<string, string> = {
    int: "INT",
    int8: "INT8",
    int16: "INT16",
    int32: "INT32",
    int64: "INT64",
    int128: "INT128",
    int256: "INT256",
    float32: "FLOAT32",
    float64: "FLOAT64",
    string: "STRING",
    bool: "BOOL",
    datetime: "DATETIME",
    uuid: "UUID",
  };
  return normalized[key] ?? part.name;
}

function serializeTypeArgument(argument: TypeArgument): string {
  const value = argument.value;
  if (value.kind === "data_type") {
    return serializeDataType(value);
  }
  if (value.kind === "struct_field") {
    return `${value.name ? `${quoteIdentifier(value.name)} ` : ""}${serializeDataType(value.dataType)}`;
  }
  if (value.kind === "column_definition") {
    return serializeColumnDefinition(value);
  }
  return serializeExpr(value);
}

export function serializeDataType(dataType: DataType): string {
  const name = normalizeDataTypeName(dataType);
  if (!dataType.arguments?.length) {
    return name;
  }
  return `${name}(${dataType.arguments.map(serializeTypeArgument).join(", ")})`;
}

function serializeEngine(engine: Expr): string {
  if (engine.kind === "function_call_expr" && engine.args.length === 0 && !engine.parameters?.length && !engine.settings?.length) {
    return toObjectName(engine.name.parts);
  }
  return serializeExpr(engine);
}

function serializeColumnOption(option: ColumnOption): string {
  switch (option.name) {
    case "NULL":
      return "NULL";
    case "MATERIALIZED":
    case "EPHEMERAL":
    case "ALIAS":
    case "DEFAULT":
      return option.expression ? `${option.name} ${serializeExpr(option.expression)}` : option.name;
    case "RAW":
      return option.raw ?? "";
  }
}

function serializeColumnDefinition(column: ColumnDefinition): string {
  const parts = [quoteIdentifier(column.name), serializeDataType(column.dataType)];
  for (const option of column.options ?? []) {
    parts.push(serializeColumnOption(option));
  }
  return parts.join(" ");
}

function serializeLiteral(expression: LiteralExpr): string {
  switch (expression.literalType) {
    case "null":
      return "NULL";
    case "boolean":
      return expression.value ? "true" : "false";
    case "number":
      return expression.raw ?? String(expression.value);
    case "string":
      return `'${String(expression.value).replace(/'/g, "''")}'`;
  }
}

export function serializeExpr(expression: Expr): string {
  switch (expression.kind) {
    case "wildcard_expr":
      return "*";
    case "literal":
      return serializeLiteral(expression);
    case "identifier_expr":
      return expression.name.kind === "identifier" ? quoteIdentifier(expression.name) : toObjectName(expression.name.parts);
    case "unary_expr":
      return `${expression.operator} ${serializeExpr(expression.operand)}`;
    case "binary_expr":
      return `${serializeExpr(expression.left)} ${expression.operator} ${serializeExpr(expression.right)}`;
    case "parenthesized_expr":
      return `(${serializeExpr(expression.expression)})`;
    case "tuple_expr":
      return `(${expression.items.map(serializeExpr).join(", ")})`;
    case "subquery_expr":
      return `(${expression.query.kind === "select_statement" ? serializeSelect(expression.query) : expression.query.sql})`;
    case "field_access_expr":
      return `${serializeExpr(expression.target)}.${expression.field}`;
    case "interval_expr":
      return `INTERVAL ${serializeExpr(expression.value)} ${expression.unit}`;
    case "array_expr":
      return `[${expression.items.map(serializeExpr).join(", ")}]`;
    case "dictionary_expr":
      return `{${expression.entries.map((entry) => `${serializeExpr(entry.key)}: ${serializeExpr(entry.value)}`).join(", ")}}`;
    case "function_call_expr": {
      const name = toObjectName(expression.name.parts);
      const parameters = expression.parameters ? `(${expression.parameters.map(serializeExpr).join(", ")})` : "";
      const args = expression.args.map(serializeExpr);
      if (expression.settings?.length) {
        args.push(`SETTINGS ${serializeSettings(expression.settings)}`);
      }
      return `${name}${parameters}(${args.join(", ")})`;
    }
    case "subscript_expr":
      return `${serializeExpr(expression.target)}[${serializeExpr(expression.index)}]`;
    case "raw_expr":
      return expression.sql;
  }
}

function serializeSelectItem(item: SelectItem): string {
  if (item.kind === "wildcard_select_item") {
    const qualifier = item.qualifier ? `${toObjectName(item.qualifier.parts)}.` : "";
    const except = item.except?.length ? ` EXCEPT (${item.except.map(quoteIdentifier).join(", ")})` : "";
    return `${qualifier}*${except}`;
  }

  const expression = serializeExpr(item.expression);
  return item.alias ? `${expression} AS ${quoteIdentifier(item.alias)}` : expression;
}

function serializeFromSource(source: FromSource): string {
  if (source.kind === "table_reference") {
    return `${toObjectName(source.name.parts)}${source.final ? " FINAL" : ""}${source.alias ? ` AS ${quoteIdentifier(source.alias)}` : ""}`;
  }
  if (source.kind === "subquery_source") {
    return `(${source.query.kind === "select_statement" ? serializeSelect(source.query) : source.query.sql})${source.alias ? ` AS ${quoteIdentifier(source.alias)}` : ""}`;
  }
  return `${serializeExpr(source.function)}${source.final ? " FINAL" : ""}${source.alias ? ` AS ${quoteIdentifier(source.alias)}` : ""}`;
}

function serializeOrderByItem(item: OrderByItem): string {
  const parts = [serializeExpr(item.expression)];
  if (item.direction) {
    parts.push(item.direction);
  }
  if (item.nulls) {
    parts.push(`NULLS ${item.nulls}`);
  }
  if (item.withFill) {
    parts.push("WITH FILL");
    if (item.withFill.from) {
      parts.push(`FROM ${serializeExpr(item.withFill.from)}`);
    }
    if (item.withFill.to) {
      parts.push(`TO ${serializeExpr(item.withFill.to)}`);
    }
    if (item.withFill.step) {
      parts.push(`STEP ${serializeExpr(item.withFill.step)}`);
    }
  }
  return parts.join(" ");
}

function serializeInterpolate(interpolate: InterpolateClause): string {
  if (!interpolate.items) {
    return "INTERPOLATE";
  }
  return `INTERPOLATE (${interpolate.items.map((item) => item.expression ? `${quoteIdentifier(item.column)} AS ${serializeExpr(item.expression)}` : quoteIdentifier(item.column)).join(", ")})`;
}

function serializeSettings(settings: Setting[]): string {
  return settings.map((setting) => setting.value ? `${quoteIdentifier(setting.key)} = ${serializeExpr(setting.value)}` : quoteIdentifier(setting.key)).join(", ");
}

function serializeViewColumns(columns: ViewColumnDefinition[]): string {
  return `(${columns.map((column) => `${quoteIdentifier(column.name)}${column.dataType ? ` ${serializeDataType(column.dataType)}` : ""}`).join(", ")})`;
}

export function serializeSelect(statement: SelectStatement): string {
  const parts: string[] = [];
  if (statement.with?.length) {
    parts.push(`WITH ${statement.with.map((cte) => cte.value.kind === "select_statement" ? `${quoteIdentifier(cte.name)} AS (${serializeSelect(cte.value)})` : `${serializeExpr(cte.value)} AS ${quoteIdentifier(cte.name)}`).join(", ")}`);
  }
  parts.push(`SELECT${statement.distinct ? " DISTINCT" : ""} ${statement.projection.map(serializeSelectItem).join(", ")}`);
  if (statement.from?.length) {
    parts.push(`FROM ${statement.from.map(serializeFromSource).join(", ")}`);
  }
  if (statement.sample) {
    parts.push(`SAMPLE ${serializeExpr(statement.sample.ratio)}`);
    if (statement.sample.offset) {
      parts.push(`OFFSET ${serializeExpr(statement.sample.offset)}`);
    }
  }
  if (statement.prewhere) {
    parts.push(`PREWHERE ${serializeExpr(statement.prewhere)}`);
  }
  if (statement.where) {
    parts.push(`WHERE ${serializeExpr(statement.where)}`);
  }
  if (statement.groupBy?.length) {
    const lastGroupBy = statement.groupBy.at(-1);
    const modifier = lastGroupBy?.kind === "raw_expr" && lastGroupBy.sql.startsWith("WITH ") ? lastGroupBy.sql : undefined;
    const exprs = modifier ? statement.groupBy.slice(0, -1) : statement.groupBy;
    const groupBySql = exprs.map(serializeExpr).join(", ");
    parts.push(`GROUP BY ${groupBySql}${modifier ? ` ${modifier}` : ""}`);
  }
  if (statement.having) {
    parts.push(`HAVING ${serializeExpr(statement.having)}`);
  }
  if (statement.orderBy?.length) {
    parts.push(`ORDER BY ${statement.orderBy.map(serializeOrderByItem).join(", ")}`);
    if (statement.interpolate) {
      parts.push(serializeInterpolate(statement.interpolate));
    }
  }
  if (statement.limit) {
    const limit = statement.limit;
    if (limit.by) {
      parts.push(`LIMIT ${serializeExpr(limit.by.limit)} BY ${limit.by.by.map(serializeExpr).join(", ")}`);
    } else if (limit.limit) {
      parts.push(`LIMIT ${serializeExpr(limit.limit)}`);
    }
    if (limit.offset) {
      parts.push(`OFFSET ${serializeExpr(limit.offset)}`);
    }
    if (limit.withTies) {
      parts.push("WITH TIES");
    }
  }
  if (statement.settings?.length) {
    parts.push(`SETTINGS ${serializeSettings(statement.settings)}`);
  }
  if (statement.format) {
    parts.push(`FORMAT ${quoteIdentifier(statement.format)}`);
  }
  return parts.join(" ");
}

function serializeCreateTable(statement: CreateTableStatement): string {
  const parts = [
    `CREATE${statement.local ? " LOCAL" : ""}${statement.temporary ? " TEMPORARY" : ""} TABLE${statement.ifNotExists ? " IF NOT EXISTS" : ""} ${toObjectName(statement.name.parts)}`,
  ];
  const tableElements = [...statement.columns.map(serializeColumnDefinition), ...(statement.constraints?.map((constraint) => constraint.sql) ?? [])];
  if (tableElements.length) {
    parts.push(`(${tableElements.join(", ")})`);
  }
  if (statement.onCommit) {
    parts.push(`ON COMMIT ${statement.onCommit}`);
  }
  if (statement.engine) {
    parts.push(`ENGINE = ${serializeEngine(statement.engine as Expr)}`);
  }
  if (statement.primaryKey) {
    parts.push(`PRIMARY KEY ${serializeExpr(statement.primaryKey)}`);
  }
  if (statement.orderBy) {
    parts.push(`ORDER BY ${serializeExpr(statement.orderBy)}`);
  }
  if (statement.asSelect) {
    parts.push(`AS ${serializeSelect(statement.asSelect)}`);
  }
  return parts.join(" ");
}

function serializeCreateView(statement: CreateViewStatement): string {
  const parts = [
    `CREATE${statement.materialized ? " MATERIALIZED" : ""} VIEW${statement.ifNotExists ? " IF NOT EXISTS" : ""} ${toObjectName(statement.name.parts)}`,
  ];
  if (statement.columns?.length) {
    parts.push(serializeViewColumns(statement.columns));
  }
  if (statement.to) {
    parts.push(`TO ${toObjectName(statement.to.parts)}`);
  }
  parts.push(`AS ${serializeSelect(statement.query)}`);
  return parts.join(" ");
}

function serializeOptimizeTable(statement: OptimizeTableStatement): string {
  const parts = [`OPTIMIZE TABLE ${toObjectName(statement.name.parts)}`];
  if (statement.onCluster) {
    parts.push(`ON CLUSTER ${serializeExpr(statement.onCluster)}`);
  }
  if (statement.partitionId) {
    parts.push(`PARTITION ID ${quoteIdentifier(statement.partitionId)}`);
  } else if (statement.partition) {
    parts.push(`PARTITION ${serializeExpr(statement.partition)}`);
  }
  if (statement.final) {
    parts.push("FINAL");
  }
  if (statement.deduplicate) {
    parts.push("DEDUPLICATE");
    if (statement.deduplicateBy) {
      parts.push(`BY ${serializeExpr(statement.deduplicateBy)}`);
    }
  }
  return parts.join(" ");
}

function serializeUse(statement: UseStatement): string {
  return `USE ${toObjectName(statement.database.parts)}`;
}

function serializeDescribe(statement: DescribeStatement): string {
  return `${statement.alias ?? "DESCRIBE"}${statement.hasTableKeyword === false ? "" : " TABLE"} ${toObjectName(statement.target.parts)}`;
}

function serializeExplain(statement: ExplainStatement): string {
  return `EXPLAIN ${toSql(statement.target)}`;
}

function serializeInsert(statement: InsertStatement): string {
  const parts = [
    `INSERT INTO${statement.tableKeyword ? " TABLE" : ""}${statement.intoFunction ? " FUNCTION" : ""} ${statement.target.kind === "function_call_expr" ? serializeExpr(statement.target) : toObjectName(statement.target.parts)}`,
  ];
  if (statement.columns?.length) {
    parts.push(`(${statement.columns.map(quoteIdentifier).join(", ")})`);
  }
  if (statement.settings?.length) {
    parts.push(`SETTINGS ${serializeSettings(statement.settings)}`);
  }
  if (statement.values) {
    parts.push(`VALUES ${statement.values.map((row) => `(${row.map(serializeExpr).join(", ")})`).join(", ")}`);
  } else if (statement.query) {
    parts.push(serializeSelect(statement.query));
  }
  if (statement.format) {
    parts.push(`FORMAT ${quoteIdentifier(statement.format)}`);
  }
  if (statement.payload) {
    parts.push(statement.payload);
  }
  return parts.join(" ");
}

function serializeProjectionOpPrefix(keyword: string, operation: AddProjectionOperation | DropProjectionOperation | ClearProjectionOperation | MaterializeProjectionOperation): string {
  if (operation.kind === "add_projection_operation") {
    return `${keyword}${operation.ifNotExists ? " IF NOT EXISTS" : ""}`;
  }
  return `${keyword}${operation.ifExists ? " IF EXISTS" : ""}`;
}

function serializeAlterOperation(operation: AlterTableOperation): string {
  switch (operation.kind) {
    case "attach_partition_operation":
      return `ATTACH ${operation.partKeyword ? "PART" : "PARTITION"} ${serializeExpr(operation.partition)}`;
    case "detach_partition_operation":
      return `DETACH ${operation.partKeyword ? "PART" : "PARTITION"} ${serializeExpr(operation.partition)}`;
    case "add_projection_operation":
      return `${serializeProjectionOpPrefix("ADD PROJECTION", operation)} ${quoteIdentifier(operation.name)} (${serializeSelect(operation.query)})`;
    case "drop_projection_operation":
      return `${serializeProjectionOpPrefix("DROP PROJECTION", operation)} ${quoteIdentifier(operation.name)}`;
    case "clear_projection_operation": {
      const sql = `${serializeProjectionOpPrefix("CLEAR PROJECTION", operation)} ${quoteIdentifier(operation.name)}`;
      return operation.partition ? `${sql} IN PARTITION ${quoteIdentifier(operation.partition)}` : sql;
    }
    case "materialize_projection_operation": {
      const sql = `${serializeProjectionOpPrefix("MATERIALIZE PROJECTION", operation)} ${quoteIdentifier(operation.name)}`;
      return operation.partition ? `${sql} IN PARTITION ${quoteIdentifier(operation.partition)}` : sql;
    }
    case "freeze_partition_operation":
      return `FREEZE PARTITION ${serializeExpr(operation.partition)}${operation.withName ? ` WITH NAME ${quoteIdentifier(operation.withName)}` : ""}`;
    case "unfreeze_partition_operation":
      return `UNFREEZE PARTITION ${serializeExpr(operation.partition)}${operation.withName ? ` WITH NAME ${quoteIdentifier(operation.withName)}` : ""}`;
    case "raw_alter_operation":
      return operation.sql;
  }
}

function serializeAlterTable(statement: AlterTableStatement): string {
  return `ALTER TABLE ${toObjectName(statement.name.parts)} ${statement.operations.map(serializeAlterOperation).join(", ")}`;
}

export function toSql(node: Statement | Expr): string {
  switch (node.kind) {
    case "select_statement":
      return serializeSelect(node);
    case "create_table_statement":
      return serializeCreateTable(node);
    case "create_view_statement":
      return serializeCreateView(node);
    case "optimize_table_statement":
      return serializeOptimizeTable(node);
    case "kill_statement":
      return `KILL${node.modifier ? ` ${node.modifier}` : ""} ${node.id}`;
    case "use_statement":
      return serializeUse(node);
    case "describe_statement":
      return serializeDescribe(node);
    case "explain_statement":
      return serializeExplain(node);
    case "insert_statement":
      return serializeInsert(node);
    case "alter_table_statement":
      return serializeAlterTable(node);
    case "raw_statement":
      return node.sql;
    default:
      return serializeExpr(node);
  }
}

export function formatSql(node: Statement | Expr | string): string {
  return typeof node === "string" ? toSql({ kind: "raw_statement", sql: node }) : toSql(node);
}
