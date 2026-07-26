import type { JsonValue } from "@prooftape/schema";

export type UnsupportedValueReason =
  | "accessor-property"
  | "cycle"
  | "invalid-date"
  | "max-collection-entries"
  | "max-depth"
  | "max-string-bytes"
  | "serialization-trap"
  | "symbol-key"
  | "unsupported-prototype"
  | "unsupported-type";

export interface UnsupportedValue {
  readonly path: string;
  readonly reason: UnsupportedValueReason;
  readonly type: string;
}

export interface SerializeOptions {
  readonly maxDepth?: number;
  readonly maxCollectionEntries?: number;
  readonly maxStringBytes?: number;
  readonly redactLiterals?: readonly string[];
}

export interface SerializeResult {
  readonly value: JsonValue;
  readonly unsupported: readonly UnsupportedValue[];
}

const DEFAULTS = Object.freeze({
  maxDepth: 12,
  maxCollectionEntries: 100,
  maxStringBytes: 16 * 1024,
});

const SENSITIVE_KEY = /(?:authorization|cookie|credential|pass(?:word)?|secret|token|api[-_]?key)/i;
const REDACTED = "[REDACTED]";

class RedactedKeyCollisionError extends Error {}

function typeName(value: unknown, literals: readonly string[]): string {
  try {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (value instanceof Date) return "date";
    if (value instanceof Error) return "error";
    const name = typeof value === "object"
      ? Object.getPrototypeOf(value)?.constructor?.name ?? "object"
      : typeof value;
    return replaceLiterals(name, literals);
  } catch {
    return "unknown";
  }
}

function pointer(parent: string, key: string | number): string {
  const escaped = String(key).replaceAll("~", "~0").replaceAll("/", "~1");
  return parent === "" ? `/${escaped}` : `${parent}/${escaped}`;
}

function unsupportedValue(
  unsupported: UnsupportedValue[],
  path: string,
  reason: UnsupportedValueReason,
  value: unknown,
  literals: readonly string[],
): JsonValue {
  unsupported.push({
    path: replaceLiterals(path || "/", literals),
    reason,
    type: typeName(value, literals),
  });
  return { $prooftape: "unsupported", reason };
}

export function redactLiteralString(value: string, literals: readonly string[]): string {
  let result = value;
  for (const literal of literals) {
    if (literal.length > 0) result = result.split(literal).join(REDACTED);
  }
  return result;
}

const replaceLiterals = redactLiteralString;

function dataProperty(
  value: object,
  key: string,
): { readonly value?: unknown; readonly accessor: boolean } {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) {
      return descriptor.get || descriptor.set
        ? { accessor: true }
        : { accessor: false, value: descriptor.value };
    }
    current = Object.getPrototypeOf(current);
  }
  return { accessor: false };
}

export function serializeValue(value: unknown, options: SerializeOptions = {}): SerializeResult {
  const maxDepth = options.maxDepth ?? DEFAULTS.maxDepth;
  const maxCollectionEntries = options.maxCollectionEntries ?? DEFAULTS.maxCollectionEntries;
  const maxStringBytes = options.maxStringBytes ?? DEFAULTS.maxStringBytes;
  const redactLiterals = [...(options.redactLiterals ?? [])].sort(
    (left, right) => right.length - left.length || left.localeCompare(right),
  );
  const unsupported: UnsupportedValue[] = [];
  const ancestors = new Set<object>();

  const visit = (current: unknown, path: string, depth: number): JsonValue => {
    if (depth > maxDepth) {
      return unsupportedValue(unsupported, path, "max-depth", current, redactLiterals);
    }

    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "string") {
      const redacted = replaceLiterals(current, redactLiterals);
      return Buffer.byteLength(redacted, "utf8") <= maxStringBytes
        ? redacted
        : unsupportedValue(unsupported, path, "max-string-bytes", current, redactLiterals);
    }
    if (typeof current === "number") {
      if (Number.isNaN(current)) return { $prooftape: "nan" };
      if (current === Number.POSITIVE_INFINITY) return { $prooftape: "infinity" };
      if (current === Number.NEGATIVE_INFINITY) return { $prooftape: "-infinity" };
      if (Object.is(current, -0)) return { $prooftape: "-0" };
      return current;
    }
    if (typeof current === "undefined") return { $prooftape: "undefined" };
    if (typeof current === "bigint") {
      return { $prooftape: "bigint", value: current.toString(10) };
    }
    if (typeof current === "function" || typeof current === "symbol") {
      return unsupportedValue(unsupported, path, "unsupported-type", current, redactLiterals);
    }

    try {
      if (current instanceof Date) {
        return Number.isNaN(current.getTime())
          ? unsupportedValue(unsupported, path, "invalid-date", current, redactLiterals)
          : { $prooftape: "date", value: current.toISOString() };
      }

      if (ancestors.has(current)) {
        return unsupportedValue(unsupported, path, "cycle", current, redactLiterals);
      }

      if (current instanceof Error) {
        const name = dataProperty(current, "name");
        const message = dataProperty(current, "message");
        const errorValue: Record<string, JsonValue> = {
          $prooftape: "error",
          message: message.accessor
            ? unsupportedValue(
              unsupported,
              pointer(path, "message"),
              "accessor-property",
              current,
              redactLiterals,
            )
            : replaceLiterals(typeof message.value === "string" ? message.value : "", redactLiterals),
          name: name.accessor
            ? unsupportedValue(
              unsupported,
              pointer(path, "name"),
              "accessor-property",
              current,
              redactLiterals,
            )
            : replaceLiterals(typeof name.value === "string" ? name.value : "Error", redactLiterals),
        };
        const code = Object.getOwnPropertyDescriptor(current, "code");
        if (code?.get || code?.set) {
          errorValue.code = unsupportedValue(
            unsupported,
            pointer(path, "code"),
            "accessor-property",
            current,
            redactLiterals,
          );
        } else if (code && "value" in code) {
          errorValue.code = visit(code.value, pointer(path, "code"), depth + 1);
        }
        return Object.fromEntries(
          Object.entries(errorValue).sort(([left], [right]) => left.localeCompare(right)),
        );
      }

      const prototype = Object.getPrototypeOf(current);
      if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) {
        return unsupportedValue(
          unsupported,
          path,
          "unsupported-prototype",
          current,
          redactLiterals,
        );
      }

      const symbols = Object.getOwnPropertySymbols(current).filter(
        (symbol) => Object.getOwnPropertyDescriptor(current, symbol)?.enumerable,
      );
      if (symbols.length > 0) {
        unsupportedValue(unsupported, path, "symbol-key", current, redactLiterals);
      }

      const keys = Object.keys(current);
      if (keys.length > maxCollectionEntries) {
        return unsupportedValue(
          unsupported,
          path,
          "max-collection-entries",
          current,
          redactLiterals,
        );
      }

      ancestors.add(current);
      if (Array.isArray(current)) {
        const result = current.map((child, index) => visit(child, pointer(path, index), depth + 1));
        ancestors.delete(current);
        return result;
      }

      const entries: Array<[string, JsonValue]> = [];
      const redactedKeys = new Set<string>();
      for (const key of keys) {
        const persistedKey = replaceLiterals(key, redactLiterals);
        if (redactedKeys.has(persistedKey)) {
          throw new RedactedKeyCollisionError("redacted object keys collide");
        }
        redactedKeys.add(persistedKey);
        const childPath = pointer(path, persistedKey);
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || descriptor.get || descriptor.set) {
          entries.push([
            persistedKey,
            unsupportedValue(
              unsupported,
              childPath,
              "accessor-property",
              current,
              redactLiterals,
            ),
          ]);
        } else if (SENSITIVE_KEY.test(key) || SENSITIVE_KEY.test(persistedKey)) {
          entries.push([persistedKey, REDACTED]);
        } else {
          entries.push([persistedKey, visit(descriptor.value, childPath, depth + 1)]);
        }
      }
      ancestors.delete(current);
      entries.sort(([left], [right]) => left.localeCompare(right));
      return Object.fromEntries(entries);
    } catch (error) {
      ancestors.delete(current);
      if (error instanceof RedactedKeyCollisionError) throw error;
      return unsupportedValue(
        unsupported,
        path,
        "serialization-trap",
        current,
        redactLiterals,
      );
    }
  };

  return { value: visit(value, "", 0), unsupported };
}
