import type {
  AddProjectionOperation,
  AlterTableStatement,
  AlterTableOperation,
  ArrayExpr,
  AttachPartitionOperation,
  ClearProjectionOperation,
  ColumnDefinition,
  ColumnOption,
  CreateTableStatement,
  CreateViewStatement,
  Cte,
  DataType,
  DetachPartitionOperation,
  DescribeStatement,
  DictionaryEntry,
  Expr,
  ExpressionSelectItem,
  ExplainStatement,
  FreezePartitionOperation,
  FromSource,
  FunctionCallExpr,
  Identifier,
  IdentifierExpr,
  InsertStatement,
  InterpolateClause,
  InterpolateItem,
  KillStatement,
  LimitClause,
  MaterializeProjectionOperation,
  ObjectName,
  OptimizeTableStatement,
  OrderByItem,
  OrderByWithFill,
  RawExpr,
  RawAlterOperation,
  SelectItem,
  SelectStatement,
  Setting,
  Statement,
  StructField,
  SubquerySource,
  TableReference,
  TypeArgument,
  UnfreezePartitionOperation,
  UseStatement,
  ViewColumnDefinition,
  WildcardSelectItem,
} from "./ast";
import type { Dialect, ParseOptions } from "./dialect";
import { ClickHouseDialect, getDialect } from "./dialect";
import type { Token } from "./tokenizer";
import { tokenize } from "./tokenizer";

const ALIAS_STOPWORDS = new Set([
  "FROM",
  "SAMPLE",
  "PREWHERE",
  "WHERE",
  "GROUP",
  "HAVING",
  "WINDOW",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "SETTINGS",
  "FORMAT",
  "FINAL",
  "UNION",
  "JOIN",
  "ON",
  "SETTINGS",
  ",",
  ";",
]);

function identifier(name: string, quoted?: Identifier["quoted"]): Identifier {
  return { kind: "identifier", name, quoted };
}

function objectName(parts: Identifier[]): ObjectName {
  return { kind: "object_name", parts };
}

function identifierExpr(name: Identifier | ObjectName): IdentifierExpr {
  return { kind: "identifier_expr", name };
}

function rawExpr(sql: string): RawExpr {
  return { kind: "raw_expr", sql };
}

function formatIdentifier(identifier: Identifier): string {
  return identifier.quoted ? `${identifier.quoted}${identifier.name}${identifier.quoted}` : identifier.name;
}

function binary(operator: string, left: Expr, right: Expr): Expr {
  return { kind: "binary_expr", operator, left, right };
}

function unary(operator: string, operand: Expr): Expr {
  return { kind: "unary_expr", operator, operand };
}

function normalizeTokenValue(token: Token): string {
  return token.type === "word" ? token.value.toUpperCase() : token.value;
}

class Parser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(
    private readonly sql: string,
    private readonly dialect: Dialect,
  ) {
    this.tokens = tokenize(sql);
  }

  parseStatements(): Statement[] {
    const statements: Statement[] = [];
    while (!this.is("eof")) {
      if (this.isPunctuation(";")) {
        this.index += 1;
        continue;
      }
      statements.push(this.parseStatement());
      if (this.isPunctuation(";")) {
        this.index += 1;
      }
    }
    return statements;
  }

  parseSingleStatement(): Statement {
    const statement = this.parseStatementBody();
    if (!this.isStatementBoundary()) {
      throw new SyntaxError(`Unexpected token ${this.peek().value}`);
    }
    if (this.isPunctuation(";")) {
      this.index += 1;
    }
    if (!this.is("eof")) {
      throw new SyntaxError(`Expected exactly one statement, found extra token ${this.peek().value}`);
    }
    return statement;
  }

  private parseStatement(): Statement {
    const start = this.peek().start;
    const parsed = this.parseStatementBody();
    if (this.isStatementBoundary()) {
      return parsed;
    }
    return { kind: "raw_statement", sql: this.consumeStatementSql(start) };
  }

  private parseStatementBody(): Statement {
    if (this.matchKeyword("WITH") || this.matchKeyword("SELECT")) {
      return this.parseSelectStatement();
    }
    if (this.matchKeyword("CREATE")) {
      return this.parseCreateStatement();
    }
    if (this.matchKeyword("OPTIMIZE")) {
      return this.parseOptimizeTableStatement();
    }
    if (this.matchKeyword("KILL")) {
      return this.parseKillStatement();
    }
    if (this.matchKeyword("USE")) {
      return this.parseUseStatement();
    }
    if (this.matchKeyword("DESCRIBE") || this.matchKeyword("DESC")) {
      return this.parseDescribeStatement();
    }
    if (this.matchKeyword("EXPLAIN")) {
      return this.parseExplainStatement();
    }
    if (this.matchKeyword("INSERT")) {
      return this.parseInsertStatement();
    }
    if (this.matchKeyword("ALTER")) {
      return this.parseAlterTableStatement();
    }

    return { kind: "raw_statement", sql: this.consumeRemainingSql() };
  }

  private parseCreateStatement(): Statement {
    this.expectKeyword("CREATE");
    if (this.matchKeyword("MATERIALIZED")) {
      this.expectKeyword("MATERIALIZED");
      this.expectKeyword("VIEW");
      return this.parseCreateViewStatement(true);
    }
    if (this.matchKeyword("VIEW")) {
      this.expectKeyword("VIEW");
      return this.parseCreateViewStatement(false);
    }
    const local = this.parseKeyword("LOCAL");
    const temporary = this.parseKeyword("TEMPORARY");
    this.expectKeyword("TABLE");
    return this.parseCreateTableStatement(local, temporary);
  }

  private parseCreateTableStatement(local = false, temporary = false): CreateTableStatement {
    const ifNotExists = this.parseIfNotExists();
    const name = this.parseObjectName();
    const columns: ColumnDefinition[] = [];
    const constraints: RawExpr[] = [];
    if (this.parsePunctuation("(")) {
      while (!this.isPunctuation(")")) {
        if (this.matchKeyword("CHECK")) {
          constraints.push(this.parseCheckConstraint());
        } else if (this.matchKeyword("CONSTRAINT")) {
          constraints.push(rawExpr(this.consumeTableElementSql()));
        } else {
          columns.push(this.parseColumnDefinition());
        }
        if (!this.parsePunctuation(",")) {
          break;
        }
      }
      this.expectPunctuation(")");
    }

    let engine: Expr | undefined;
    let partitionBy: Expr | undefined;
    let onCommit: string | undefined;
    let primaryKey: Expr | undefined;
    let orderBy: Expr | undefined;
    let settings: Setting[] | undefined;
    let asSelect: SelectStatement | undefined;

    while (!this.isStatementBoundary()) {
      if (this.parseKeyword("ENGINE")) {
        this.expectOperator("=");
        engine = this.parseEngineExpression();
        continue;
      }
      if (this.parseKeyword("PARTITION")) {
        this.expectKeyword("BY");
        partitionBy = this.parseExpr();
        continue;
      }
      if (this.parseKeyword("ON")) {
        this.expectKeyword("COMMIT");
        onCommit = this.consumeKeywords("PRESERVE", "ROWS");
        continue;
      }
      if (this.parseKeyword("PRIMARY")) {
        this.expectKeyword("KEY");
        primaryKey = this.parseExpr();
        continue;
      }
      if (this.parseKeyword("ORDER")) {
        this.expectKeyword("BY");
        orderBy = this.parseExpr();
        continue;
      }
      if (this.parseKeyword("SETTINGS")) {
        settings = this.parseCommaSeparated(() => this.parseSetting(), "AS", ";", "eof");
        continue;
      }
      if (this.parseKeyword("AS")) {
        asSelect = this.parseSelectStatement();
        continue;
      }
      break;
    }

    return {
      kind: "create_table_statement",
      local,
      temporary,
      ifNotExists,
      name,
      columns,
      constraints: constraints.length ? constraints : undefined,
      engine,
      partitionBy,
      onCommit,
      primaryKey,
      orderBy,
      settings,
      asSelect,
    };
  }

  private parseCreateViewStatement(materialized: boolean): CreateViewStatement {
    const ifNotExists = this.parseIfNotExists();
    const name = this.parseObjectName();
    let columns: ViewColumnDefinition[] | undefined;
    let to: ObjectName | undefined;

    if (this.parsePunctuation("(")) {
      columns = this.parseCommaSeparated(() => {
        const columnName = this.parseIdentifier();
        const dataType = !this.isPunctuation(",") && !this.isPunctuation(")") ? this.parseDataType() : undefined;
        if (!dataType) {
          throw new SyntaxError("View column definitions must include data types");
        }
        return { kind: "view_column_definition", name: columnName, dataType };
      }, ")");
      this.expectPunctuation(")");
    }

    if (materialized && this.parseKeyword("TO")) {
      to = this.parseObjectName();
    }

    this.expectKeyword("AS");
    const query = this.parseSelectStatement();
    return {
      kind: "create_view_statement",
      materialized,
      ifNotExists,
      name,
      columns,
      to,
      query,
    };
  }

  private parseOptimizeTableStatement(): OptimizeTableStatement {
    this.expectKeyword("OPTIMIZE");
    this.expectKeyword("TABLE");
    const name = this.parseObjectName();
    let onCluster: Expr | undefined;
    let partition: Expr | undefined;
    let partitionId: Identifier | undefined;
    let final = false;
    let deduplicate = false;
    let deduplicateBy: Expr | undefined;

    if (this.parseKeyword("ON")) {
      this.expectKeyword("CLUSTER");
      onCluster = this.parseExpr();
    }

    if (this.parseKeyword("PARTITION")) {
      if (this.parseKeyword("ID")) {
        partitionId = this.parseIdentifier();
      } else {
        partition = this.parseExpr();
      }
    }

    final = this.parseKeyword("FINAL");
    if (this.parseKeyword("DEDUPLICATE")) {
      deduplicate = true;
      if (this.parseKeyword("BY")) {
        deduplicateBy = this.parseExpr();
      }
    }

    return {
      kind: "optimize_table_statement",
      name,
      onCluster,
      partition,
      partitionId,
      final,
      deduplicate,
      deduplicateBy,
    };
  }

  private parseKillStatement(): KillStatement {
    this.expectKeyword("KILL");
    const modifier = this.peek().type === "word" ? this.consume().value.toUpperCase() : undefined;
    const id = Number(this.expect("number").value);
    return { kind: "kill_statement", modifier, id };
  }

  private parseUseStatement(): UseStatement {
    this.expectKeyword("USE");
    return { kind: "use_statement", database: this.parseObjectName() };
  }

  private parseDescribeStatement(): DescribeStatement {
    const alias = this.matchKeyword("DESC") ? "DESC" : "DESCRIBE";
    this.consume();
    const hasTableKeyword = this.parseKeyword("TABLE");
    return { kind: "describe_statement", alias, hasTableKeyword, target: this.parseObjectName() };
  }

  private parseExplainStatement(): ExplainStatement {
    this.expectKeyword("EXPLAIN");
    const target = this.matchKeyword("SELECT") || this.matchKeyword("WITH") ? this.parseSelectStatement() : ({ kind: "raw_statement", sql: this.consumeRemainingSql() } as Statement);
    return { kind: "explain_statement", target };
  }

  private parseInsertStatement(): InsertStatement {
    this.expectKeyword("INSERT");
    this.expectKeyword("INTO");
    const tableKeyword = this.parseKeyword("TABLE");
    const intoFunction = this.parseKeyword("FUNCTION");
    const target = intoFunction ? this.parseFunctionCallFromName(this.parseObjectName()) : this.parseObjectName();
    let columns: Identifier[] | undefined;
    let settings: Setting[] | undefined;
    let values: Expr[][] | undefined;
    let query: SelectStatement | undefined;
    let format: Identifier | undefined;
    let payload: string | undefined;

    if (this.parsePunctuation("(")) {
      columns = this.parseCommaSeparated(() => this.parseIdentifier(), ")");
      this.expectPunctuation(")");
    }

    if (this.parseKeyword("SETTINGS")) {
      settings = this.parseCommaSeparated(() => this.parseSetting(), "VALUES", "SELECT", "WITH", "FORMAT", ";", "eof");
    }

    if (this.parseKeyword("VALUES")) {
      values = [];
      do {
        this.expectPunctuation("(");
        const row = this.parseCommaSeparated(() => this.parseExpr(), ")");
        this.expectPunctuation(")");
        values.push(row);
      } while (this.parsePunctuation(","));
    } else if (this.matchKeyword("SELECT") || this.matchKeyword("WITH")) {
      query = this.parseSelectStatement();
    }

    if (this.parseKeyword("FORMAT")) {
      format = this.parseIdentifier();
      if (!this.is("eof") && !this.isPunctuation(";")) {
        payload = this.consumeRemainingSql().trim();
      }
    }

    return {
      kind: "insert_statement",
      intoFunction,
      tableKeyword,
      target,
      columns,
      settings,
      values,
      query,
      format,
      payload,
    };
  }

  private parseAlterTableStatement(): AlterTableStatement {
    this.expectKeyword("ALTER");
    this.expectKeyword("TABLE");
    const name = this.parseObjectName();
    const operations = this.parseAlterTableOperations();
    return { kind: "alter_table_statement", name, operations };
  }

  private parseAlterTableOperations(): AlterTableOperation[] {
    const operations: AlterTableOperation[] = [];
    while (!this.is("eof") && !this.isPunctuation(";")) {
      operations.push(this.parseAlterTableOperation());
      if (!this.parsePunctuation(",")) {
        break;
      }
    }
    return operations;
  }

  private parseAlterTableOperation(): AlterTableOperation {
    if (this.matchKeyword("ATTACH")) {
      return this.parseAttachDetachPartitionOperation(true);
    }
    if (this.matchKeyword("DETACH")) {
      return this.parseAttachDetachPartitionOperation(false);
    }
    if (this.matchKeyword("ADD")) {
      return this.parseAddProjectionOperation();
    }
    if (this.matchKeyword("DROP")) {
      return this.parseDropProjectionOperation();
    }
    if (this.matchKeyword("CLEAR")) {
      return this.parseClearOrMaterializeProjectionOperation(true);
    }
    if (this.matchKeyword("MATERIALIZE")) {
      return this.parseClearOrMaterializeProjectionOperation(false);
    }
    if (this.matchKeyword("FREEZE")) {
      return this.parseFreezePartitionOperation(true);
    }
    if (this.matchKeyword("UNFREEZE")) {
      return this.parseFreezePartitionOperation(false);
    }
    return { kind: "raw_alter_operation", sql: this.consumeUntilCommaOrEnd() };
  }

  private parseAttachDetachPartitionOperation(attach: boolean): AttachPartitionOperation | DetachPartitionOperation {
    this.consume();
    const partKeyword = this.parseKeyword("PART");
    if (!partKeyword) {
      this.expectKeyword("PARTITION");
    }
    if (this.is("eof") || this.isPunctuation(",") || this.isPunctuation(";")) {
      throw new SyntaxError(`Expected partition expression, found ${this.peek().value || "EOF"}`);
    }
    const partition = this.parseExpr();
    return attach
      ? { kind: "attach_partition_operation", partKeyword, partition }
      : { kind: "detach_partition_operation", partKeyword, partition };
  }

  private parseAddProjectionOperation(): AddProjectionOperation | RawAlterOperation {
    this.expectKeyword("ADD");
    if (!this.parseKeyword("PROJECTION")) {
      return { kind: "raw_alter_operation", sql: `ADD ${this.consumeUntilCommaOrEnd()}`.trim() };
    }
    const ifNotExists = this.parseIfNotExists();
    const name = this.parseIdentifier();
    this.expectPunctuation("(");
    const query = this.parseSelectStatement();
    this.expectPunctuation(")");
    return { kind: "add_projection_operation", ifNotExists, name, query };
  }

  private parseDropProjectionOperation(): AlterTableOperation {
    this.expectKeyword("DROP");
    if (!this.parseKeyword("PROJECTION")) {
      return { kind: "raw_alter_operation", sql: `DROP ${this.consumeUntilCommaOrEnd()}`.trim() };
    }
    const ifExists = this.parseIfExists();
    const name = this.parseIdentifier();
    return { kind: "drop_projection_operation", ifExists, name };
  }

  private parseClearOrMaterializeProjectionOperation(clear: boolean): ClearProjectionOperation | MaterializeProjectionOperation | RawAlterOperation {
    this.consume();
    const keyword = clear ? "CLEAR" : "MATERIALIZE";
    if (!this.parseKeyword("PROJECTION")) {
      return { kind: "raw_alter_operation", sql: `${keyword} ${this.consumeUntilCommaOrEnd()}`.trim() };
    }
    const ifExists = this.parseIfExists();
    const name = this.parseIdentifier();
    let partition: Identifier | undefined;
    if (this.parseKeyword("IN")) {
      this.expectKeyword("PARTITION");
      partition = this.parseIdentifier();
    }
    return clear
      ? { kind: "clear_projection_operation", ifExists, name, partition }
      : { kind: "materialize_projection_operation", ifExists, name, partition };
  }

  private parseFreezePartitionOperation(freeze: boolean): FreezePartitionOperation | UnfreezePartitionOperation {
    this.consume();
    this.expectKeyword("PARTITION");
    if (this.is("eof") || this.isPunctuation(",") || this.isPunctuation(";")) {
      throw new SyntaxError(`Expected partition expression, found ${this.peek().value || "EOF"}`);
    }
    const partition = this.parseExpr();
    let withName: Identifier | undefined;
    if (this.parseKeyword("WITH")) {
      this.expectKeyword("NAME");
      withName = this.parseIdentifier();
    }
    return freeze
      ? { kind: "freeze_partition_operation", partition, withName }
      : { kind: "unfreeze_partition_operation", partition, withName };
  }

  private parseSelectStatement(): SelectStatement {
    const withClause = this.parseWithClause();
    this.expectKeyword("SELECT");
    const distinct = this.parseKeyword("DISTINCT");
    const projection = this.parseCommaSeparated(() => this.parseSelectItem(), "FROM", "PREWHERE", "WHERE", "GROUP", "HAVING", "WINDOW", "ORDER", "LIMIT", "OFFSET", "SETTINGS", "UNION", ";", "eof");
    let from: FromSource[] | undefined;
    let sample: SelectStatement["sample"] | undefined;
    let prewhere: Expr | undefined;
    let where: Expr | undefined;
    let groupBy: Expr[] | undefined;
    let having: Expr | undefined;
    let windows: RawExpr[] | undefined;
    let orderBy: OrderByItem[] | undefined;
    let interpolate: InterpolateClause | undefined;
    let limit: LimitClause | undefined;
    let settings: Setting[] | undefined;
    let format: Identifier | undefined;

    if (this.parseKeyword("FROM")) {
      from = this.parseCommaSeparated(() => this.parseFromSource(), "SAMPLE", "PREWHERE", "WHERE", "GROUP", "HAVING", "WINDOW", "ORDER", "LIMIT", "OFFSET", "SETTINGS", "FORMAT", "UNION", ";", "eof");
    }
    if (this.parseKeyword("SAMPLE")) {
      const ratio = this.parseExpr();
      const sampleOffset = this.parseKeyword("OFFSET") ? this.parseExpr() : undefined;
      sample = { ratio, offset: sampleOffset };
    }
    if (this.parseKeyword("PREWHERE")) {
      prewhere = this.parseExpr();
    }
    if (this.parseKeyword("WHERE")) {
      where = this.parseExpr();
    }
    if (this.parseKeyword("GROUP")) {
      this.expectKeyword("BY");
      if (this.matchKeyword("GROUPING")) {
        groupBy = [rawExpr(this.consumeUntilClauseBoundary())];
      } else {
        groupBy = this.parseCommaSeparated(() => this.parseExpr(), "HAVING", "WINDOW", "ORDER", "LIMIT", "OFFSET", "SETTINGS", "FORMAT", "UNION", ";", "eof", "WITH");
      }
      if (this.parseKeyword("WITH")) {
        groupBy = [...(groupBy ?? []), rawExpr(`WITH ${this.consumeUntilClauseBoundary()}`)];
      }
    }
    if (this.parseKeyword("HAVING")) {
      having = this.parseExpr();
    }
    if (this.parseKeyword("WINDOW")) {
      windows = this.parseCommaSeparated(() => this.parseWindowDefinition(), "ORDER", "LIMIT", "OFFSET", "SETTINGS", "FORMAT", "UNION", ";", "eof");
    }
    if (this.parseKeyword("ORDER")) {
      this.expectKeyword("BY");
      orderBy = this.parseCommaSeparated(() => this.parseOrderByItem(), "LIMIT", "OFFSET", "SETTINGS", "FORMAT", "UNION", ";", "eof", "INTERPOLATE");
      if (this.parseKeyword("INTERPOLATE")) {
        interpolate = this.parseInterpolateClause();
      }
    }
    while (true) {
      if (!limit && (this.matchKeyword("LIMIT") || this.matchKeyword("OFFSET"))) {
        limit = this.parseLimitClause();
        continue;
      }
      if (!settings && this.parseKeyword("SETTINGS")) {
        settings = this.parseCommaSeparated(() => this.parseSetting(), "FORMAT", "UNION", ";", "eof");
        continue;
      }
      if (!format && this.parseKeyword("FORMAT")) {
        format = this.parseIdentifier();
        continue;
      }
      break;
    }

    return {
      kind: "select_statement",
      with: withClause,
      distinct,
      projection,
      from,
      sample,
      prewhere,
      where,
      groupBy,
      having,
      windows,
      orderBy,
      interpolate,
      limit,
      settings,
      format,
    };
  }

  private parseWithClause(): Cte[] | undefined {
    if (!this.parseKeyword("WITH")) {
      return undefined;
    }
    const items: Cte[] = [];
    while (true) {
      if (this.parsePunctuation("(")) {
        const value = this.matchKeyword("SELECT") || this.matchKeyword("WITH") ? this.parseSelectStatement() : this.parseExpr();
        this.expectPunctuation(")");
        this.expectKeyword("AS");
        const name = this.parseIdentifier();
        items.push({ kind: "cte", name, value });
      } else {
        const name = this.parseIdentifier();
        this.expectKeyword("AS");
        if (this.parsePunctuation("(")) {
          const value = this.matchKeyword("SELECT") || this.matchKeyword("WITH") ? this.parseSelectStatement() : this.parseExpr();
          this.expectPunctuation(")");
          items.push({ kind: "cte", name, value });
        } else {
          items.push({ kind: "cte", name, value: this.parseExpr() });
        }
      }
      if (!this.parsePunctuation(",")) {
        break;
      }
      if (this.matchKeyword("SELECT")) {
        break;
      }
    }
    return items;
  }

  private parseSelectItem(): SelectItem {
    if (this.parseOperator("*")) {
      const item: WildcardSelectItem = { kind: "wildcard_select_item" };
      if (this.parseKeyword("EXCEPT")) {
        item.except = this.parseExceptList();
      }
      return item;
    }

    const expression = this.parseExpr();
    const item: ExpressionSelectItem = { kind: "expression_select_item", expression };
    if (this.parseKeyword("AS")) {
      item.alias = this.parseIdentifier();
    } else if (this.peek().type === "word" && !ALIAS_STOPWORDS.has(normalizeTokenValue(this.peek()))) {
      item.alias = this.parseIdentifier();
    }
    return item;
  }

  private parseExceptList(): Identifier[] {
    if (this.parsePunctuation("(")) {
      const values = this.parseCommaSeparated(() => this.parseIdentifier(), ")");
      this.expectPunctuation(")");
      return values;
    }
    return [this.parseIdentifier()];
  }

  private parseFromSource(): FromSource {
    if (this.parsePunctuation("(")) {
      const start = this.peek().start;
      const query = this.parseSelectStatement();
      if (!this.isPunctuation(")")) {
        const raw = this.consumeUntilClosingParenContent(start);
        this.expectPunctuation(")");
        const alias = this.parseOptionalAlias();
        return { kind: "subquery_source", query: { kind: "raw_statement", sql: raw }, alias };
      }
      this.expectPunctuation(")");
      const alias = this.parseOptionalAlias();
      const source: SubquerySource = { kind: "subquery_source", query, alias };
      return source;
    }

    const name = this.parseObjectName();
    if (this.isPunctuation("(")) {
      const fn = this.parseFunctionCallFromName(name);
      const final = this.dialect.supportsFinal && this.parseKeyword("FINAL");
      const alias = this.parseOptionalAlias();
      return { kind: "function_table_source", function: fn, final, alias };
    }
    const final = this.dialect.supportsFinal && this.parseKeyword("FINAL");
    const alias = this.parseOptionalAlias();
    const source: TableReference = { kind: "table_reference", name, alias, final };
    return source;
  }

  private parseOrderByItem(): OrderByItem {
    const expression = this.parseExpr();
    const direction = this.parseKeyword("ASC") ? "ASC" : this.parseKeyword("DESC") ? "DESC" : undefined;
    let nulls: "FIRST" | "LAST" | undefined;
    if (this.parseKeyword("NULLS")) {
      nulls = this.parseKeyword("FIRST") ? "FIRST" : this.parseKeyword("LAST") ? "LAST" : undefined;
    }
    let withFill: OrderByWithFill | undefined;
    if (this.parseKeyword("WITH")) {
      this.expectKeyword("FILL");
      let from: Expr | undefined;
      let to: Expr | undefined;
      let step: Expr | undefined;
      if (this.parseKeyword("FROM")) {
        from = this.parseExpr();
      }
      if (this.parseKeyword("TO")) {
        to = this.parseExpr();
      }
      if (this.parseKeyword("STEP")) {
        step = this.parseExpr();
      }
      withFill = { kind: "order_by_with_fill", from, to, step };
    }
    return { kind: "order_by_item", expression, direction, nulls, withFill };
  }

  private parseInterpolateClause(): InterpolateClause {
    if (!this.parsePunctuation("(")) {
      return { kind: "interpolate_clause" };
    }
    if (this.parsePunctuation(")")) {
      return { kind: "interpolate_clause", items: [] };
    }
    const items = this.parseCommaSeparated(() => this.parseInterpolateItem(), ")");
    this.expectPunctuation(")");
    return { kind: "interpolate_clause", items };
  }

  private parseInterpolateItem(): InterpolateItem {
    const column = this.parseIdentifier();
    let expression: Expr | undefined;
    if (this.parseKeyword("AS")) {
      expression = this.parseExpr();
    }
    return { kind: "interpolate_item", column, expression };
  }

  private parseWindowDefinition(): RawExpr {
    const name = this.parseIdentifier();
    this.expectKeyword("AS");
    this.expectPunctuation("(");
    const content = this.consumeBalancedContent();
    this.expectPunctuation(")");
    return rawExpr(`${formatIdentifier(name)} AS (${content})`);
  }

  private parseLimitClause(): LimitClause {
    let offset: Expr | undefined;
    let limitExpr: Expr | undefined;
    let by: LimitClause["by"];
    let withTies = false;
    if (this.parseKeyword("LIMIT")) {
      limitExpr = this.parseExpr();
      if (this.parseKeyword("BY")) {
        by = {
          kind: "limit_by_clause",
          limit: limitExpr,
          by: this.parseCommaSeparated(() => this.parseExpr(), "LIMIT", "OFFSET", "SETTINGS", "FORMAT", "UNION", ";", "eof"),
        };
        limitExpr = this.parseKeyword("LIMIT") ? this.parseExpr() : undefined;
      }
      if (limitExpr && this.parseKeyword("WITH")) {
        this.expectKeyword("TIES");
        withTies = true;
      }
    }
    if (this.parseKeyword("OFFSET")) {
      offset = this.parseExpr();
    }
    return { kind: "limit_clause", limit: limitExpr, offset, by, withTies };
  }

  private parseSetting(): Setting {
    const key = this.parseIdentifier();
    this.expectOperator("=");
    const value = this.parseExpr();
    return { kind: "setting", key, value };
  }

  private parseColumnDefinition(): ColumnDefinition {
    const name = this.parseIdentifier();
    const dataType = this.parseDataType();
    const options: ColumnOption[] = [];
    while (this.peek().type === "word") {
      const keyword = normalizeTokenValue(this.peek());
      if (keyword === "NULL") {
        this.consume();
        options.push({ kind: "column_option", name: "NULL" });
        continue;
      }
      if (keyword === "NOT" && this.matchKeywordAt(1, "NULL")) {
        this.consume();
        this.consume();
        options.push({ kind: "column_option", name: "RAW", raw: "NOT NULL" });
        continue;
      }
      if (keyword === "MATERIALIZED") {
        this.consume();
        options.push({ kind: "column_option", name: "MATERIALIZED", expression: this.parseExprUntilColumnBoundary() });
        continue;
      }
      if (keyword === "EPHEMERAL") {
        this.consume();
        const expression = this.isColumnOptionBoundary() ? undefined : this.parseExprUntilColumnBoundary();
        options.push({ kind: "column_option", name: "EPHEMERAL", expression });
        continue;
      }
      if (keyword === "ALIAS") {
        this.consume();
        options.push({ kind: "column_option", name: "ALIAS", expression: this.parseExprUntilColumnBoundary() });
        continue;
      }
      if (keyword === "DEFAULT") {
        this.consume();
        options.push({ kind: "column_option", name: "DEFAULT", expression: this.parseExprUntilColumnBoundary() });
        continue;
      }
      if (keyword === "CODEC") {
        this.consume();
        options.push({ kind: "column_option", name: "RAW", raw: `CODEC(${this.consumeParenthesizedContent()})` });
        continue;
      }
      break;
    }
    return { kind: "column_definition", name, dataType, options: options.length ? options : undefined };
  }

  private parseDataType(): DataType {
    const name = this.parseObjectName();
    let args: TypeArgument[] | undefined;
    if (this.parsePunctuation("(")) {
      args = [];
      if (!this.isPunctuation(")")) {
        do {
          if (this.looksLikeStructField()) {
            const fieldName = this.parseIdentifier();
            const fieldType = this.parseDataType();
            args.push({ kind: "type_argument", value: { kind: "struct_field", name: fieldName, dataType: fieldType } as StructField });
          } else if (this.looksLikeColumnDefinition()) {
            args.push({ kind: "type_argument", value: this.parseColumnDefinition() });
          } else if (this.looksLikeDataType()) {
            args.push({ kind: "type_argument", value: this.parseDataType() });
          } else {
            args.push({ kind: "type_argument", value: this.parseExpr() });
          }
        } while (this.parsePunctuation(","));
      }
      this.expectPunctuation(")");
    }
    return { kind: "data_type", name, arguments: args };
  }

  private parseEngineExpression(): Expr {
    const name = this.parseObjectName();
    if (this.isPunctuation("(")) {
      return this.parseFunctionCallFromName(name);
    }
    return identifierExpr(name);
  }

  private parseExpr(precedence = 0): Expr {
    let left = this.parsePrefix();
    while (true) {
      if (this.matchKeyword("NOT") && this.matchKeywordAt(1, "NULL")) {
        this.consume();
        this.consume();
        left = binary("IS NOT", left, { kind: "literal", literalType: "null", value: null });
        continue;
      }
      if (this.matchKeyword("IS")) {
        const next = this.peek(1);
        const nextValue = normalizeTokenValue(next);
        if (nextValue === "NULL") {
          this.consume();
          this.consume();
          left = binary("IS", left, { kind: "literal", literalType: "null", value: null });
          continue;
        }
        if (nextValue === "NOT" && this.matchKeywordAt(2, "NULL")) {
          this.consume();
          this.consume();
          this.consume();
          left = binary("IS NOT", left, { kind: "literal", literalType: "null", value: null });
          continue;
        }
      }
      const nextPrecedence = this.getBinaryPrecedence();
      if (nextPrecedence <= precedence) {
        break;
      }
      const operator = this.consumeOperatorKeyword();
      const right = this.parseExpr(nextPrecedence);
      left = binary(operator, left, right);
    }
    return left;
  }

  private parsePrefix(): Expr {
    if (this.parseOperator("+")) {
      return unary("+", this.parseExpr(6));
    }
    if (this.parseOperator("-")) {
      return unary("-", this.parseExpr(6));
    }
    if (this.parseKeyword("NOT")) {
      return unary("NOT", this.parseExpr(6));
    }
    if (this.parseKeyword("EXISTS")) {
      return unary("EXISTS", this.parsePrimary());
    }
    if (this.parseKeyword("INTERVAL")) {
      const value = this.parsePrimary();
      const unit = this.parseIdentifier().name.toUpperCase();
      return { kind: "interval_expr", value, unit };
    }
    return this.parsePostfix(this.parsePrimary());
  }

  private parsePostfix(base: Expr): Expr {
    let current = base;
    while (true) {
      if (this.parsePunctuation("[")) {
        const index = this.parseExpr();
        this.expectPunctuation("]");
        current = { kind: "subscript_expr", target: current, index };
        continue;
      }
      if (this.parsePunctuation(".")) {
        const token = this.peek();
        if (token.type === "number" || token.type === "word" || token.type === "quoted_identifier") {
          current = { kind: "field_access_expr", target: current, field: this.consume().value };
          continue;
        }
        throw new SyntaxError(`Expected field name, found ${token.value}`);
      }
      if (this.parseKeyword("OVER")) {
        if (this.parsePunctuation("(")) {
          current = rawExpr(`${this.serializeExprForConstraint(current)} OVER (${this.consumeBalancedContent()})`);
          this.expectPunctuation(")");
        } else {
          current = rawExpr(`${this.serializeExprForConstraint(current)} OVER ${this.parseIdentifier().name}`);
        }
        continue;
      }
      break;
    }
    return current;
  }

  private parsePrimary(): Expr {
    const token = this.peek();
    if (this.parseOperator("*")) {
      return { kind: "wildcard_expr" };
    }
    if (token.type === "number") {
      this.consume();
      const raw = token.value;
      const value = /^0x/i.test(raw)
        ? Number.parseInt(raw.replaceAll("_", "").slice(2), 16)
        : Number(raw.replaceAll("_", ""));
      return { kind: "literal", literalType: "number", value, raw };
    }
    if (token.type === "string") {
      this.consume();
      return { kind: "literal", literalType: "string", value: token.value };
    }
    if (token.type === "quoted_identifier") {
      const id = this.parseIdentifier();
      return this.parseIdentifierExpressionContinuation(this.parseObjectNameFromFirst(id));
    }
    if (this.parsePunctuation("(")) {
      if (this.matchKeyword("SELECT") || this.matchKeyword("WITH")) {
        const start = this.peek().start;
        const query = this.parseSelectStatement();
        if (!this.isPunctuation(")")) {
          const raw = this.consumeUntilClosingParenContent(start);
          this.expectPunctuation(")");
          return { kind: "subquery_expr", query: { kind: "raw_statement", sql: raw } };
        }
        this.expectPunctuation(")");
        return { kind: "subquery_expr", query };
      }
      const expression = this.parseExpr();
      if (this.parsePunctuation(",")) {
        const items = [expression];
        do {
          items.push(this.parseExpr());
        } while (this.parsePunctuation(","));
        this.expectPunctuation(")");
        return { kind: "tuple_expr", items };
      }
      this.expectPunctuation(")");
      return { kind: "parenthesized_expr", expression };
    }
    if (this.parsePunctuation("[")) {
      const items = this.parseCommaSeparated(() => this.parseExpr(), "]");
      this.expectPunctuation("]");
      return { kind: "array_expr", items } as ArrayExpr;
    }
    if (this.parsePunctuation("{")) {
      const entries: DictionaryEntry[] = [];
      if (!this.isPunctuation("}")) {
        do {
          const key = this.parseExpr();
          this.expectPunctuation(":");
          const value = this.parseExpr();
          entries.push({ kind: "dictionary_entry", key, value });
        } while (this.parsePunctuation(","));
      }
      this.expectPunctuation("}");
      return { kind: "dictionary_expr", entries };
    }

    if (token.type === "word") {
      const normalized = normalizeTokenValue(token);
      if (normalized === "NULL") {
        this.consume();
        return { kind: "literal", literalType: "null", value: null };
      }
      if (normalized === "TRUE" || normalized === "FALSE") {
        this.consume();
        return { kind: "literal", literalType: "boolean", value: normalized === "TRUE" };
      }
      const name = this.parseObjectName();
      return this.parseIdentifierExpressionContinuation(name);
    }

    throw new SyntaxError(`Unexpected token ${token.value}`);
  }

  private parseIdentifierExpressionContinuation(value: Identifier | ObjectName): Expr {
    const name = value.kind === "identifier" ? objectName([value]) : value;
    if (this.isPunctuation("(") ) {
      return this.parseFunctionCallFromName(name);
    }
    return identifierExpr(value.kind === "identifier" ? value : name);
  }

  private parseFunctionCallFromName(name: ObjectName): FunctionCallExpr {
    const first = this.parseArgumentList();
    const parameters = this.isPunctuation("(") ? first.args : undefined;
    const second = parameters ? this.parseArgumentList() : first;
    return { kind: "function_call_expr", name, args: second.args, parameters, settings: second.settings };
  }

  private parseArgumentList(): { args: Expr[]; settings?: Setting[] } {
    this.expectPunctuation("(");
    const args: Expr[] = [];
    let settings: Setting[] | undefined;
    while (!this.isPunctuation(")")) {
      if (this.parseKeyword("SETTINGS")) {
        settings = this.parseCommaSeparated(() => this.parseSetting(), ")");
        break;
      }
      let argument = this.parseExpr();
      if (this.parseKeyword("AS")) {
        const alias = this.parseIdentifier();
        argument = rawExpr(`${this.serializeExprForConstraint(argument)} AS ${alias.quoted ? `${alias.quoted}${alias.name}${alias.quoted}` : alias.name}`);
      }
      args.push(argument);
      if (!this.parsePunctuation(",")) {
        break;
      }
      if (this.matchKeyword("SETTINGS")) {
        continue;
      }
    }
    this.expectPunctuation(")");
    return { args, settings };
  }

  private parseObjectName(): ObjectName {
    const parts = [this.parseIdentifier()];
    while (this.isPunctuation(".") && this.canParseIdentifier(1)) {
      this.parsePunctuation(".");
      parts.push(this.parseIdentifier());
    }
    return objectName(parts);
  }

  private parseObjectNameFromFirst(first: Identifier): ObjectName {
    const parts = [first];
    while (this.isPunctuation(".") && this.canParseIdentifier(1)) {
      this.parsePunctuation(".");
      parts.push(this.parseIdentifier());
    }
    return objectName(parts);
  }

  private canParseIdentifier(offset = 0): boolean {
    const token = this.peek(offset);
    return token.type === "word" || token.type === "quoted_identifier" || token.type === "string";
  }

  private parseIdentifier(): Identifier {
    const token = this.peek();
    if (token.type === "quoted_identifier") {
      this.consume();
      return identifier(token.value, this.sql[token.start] as Identifier["quoted"]);
    }
    if (token.type === "string") {
      this.consume();
      return identifier(token.value, "'");
    }
    if (token.type === "word") {
      this.consume();
      return identifier(token.value);
    }
    throw new SyntaxError(`Expected identifier, found ${token.value}`);
  }

  private parseOptionalAlias(): Identifier | undefined {
    if (this.parseKeyword("AS")) {
      return this.parseIdentifier();
    }
    if (this.peek().type === "word" && !ALIAS_STOPWORDS.has(normalizeTokenValue(this.peek()))) {
      return this.parseIdentifier();
    }
    return undefined;
  }

  private parseIfNotExists(): boolean {
    if (!this.parseKeyword("IF")) {
      return false;
    }
    this.expectKeyword("NOT");
    this.expectKeyword("EXISTS");
    return true;
  }

  private parseIfExists(): boolean {
    if (!this.parseKeyword("IF")) {
      return false;
    }
    this.expectKeyword("EXISTS");
    return true;
  }

  private parseCommaSeparated<T>(parseItem: () => T, ...stopValues: string[]): T[] {
    const items: T[] = [];
    while (!this.isStop(stopValues)) {
      items.push(parseItem());
      if (!this.parsePunctuation(",")) {
        break;
      }
    }
    return items;
  }

  private isStop(stopValues: string[]): boolean {
    const token = this.peek();
    if (token.type === "eof") {
      return stopValues.includes("eof");
    }
    const normalized = normalizeTokenValue(token);
    return stopValues.includes(normalized) || stopValues.includes(token.value);
  }

  private isStatementBoundary(): boolean {
    return this.is("eof") || this.isPunctuation(";");
  }

  private isColumnOptionBoundary(): boolean {
    const token = this.peek();
    return token.type === "eof" || token.value === "," || token.value === ")" || normalizeTokenValue(token) === "ENGINE" || normalizeTokenValue(token) === "PRIMARY" || normalizeTokenValue(token) === "ORDER" || normalizeTokenValue(token) === "AS";
  }

  private looksLikeDataType(): boolean {
    return this.peek().type === "word" || this.peek().type === "quoted_identifier";
  }

  private looksLikeStructField(): boolean {
    const current = this.peek();
    const next = this.peek(1);
    return (current.type === "word" || current.type === "quoted_identifier") && (next.type === "word" || next.type === "quoted_identifier");
  }

  private looksLikeColumnDefinition(): boolean {
    const current = this.peek();
    const next = this.peek(1);
    const afterNext = this.peek(2);
    return (current.type === "word" || current.type === "quoted_identifier") && (next.type === "word" || next.type === "quoted_identifier") && afterNext.value !== ",";
  }

  private getBinaryPrecedence(): number {
    const token = this.peek();
    const value = normalizeTokenValue(token);
    if (value === "->") return 1;
    if (value === "OR") return 1;
    if (value === "AND") return 2;
    if (value === "NOT" && this.matchKeywordAt(1, "NULL")) return 3;
    if (["=", "==", "!=", "<>", "<", ">", "<=", ">=", "LIKE", "IN", "IS"].includes(value)) return 3;
    if (["+", "-"].includes(value)) return 4;
    if (["*", "/", "%"].includes(value)) return 5;
    return 0;
  }

  private consumeOperatorKeyword(): string {
    const token = this.consume();
    const value = normalizeTokenValue(token);
    return value === "==" ? "=" : value;
  }

  private consumeRemainingSql(): string {
    const start = this.peek().start;
    const end = this.tokens.at(-1)?.start ?? this.sql.length;
    this.index = this.tokens.length - 1;
    return this.sql.slice(start, end).trim();
  }

  private consumeStatementSql(start: number): string {
    while (!this.is("eof") && !this.isPunctuation(";")) {
      this.consume();
    }
    return this.sql.slice(start, this.peek().start).trim();
  }

  private matchKeyword(keyword: string): boolean {
    return this.peek().type === "word" && normalizeTokenValue(this.peek()) === keyword;
  }

  private matchKeywordAt(offset: number, keyword: string): boolean {
    return this.peek(offset).type === "word" && normalizeTokenValue(this.peek(offset)) === keyword;
  }

  private parseKeyword(keyword: string): boolean {
    if (this.matchKeyword(keyword)) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private expectKeyword(keyword: string): void {
    if (!this.parseKeyword(keyword)) {
      throw new SyntaxError(`Expected keyword ${keyword}, found ${this.peek().value}`);
    }
  }

  private parsePunctuation(value: string): boolean {
    if (this.peek().type === "punctuation" && this.peek().value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private isPunctuation(value: string): boolean {
    return this.peek().type === "punctuation" && this.peek().value === value;
  }

  private expectPunctuation(value: string): void {
    if (!this.parsePunctuation(value)) {
      throw new SyntaxError(`Expected ${value}, found ${this.peek().value}`);
    }
  }

  private parseOperator(value: string): boolean {
    if ((this.peek().type === "operator" || this.peek().type === "punctuation") && this.peek().value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private expectOperator(value: string): void {
    if (!this.parseOperator(value)) {
      throw new SyntaxError(`Expected operator ${value}, found ${this.peek().value}`);
    }
  }

  private is(type: Token["type"]): boolean {
    return this.peek().type === type;
  }

  private expect(type: Token["type"]): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new SyntaxError(`Expected ${type}, found ${token.value}`);
    }
    return this.consume();
  }

  private peek(offset = 0): Token {
    return this.tokens[this.index + offset] ?? this.tokens[this.tokens.length - 1]!;
  }

  private consume(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  private consumeKeywords(...keywords: string[]): string {
    return keywords
      .map((keyword) => {
        this.expectKeyword(keyword);
        return keyword;
      })
      .join(" ");
  }

  private consumeTableElementSql(): string {
    const start = this.peek().start;
    let depth = 0;
    while (!this.is("eof")) {
      const token = this.peek();
      if (token.type === "punctuation") {
        if (token.value === "(") {
          depth += 1;
        } else if (token.value === ")") {
          if (depth === 0) {
            break;
          }
          depth -= 1;
        } else if (token.value === "," && depth === 0) {
          break;
        }
      }
      this.consume();
    }
    const end = this.peek().start;
    return this.sql.slice(start, end).trim();
  }

  private consumeUntilCommaOrEnd(): string {
    const start = this.peek().start;
    let depth = 0;
    while (!this.is("eof") && !this.isPunctuation(";")) {
      const token = this.peek();
      if (token.type === "punctuation") {
        if (["(", "[", "{"].includes(token.value)) {
          depth += 1;
        } else if ([")", "]", "}"].includes(token.value)) {
          depth = Math.max(0, depth - 1);
        } else if (token.value === "," && depth === 0) {
          break;
        }
      }
      this.consume();
    }
    return this.sql.slice(start, this.peek().start).trim();
  }

  private consumeUntilClauseBoundary(): string {
    const start = this.peek().start;
    let depth = 0;
    while (!this.is("eof") && !this.isPunctuation(";") && !this.isPunctuation(",")) {
      const token = this.peek();
      if (token.type === "punctuation") {
        if (["(", "[", "{"].includes(token.value)) {
          depth += 1;
        } else if ([")", "]", "}"].includes(token.value)) {
          depth = Math.max(0, depth - 1);
        }
      }
      if (depth === 0 && token.type === "word" && ["HAVING", "WINDOW", "ORDER", "LIMIT", "OFFSET", "SETTINGS", "FORMAT", "UNION", "WHERE"].includes(normalizeTokenValue(token))) {
        break;
      }
      this.consume();
    }
    return this.sql.slice(start, this.peek().start).trim();
  }

  private consumeBalancedContent(): string {
    const start = this.peek().start;
    let depth = 0;
    while (!this.is("eof")) {
      const token = this.peek();
      if (token.type === "punctuation") {
        if (["(", "[", "{"].includes(token.value)) {
          depth += 1;
        } else if ([")", "]", "}"].includes(token.value)) {
          if (depth === 0 && token.value === ")") {
            break;
          }
          depth -= 1;
        }
      }
      this.consume();
    }
    return this.sql.slice(start, this.peek().start).trim();
  }

  private consumeParenthesizedContent(): string {
    this.expectPunctuation("(");
    const content = this.consumeBalancedContent();
    this.expectPunctuation(")");
    return content;
  }

  private consumeUntilClosingParenContent(start: number): string {
    let depth = 0;
    while (!this.is("eof")) {
      const token = this.peek();
      if (token.type === "punctuation") {
        if (token.value === "(") {
          depth += 1;
        } else if (token.value === ")") {
          if (depth === 0) {
            break;
          }
          depth -= 1;
        }
      }
      this.consume();
    }
    return this.sql.slice(start, this.peek().start).trim();
  }

  private serializeSelectForRaw(statement: SelectStatement): string {
    const projection = statement.projection.map((item) => item.kind === "wildcard_select_item" ? "*" : this.serializeExprForConstraint(item.expression)).join(", ");
    const parts = [`SELECT${statement.distinct ? " DISTINCT" : ""} ${projection}`];
    if (statement.from?.length) {
      parts.push(`FROM ${statement.from.map((source) => source.kind === "table_reference" ? source.name.parts.map((part) => part.quoted ? `${part.quoted}${part.name}${part.quoted}` : part.name).join(".") : source.kind === "function_table_source" ? this.serializeExprForConstraint(source.function) : `(${source.query.kind === "raw_statement" ? source.query.sql : this.serializeSelectForRaw(source.query)})`).join(", ")}`);
    }
    if (statement.where) {
      parts.push(`WHERE ${this.serializeExprForConstraint(statement.where)}`);
    }
    if (statement.groupBy?.length) {
      parts.push(`GROUP BY ${statement.groupBy.map((expr) => this.serializeExprForConstraint(expr)).join(", ")}`);
    }
    if (statement.having) {
      parts.push(`HAVING ${this.serializeExprForConstraint(statement.having)}`);
    }
    if (statement.orderBy?.length) {
      parts.push(`ORDER BY ${statement.orderBy.map((item) => this.serializeExprForConstraint(item.expression)).join(", ")}`);
    }
    if (statement.limit?.limit) {
      parts.push(`LIMIT ${this.serializeExprForConstraint(statement.limit.limit)}`);
    }
    return parts.join(" ");
  }

  private parseCheckConstraint(): RawExpr {
    this.expectKeyword("CHECK");
    this.expectPunctuation("(");
    const expression = this.parseExpr();
    this.expectPunctuation(")");
    return rawExpr(`CHECK (${this.serializeExprForConstraint(expression)})`);
  }

  private serializeExprForConstraint(expression: Expr): string {
    if (expression.kind === "literal") {
      if (expression.literalType === "null") return "NULL";
      if (expression.literalType === "boolean") return expression.value ? "true" : "false";
      if (expression.literalType === "number") return String(expression.value);
      return `'${String(expression.value).replace(/'/g, "''")}'`;
    }
    if (expression.kind === "identifier_expr") {
      return expression.name.kind === "identifier"
        ? (expression.name.quoted ? `${expression.name.quoted}${expression.name.name}${expression.name.quoted}` : expression.name.name)
        : expression.name.parts.map((part) => (part.quoted ? `${part.quoted}${part.name}${part.quoted}` : part.name)).join(".");
    }
    if (expression.kind === "parenthesized_expr") {
      return `(${this.serializeExprForConstraint(expression.expression)})`;
    }
    if (expression.kind === "tuple_expr") {
      return `(${expression.items.map((item) => this.serializeExprForConstraint(item)).join(", ")})`;
    }
    if (expression.kind === "subquery_expr") {
      return `(${expression.query.kind === "raw_statement" ? expression.query.sql : this.serializeSelectForRaw(expression.query)})`;
    }
    if (expression.kind === "field_access_expr") {
      return `${this.serializeExprForConstraint(expression.target)}.${expression.field}`;
    }
    if (expression.kind === "interval_expr") {
      return `INTERVAL ${this.serializeExprForConstraint(expression.value)} ${expression.unit}`;
    }
    if (expression.kind === "binary_expr") {
      return `${this.serializeExprForConstraint(expression.left)} ${expression.operator} ${this.serializeExprForConstraint(expression.right)}`;
    }
    if (expression.kind === "unary_expr") {
      return `${expression.operator} ${this.serializeExprForConstraint(expression.operand)}`;
    }
    if (expression.kind === "function_call_expr") {
      const args = expression.args.map((arg) => this.serializeExprForConstraint(arg)).join(", ");
      const params = expression.parameters?.length ? `(${expression.parameters.map((arg) => this.serializeExprForConstraint(arg)).join(", ")})` : "";
      return `${expression.name.parts.map((part) => part.name).join(".")}${params}(${args})`;
    }
    if (expression.kind === "subscript_expr") {
      return `${this.serializeExprForConstraint(expression.target)}[${this.serializeExprForConstraint(expression.index)}]`;
    }
    if (expression.kind === "array_expr") {
      return `[${expression.items.map((item) => this.serializeExprForConstraint(item)).join(", ")}]`;
    }
    if (expression.kind === "dictionary_expr") {
      return `{${expression.entries.map((entry) => `${this.serializeExprForConstraint(entry.key)}: ${this.serializeExprForConstraint(entry.value)}`).join(", ")}}`;
    }
    if (expression.kind === "wildcard_expr") {
      return "*";
    }
    if (expression.kind === "raw_expr") {
      return expression.sql;
    }
    return "";
  }

  private parseExprUntilColumnBoundary(): Expr {
    const startIndex = this.index;
    let cursor = this.index;
    let depth = 0;

    while (cursor < this.tokens.length) {
      const token = this.tokens[cursor]!;
      if (token.type === "eof") {
        break;
      }
      if (token.type === "punctuation") {
        if (["(", "[", "{"].includes(token.value)) {
          depth += 1;
        } else if ([")", "]", "}"].includes(token.value)) {
          if (depth === 0 && token.value === ")") {
            break;
          }
          depth -= 1;
        } else if (token.value === "," && depth === 0) {
          break;
        }
      }
      if (depth === 0 && token.type === "word") {
        const normalized = normalizeTokenValue(token);
        const next = this.tokens[cursor + 1];
        if (normalized === "NOT" && next?.type === "word" && normalizeTokenValue(next) === "NULL") {
          break;
        }
      }
      cursor += 1;
    }

    const start = this.tokens[startIndex]?.start ?? this.peek().start;
    const end = this.tokens[cursor]?.start ?? this.peek().end;
    this.index = cursor;
    const sql = this.sql.slice(start, end).trim();
    return new Parser(sql, this.dialect).parseExpr();
  }
}

export function parseSql(sql: string, options?: ParseOptions): Statement[] {
  const dialect = getDialect(options);
  return new Parser(sql, dialect).parseStatements();
}

export function parseStatement(sql: string, options?: ParseOptions): Statement {
  const dialect = getDialect(options);
  return new Parser(sql, dialect).parseSingleStatement();
}

export function parseExpr(sql: string, options?: ParseOptions): Expr {
  const dialect = getDialect(options);
  const parser = new Parser(sql, dialect);
  const statement = parser["parseExpr"]();
  return statement;
}

export function defaultClickHouseDialect(): Dialect {
  return new ClickHouseDialect();
}
