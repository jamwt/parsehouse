export interface Dialect {
  readonly name: string;
  readonly caseInsensitiveKeywords: boolean;
  readonly supportsFinal: boolean;
  normalizeKeyword(value: string): string;
}

export class GenericDialect implements Dialect {
  readonly name: string = "generic";
  readonly caseInsensitiveKeywords: boolean = true;
  readonly supportsFinal: boolean = false;

  normalizeKeyword(value: string): string {
    return value.toUpperCase();
  }
}

export class ClickHouseDialect extends GenericDialect {
  override readonly name: string = "clickhouse";
  override readonly supportsFinal: boolean = true;
}

export interface ParseOptions {
  dialect?: Dialect;
}

export function getDialect(options?: ParseOptions): Dialect {
  return options?.dialect ?? new ClickHouseDialect();
}
