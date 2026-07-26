import { describe, expect, it } from "vitest";
import { transformApplicationSource } from "../src/transform.js";

const options = {
  dependency: "fixture",
  url: "file:///work/app.mjs",
} as const;

describe("transformApplicationSource", () => {
  it("instruments ESM named calls and object methods without replacing bindings", () => {
    const source = [
      'import { add as sum, toolbox } from "fixture";',
      "const sameFunction = sum;",
      "export const total = sum(1, 2);",
      'export const parsed = toolbox.parse("x");',
    ].join("\n");

    const result = transformApplicationSource(source, { ...options, format: "module" });

    expect(result.issues).toEqual([]);
    expect(result.source).toContain('invoke("fixture","add",sum,void 0,[1, 2],"file:///work/app.mjs:3:22","esm","none")');
    expect(result.source).toContain(
      'invoke("fixture","toolbox.parse",toolbox.parse,toolbox,["x"],"file:///work/app.mjs:4:23","esm","parent")',
    );
    expect(result.source).toContain("const sameFunction = sum;");
  });

  it("instruments CommonJS namespace methods and callable exports", () => {
    const source = [
      'const fixture = require("fixture");',
      'const { add: picked } = require("fixture");',
      "const one = fixture.add(1, 2);",
      "const two = fixture(3);",
      "const three = picked(4, 5);",
    ].join("\n");

    const result = transformApplicationSource(source, { ...options, format: "commonjs" });

    expect(result.issues).toEqual([]);
    expect(result.source).toContain(
      'invoke("fixture","add",fixture.add,fixture,[1, 2],"file:///work/app.mjs:3:13","commonjs","parent")',
    );
    expect(result.source).toContain(
      'invoke("fixture","default",fixture,void 0,[3],"file:///work/app.mjs:4:13","commonjs","none")',
    );
    expect(result.source).toContain(
      'invoke("fixture","add",picked,void 0,[4, 5],"file:///work/app.mjs:5:15","commonjs","none")',
    );
  });

  it("instruments nested dependency calls in evaluation order", () => {
    const source = [
      'import * as fixture from "fixture";',
      "export const value = fixture.outer(fixture.inner(1));",
    ].join("\n");

    const result = transformApplicationSource(source, { ...options, format: "module" });

    expect(result.issues).toEqual([]);
    expect(result.source).toContain(
      'invoke("fixture","outer",fixture.outer,fixture,[globalThis',
    );
    expect(result.source).toContain(
      'invoke("fixture","inner",fixture.inner,fixture,[1],"file:///work/app.mjs:2:36","esm","parent")',
    );
  });

  it("explicitly rejects surfaces it cannot instrument transparently", () => {
    const cases = [
      'const module = await import("fixture");',
      'export { add } from "fixture";',
      'import { Thing } from "fixture"; new Thing();',
      'import { add } from "fixture"; add?.(1);',
      'import * as fixture from "fixture"; fixture.deep.method(1);',
    ];

    for (const source of cases) {
      const result = transformApplicationSource(source, { ...options, format: "module" });
      expect(result.source).toBe(source);
      expect(result.issues[0]?.code).toMatch(/^PT_UNSUPPORTED_/);
    }
  });

  it("does not transform dependency-internal or unrelated modules", () => {
    const internal = transformApplicationSource(
      'import { add } from "fixture"; add(1, 2);',
      {
        dependency: "fixture",
        format: "module",
        url: "file:///work/node_modules/fixture/internal.js",
      },
    );
    const unrelated = transformApplicationSource('export const value = 1;', {
      ...options,
      format: "module",
    });

    expect(internal.transformed).toBe(false);
    expect(unrelated.transformed).toBe(false);
  });

  it("does not attribute lexically shadowed identifiers to the dependency", () => {
    const source = [
      'import { add } from "fixture";',
      "function local(add) { return add(2, 3); }",
      "const multiplied = local((left, right) => left * right);",
      "const summed = add(2, 3);",
    ].join("\n");

    const result = transformApplicationSource(source, { ...options, format: "module" });

    expect(result.issues).toEqual([]);
    expect(result.source).toContain("function local(add) { return add(2, 3); }");
    expect(result.source).toContain(
      'invoke("fixture","add",add,void 0,[2, 3],"file:///work/app.mjs:4:16","esm","none")',
    );

    const hoistedVar = [
      'import { add } from "fixture";',
      "function local() {",
      "  if (false) { var add = () => 0; }",
      "  return add(2, 3);",
      "}",
    ].join("\n");
    const hoistedResult = transformApplicationSource(
      hoistedVar,
      { ...options, format: "module" },
    );
    expect(hoistedResult.source).toBe(hoistedVar);
  });

  it("rejects reassigned dependency bindings instead of misattributing calls", () => {
    const source = [
      'let fixture = require("fixture");',
      "fixture = (value) => value * 3;",
      "fixture(2);",
    ].join("\n");

    const result = transformApplicationSource(source, { ...options, format: "commonjs" });

    expect(result.source).toBe(source);
    expect(result.issues).toContainEqual({
      code: "PT_UNSUPPORTED_REASSIGNMENT",
      message: "reassigned dependency bindings cannot be attributed transparently",
    });
  });
});
