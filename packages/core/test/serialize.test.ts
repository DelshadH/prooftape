import { describe, expect, it } from "vitest";
import { serializeValue } from "../src/index.js";

describe("serializeValue", () => {
  it("canonicalizes supported special values and object key order", () => {
    const value = {
      z: undefined,
      a: [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, 12n],
      date: new Date("2026-01-02T03:04:05.000Z"),
    };

    expect(serializeValue(value)).toEqual({
      value: {
        a: [
          { $prooftape: "nan" },
          { $prooftape: "infinity" },
          { $prooftape: "-infinity" },
          { $prooftape: "-0" },
          { $prooftape: "bigint", value: "12" },
        ],
        date: { $prooftape: "date", value: "2026-01-02T03:04:05.000Z" },
        z: { $prooftape: "undefined" },
      },
      unsupported: [],
    });
  });

  it("redacts configured literals and sensitive object fields before persistence", () => {
    const canary = "pt-secret-canary";
    const result = serializeValue(
      {
        authorization: canary,
        nested: `before-${canary}-after`,
        ordinary: "visible",
      },
      { redactLiterals: [canary] },
    );

    expect(JSON.stringify(result)).not.toContain(canary);
    expect(result.value).toEqual({
      authorization: "[REDACTED]",
      nested: "before-[REDACTED]-after",
      ordinary: "visible",
    });
  });

  it("marks cycles and accessors unsupported without invoking getters", () => {
    let getterCalls = 0;
    const value: Record<string, unknown> = {};
    value.self = value;
    Object.defineProperty(value, "secret", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "must-not-run";
      },
    });

    const result = serializeValue(value);

    expect(getterCalls).toBe(0);
    expect(result.unsupported.map((item) => item.reason)).toEqual([
      "cycle",
      "accessor-property",
    ]);
  });

  it("bounds depth, collection size, and string bytes", () => {
    const result = serializeValue(
      { deep: { child: true }, list: [1, 2, 3, 4], text: "abcdef" },
      { maxDepth: 1, maxCollectionEntries: 3, maxStringBytes: 4 },
    );

    expect(result.unsupported.map((item) => item.reason)).toEqual([
      "max-depth",
      "max-collection-entries",
      "max-string-bytes",
    ]);
  });

  it("turns hostile proxy traps into explicit unsupported evidence", () => {
    const hostile = new Proxy({}, {
      getPrototypeOf() {
        throw new Error("candidate trap ran");
      },
    });

    expect(serializeValue(hostile)).toEqual({
      value: { $prooftape: "unsupported", reason: "serialization-trap" },
      unsupported: [{
        path: "/",
        reason: "serialization-trap",
        type: "unknown",
      }],
    });
  });
});
