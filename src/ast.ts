export interface Span {
  start: number;
  end: number;
}

export interface BaseNode {
  kind: string;
  span?: Span;
}

export interface Identifier extends BaseNode {
  kind: "identifier";
  name: string;
  quoted?: "'" | '"' | "`";
}

export interface ObjectName extends BaseNode {
  kind: "object_name";
  parts: Identifier[];
}

export interface LiteralExpr extends BaseNode {
  kind: "literal";
  literalType: "string" | "number" | "boolean" | "null";
  value: string | number | boolean | null;
  raw?: string;
}

export interface WildcardExpr extends BaseNode {
  kind: "wildcard_expr";
}

export interface IdentifierExpr extends BaseNode {
  kind: "identifier_expr";
  name: Identifier | ObjectName;
}

export interface UnaryExpr extends BaseNode {
  kind: "unary_expr";
  operator: string;
  operand: Expr;
}

export interface BinaryExpr extends BaseNode {
  kind: "binary_expr";
  operator: string;
  left: Expr;
  right: Expr;
}

export interface ParenthesizedExpr extends BaseNode {
  kind: "parenthesized_expr";
  expression: Expr;
}

export interface TupleExpr extends BaseNode {
  kind: "tuple_expr";
  items: Expr[];
}

export interface SubqueryExpr extends BaseNode {
  kind: "subquery_expr";
  query: SelectStatement | RawStatement;
}

export interface FieldAccessExpr extends BaseNode {
  kind: "field_access_expr";
  target: Expr;
  field: string;
}

export interface IntervalExpr extends BaseNode {
  kind: "interval_expr";
  value: Expr;
  unit: string;
}

export interface ArrayExpr extends BaseNode {
  kind: "array_expr";
  items: Expr[];
}

export interface DictionaryEntry extends BaseNode {
  kind: "dictionary_entry";
  key: Expr;
  value: Expr;
}

export interface DictionaryExpr extends BaseNode {
  kind: "dictionary_expr";
  entries: DictionaryEntry[];
}

export interface FunctionCallExpr extends BaseNode {
  kind: "function_call_expr";
  name: ObjectName;
  args: Expr[];
  parameters?: Expr[];
  settings?: Setting[];
}

export interface SubscriptExpr extends BaseNode {
  kind: "subscript_expr";
  target: Expr;
  index: Expr;
}

export interface RawExpr extends BaseNode {
  kind: "raw_expr";
  sql: string;
}

export type Expr =
  | WildcardExpr
  | LiteralExpr
  | IdentifierExpr
  | UnaryExpr
  | BinaryExpr
  | ParenthesizedExpr
  | TupleExpr
  | SubqueryExpr
  | FieldAccessExpr
  | IntervalExpr
  | ArrayExpr
  | DictionaryExpr
  | FunctionCallExpr
  | SubscriptExpr
  | RawExpr;

export interface WildcardSelectItem extends BaseNode {
  kind: "wildcard_select_item";
  qualifier?: ObjectName;
  except?: Identifier[];
}

export interface ExpressionSelectItem extends BaseNode {
  kind: "expression_select_item";
  expression: Expr;
  alias?: Identifier;
}

export type SelectItem = WildcardSelectItem | ExpressionSelectItem;

export interface TableReference extends BaseNode {
  kind: "table_reference";
  name: ObjectName;
  alias?: Identifier;
  final?: boolean;
}

export interface SubquerySource extends BaseNode {
  kind: "subquery_source";
  query: SelectStatement | RawStatement;
  alias?: Identifier;
}

export interface FunctionTableSource extends BaseNode {
  kind: "function_table_source";
  function: FunctionCallExpr;
  alias?: Identifier;
  final?: boolean;
}

export type FromSource = TableReference | SubquerySource | FunctionTableSource;

export interface OrderByWithFill extends BaseNode {
  kind: "order_by_with_fill";
  from?: Expr;
  to?: Expr;
  step?: Expr;
}

export interface OrderByItem extends BaseNode {
  kind: "order_by_item";
  expression: Expr;
  direction?: "ASC" | "DESC";
  nulls?: "FIRST" | "LAST";
  withFill?: OrderByWithFill;
}

export interface InterpolateItem extends BaseNode {
  kind: "interpolate_item";
  column: Identifier;
  expression?: Expr;
}

export interface InterpolateClause extends BaseNode {
  kind: "interpolate_clause";
  items?: InterpolateItem[];
}

export interface LimitByClause extends BaseNode {
  kind: "limit_by_clause";
  limit: Expr;
  by: Expr[];
}

export interface LimitClause extends BaseNode {
  kind: "limit_clause";
  limit?: Expr;
  offset?: Expr;
  by?: LimitByClause;
  withTies?: boolean;
}

export interface Setting extends BaseNode {
  kind: "setting";
  key: Identifier;
  value?: Expr;
}

export interface Cte extends BaseNode {
  kind: "cte";
  name: Identifier;
  value: SelectStatement | Expr;
}

export interface SelectStatement extends BaseNode {
  kind: "select_statement";
  with?: Cte[];
  distinct?: boolean;
  projection: SelectItem[];
  from?: FromSource[];
  sample?: {
    ratio: Expr;
    offset?: Expr;
  };
  prewhere?: Expr;
  where?: Expr;
  groupBy?: Expr[];
  having?: Expr;
  windows?: RawExpr[];
  orderBy?: OrderByItem[];
  interpolate?: InterpolateClause;
  limit?: LimitClause;
  settings?: Setting[];
  format?: Identifier;
}

export interface TypeArgument extends BaseNode {
  kind: "type_argument";
  value: Expr | DataType | StructField | ColumnDefinition;
}

export interface StructField extends BaseNode {
  kind: "struct_field";
  name?: Identifier;
  dataType: DataType;
}

export interface DataType extends BaseNode {
  kind: "data_type";
  name: ObjectName;
  arguments?: TypeArgument[];
}

export interface ColumnOption extends BaseNode {
  kind: "column_option";
  name: "NULL" | "MATERIALIZED" | "EPHEMERAL" | "ALIAS" | "DEFAULT" | "RAW";
  expression?: Expr;
  raw?: string;
}

export interface ColumnDefinition extends BaseNode {
  kind: "column_definition";
  name: Identifier;
  dataType: DataType;
  options?: ColumnOption[];
}

export interface CreateTableStatement extends BaseNode {
  kind: "create_table_statement";
  local?: boolean;
  temporary?: boolean;
  ifNotExists?: boolean;
  name: ObjectName;
  columns: ColumnDefinition[];
  constraints?: RawExpr[];
  engine?: Expr | IdentifierExpr | FunctionCallExpr | RawExpr;
  partitionBy?: Expr;
  onCommit?: string;
  primaryKey?: Expr;
  orderBy?: Expr;
  settings?: Setting[];
  asSelect?: SelectStatement;
}

export interface ViewColumnDefinition extends BaseNode {
  kind: "view_column_definition";
  name: Identifier;
  dataType?: DataType;
}

export interface CreateViewStatement extends BaseNode {
  kind: "create_view_statement";
  materialized?: boolean;
  ifNotExists?: boolean;
  name: ObjectName;
  columns?: ViewColumnDefinition[];
  to?: ObjectName;
  query: SelectStatement;
}

export interface OptimizeTableStatement extends BaseNode {
  kind: "optimize_table_statement";
  name: ObjectName;
  onCluster?: Expr;
  partition?: Expr;
  partitionId?: Identifier;
  final?: boolean;
  deduplicate?: boolean;
  deduplicateBy?: Expr;
}

export interface KillStatement extends BaseNode {
  kind: "kill_statement";
  modifier?: string;
  id: number;
}

export interface UseStatement extends BaseNode {
  kind: "use_statement";
  database: ObjectName;
}

export interface DescribeStatement extends BaseNode {
  kind: "describe_statement";
  alias?: "DESCRIBE" | "DESC";
  hasTableKeyword?: boolean;
  target: ObjectName;
}

export interface ExplainStatement extends BaseNode {
  kind: "explain_statement";
  target: Statement | RawStatement;
}

export interface InsertStatement extends BaseNode {
  kind: "insert_statement";
  intoFunction?: boolean;
  tableKeyword?: boolean;
  target: ObjectName | FunctionCallExpr;
  columns?: Identifier[];
  settings?: Setting[];
  values?: Expr[][];
  query?: SelectStatement;
  format?: Identifier;
  payload?: string;
}

export interface AttachPartitionOperation extends BaseNode {
  kind: "attach_partition_operation";
  partKeyword: boolean;
  partition: Expr;
}

export interface DetachPartitionOperation extends BaseNode {
  kind: "detach_partition_operation";
  partKeyword: boolean;
  partition: Expr;
}

export interface AddProjectionOperation extends BaseNode {
  kind: "add_projection_operation";
  ifNotExists?: boolean;
  name: Identifier;
  query: SelectStatement;
}

export interface DropProjectionOperation extends BaseNode {
  kind: "drop_projection_operation";
  ifExists?: boolean;
  name: Identifier;
}

export interface ClearProjectionOperation extends BaseNode {
  kind: "clear_projection_operation";
  ifExists?: boolean;
  name: Identifier;
  partition?: Identifier;
}

export interface MaterializeProjectionOperation extends BaseNode {
  kind: "materialize_projection_operation";
  ifExists?: boolean;
  name: Identifier;
  partition?: Identifier;
}

export interface FreezePartitionOperation extends BaseNode {
  kind: "freeze_partition_operation";
  partition: Expr;
  withName?: Identifier;
}

export interface UnfreezePartitionOperation extends BaseNode {
  kind: "unfreeze_partition_operation";
  partition: Expr;
  withName?: Identifier;
}

export interface RawAlterOperation extends BaseNode {
  kind: "raw_alter_operation";
  sql: string;
}

export type AlterTableOperation =
  | AttachPartitionOperation
  | DetachPartitionOperation
  | AddProjectionOperation
  | DropProjectionOperation
  | ClearProjectionOperation
  | MaterializeProjectionOperation
  | FreezePartitionOperation
  | UnfreezePartitionOperation
  | RawAlterOperation;

export interface AlterTableStatement extends BaseNode {
  kind: "alter_table_statement";
  name: ObjectName;
  operations: AlterTableOperation[];
}

export interface RawStatement extends BaseNode {
  kind: "raw_statement";
  sql: string;
}

export type Statement =
  | SelectStatement
  | CreateTableStatement
  | CreateViewStatement
  | OptimizeTableStatement
  | KillStatement
  | UseStatement
  | DescribeStatement
  | ExplainStatement
  | InsertStatement
  | AlterTableStatement
  | RawStatement;
