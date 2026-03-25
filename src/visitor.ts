import type { Expr, Statement } from "./ast";

export interface Visitor {
  enter?(node: Statement | Expr): void;
  leave?(node: Statement | Expr): void;
}

export function visit(node: Statement | Expr, visitor: Visitor): void {
  visitor.enter?.(node);

  switch (node.kind) {
    case "select_statement":
      node.projection.forEach((item) => {
        if (item.kind === "expression_select_item") {
          visit(item.expression, visitor);
        }
      });
      node.from?.forEach((source) => {
        if (source.kind === "subquery_source") {
          visit(source.query, visitor);
        } else if (source.kind === "function_table_source") {
          visit(source.function, visitor);
        }
      });
      node.prewhere && visit(node.prewhere, visitor);
      node.where && visit(node.where, visitor);
      node.groupBy?.forEach((expression) => visit(expression, visitor));
      node.having && visit(node.having, visitor);
      node.orderBy?.forEach((item) => visit(item.expression, visitor));
      node.limit?.limit && visit(node.limit.limit, visitor);
      node.limit?.offset && visit(node.limit.offset, visitor);
      node.limit?.by?.by.forEach((expression) => visit(expression, visitor));
      node.settings?.forEach((setting) => setting.value && visit(setting.value, visitor));
      break;
    case "create_table_statement":
      node.engine && visit(node.engine, visitor);
      node.primaryKey && visit(node.primaryKey, visitor);
      node.orderBy && visit(node.orderBy, visitor);
      node.asSelect && visit(node.asSelect, visitor);
      break;
    case "create_view_statement":
      visit(node.query, visitor);
      break;
    case "optimize_table_statement":
      node.onCluster && visit(node.onCluster, visitor);
      node.partition && visit(node.partition, visitor);
      node.deduplicateBy && visit(node.deduplicateBy, visitor);
      break;
    case "insert_statement":
      if (node.target.kind === "function_call_expr") {
        visit(node.target, visitor);
      }
      node.values?.flat().forEach((expression) => visit(expression, visitor));
      node.query && visit(node.query, visitor);
      break;
    case "explain_statement":
      visit(node.target, visitor);
      break;
    case "function_call_expr":
      node.parameters?.forEach((expression) => visit(expression, visitor));
      node.args.forEach((expression) => visit(expression, visitor));
      break;
    case "binary_expr":
      visit(node.left, visitor);
      visit(node.right, visitor);
      break;
    case "unary_expr":
      visit(node.operand, visitor);
      break;
    case "parenthesized_expr":
      visit(node.expression, visitor);
      break;
    case "array_expr":
      node.items.forEach((expression) => visit(expression, visitor));
      break;
    case "dictionary_expr":
      node.entries.forEach((entry) => {
        visit(entry.key, visitor);
        visit(entry.value, visitor);
      });
      break;
    case "subscript_expr":
      visit(node.target, visitor);
      visit(node.index, visitor);
      break;
  }

  visitor.leave?.(node);
}
