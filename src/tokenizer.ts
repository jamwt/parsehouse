export type TokenType =
  | "word"
  | "number"
  | "string"
  | "quoted_identifier"
  | "operator"
  | "punctuation"
  | "eof";

export interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

const PUNCTUATION = new Set(["(", ")", "[", "]", "{", "}", ",", ".", ";", ":"]);
const SINGLE_OPERATORS = new Set(["+", "-", "*", "/", "%", "=", "<", ">"]);
const MULTI_OPERATORS = ["->", "==", "!=", "<=", ">=", "<>"];

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function isDigit(char: string): boolean {
  return /[0-9]/.test(char);
}

function isWordStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

function isWordPart(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

function readQuoted(input: string, start: number, quote: string): Token {
  let index = start + 1;
  let value = "";

  while (index < input.length) {
    const char = input[index];
    if (char === quote) {
      if (quote === "'" && input[index + 1] === quote) {
        value += quote;
        index += 2;
        continue;
      }
      return {
        type: quote === "'" ? "string" : "quoted_identifier",
        value,
        start,
        end: index + 1,
      };
    }
    if (char === "\\" && quote === "'" && index + 1 < input.length) {
      value += char;
      value += input[index + 1];
      index += 2;
      continue;
    }
    value += char;
    index += 1;
  }

  throw new SyntaxError(`Unterminated quoted value starting at ${start}`);
}

function skipComment(input: string, index: number): number {
  if (input.startsWith("--", index) || input.startsWith("//", index)) {
    let cursor = index + 2;
    while (cursor < input.length && input[cursor] !== "\n") {
      cursor += 1;
    }
    return cursor;
  }

  if (input.startsWith("/*", index)) {
    let cursor = index + 2;
    let depth = 1;
    while (cursor < input.length) {
      if (input.startsWith("/*", cursor)) {
        depth += 1;
        cursor += 2;
        continue;
      }
      if (input.startsWith("*/", cursor)) {
        depth -= 1;
        cursor += 2;
        if (depth === 0) {
          return cursor;
        }
        continue;
      }
      cursor += 1;
    }
    throw new SyntaxError(`Unterminated comment starting at ${index}`);
  }

  return index;
}

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];
    if (isWhitespace(char)) {
      index += 1;
      continue;
    }

    const commentEnd = skipComment(sql, index);
    if (commentEnd !== index) {
      index = commentEnd;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      const token = readQuoted(sql, index, char);
      tokens.push(token);
      index = token.end;
      continue;
    }

    if (isDigit(char)) {
      let cursor = index + 1;
      if (char === "0" && (sql[cursor] === "x" || sql[cursor] === "X")) {
        cursor += 1;
        while (cursor < sql.length && /[0-9A-Fa-f_]/.test(sql[cursor])) {
          cursor += 1;
        }
        tokens.push({ type: "number", value: sql.slice(index, cursor), start: index, end: cursor });
        index = cursor;
        continue;
      }
      while (cursor < sql.length && /[0-9_]/.test(sql[cursor])) {
        cursor += 1;
      }
      if (sql[cursor] === ".") {
        cursor += 1;
        while (cursor < sql.length && /[0-9_]/.test(sql[cursor])) {
          cursor += 1;
        }
      }
      tokens.push({ type: "number", value: sql.slice(index, cursor), start: index, end: cursor });
      index = cursor;
      continue;
    }

    if (isWordStart(char)) {
      let cursor = index + 1;
      while (cursor < sql.length && isWordPart(sql[cursor])) {
        cursor += 1;
      }
      tokens.push({ type: "word", value: sql.slice(index, cursor), start: index, end: cursor });
      index = cursor;
      continue;
    }

    const multiOperator = MULTI_OPERATORS.find((operator) => sql.startsWith(operator, index));
    if (multiOperator) {
      tokens.push({ type: "operator", value: multiOperator, start: index, end: index + multiOperator.length });
      index += multiOperator.length;
      continue;
    }

    if (PUNCTUATION.has(char)) {
      tokens.push({ type: "punctuation", value: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }

    if (SINGLE_OPERATORS.has(char)) {
      tokens.push({ type: "operator", value: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }

    throw new SyntaxError(`Unexpected character ${char} at ${index}`);
  }

  tokens.push({ type: "eof", value: "", start: sql.length, end: sql.length });
  return tokens;
}
