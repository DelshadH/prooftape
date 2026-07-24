import { describe, expect, it } from "vitest";
import type { JsonValue } from "@prooftape/schema";
import { canonicalJson, serializeValue, sha256 } from "../src/index.js";

function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
}

function jsonValue(next: () => number, depth = 0): JsonValue {
  const choice = next() % (depth >= 3 ? 4 : 6);
  if (choice === 0) return null;
  if (choice === 1) return (next() & 1) === 1;
  if (choice === 2) return (next() % 100_000) - 50_000;
  if (choice === 3) return `value-${next().toString(16)}`;
  if (choice === 4) {
    return Array.from({ length: next() % 5 }, () => jsonValue(next, depth + 1));
  }
  const entries = Array.from({ length: next() % 5 }, (_, index) => [
    `key-${index}-${next().toString(16)}`,
    jsonValue(next, depth + 1),
  ] as const);
  return Object.fromEntries(entries);
}

function reverseObjectOrder(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(reverseObjectOrder);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).reverse().map(([key, child]) => [key, reverseObjectOrder(child)]),
    );
  }
  return value;
}

describe("deterministic properties", () => {
  it("canonical JSON and hashes are invariant to object insertion order", () => {
    for (let seed = 1; seed <= 1_000; seed += 1) {
      const value = jsonValue(generator(seed));
      const reordered = reverseObjectOrder(value);
      expect(canonicalJson(reordered)).toBe(canonicalJson(value));
      expect(sha256(canonicalJson(reordered))).toBe(sha256(canonicalJson(value)));
    }
  });

  it("serialization is deterministic for bounded generated values", () => {
    for (let seed = 1; seed <= 1_000; seed += 1) {
      const value = jsonValue(generator(seed));
      expect(serializeValue(value)).toEqual(serializeValue(value));
    }
  });
});
