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
    expect(result.source).toContain('invoke("fixture","add",sum,void 0,[1, 2],"file:///work/app.mjs:3:22","esm","none","fixture","export")');
    expect(result.source).toContain(
      'invoke("fixture","toolbox.parse",toolbox.parse,toolbox,["x"],"file:///work/app.mjs:4:23","esm","parent","fixture","export")',
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
      'invoke("fixture","add",fixture.add,fixture,[1, 2],"file:///work/app.mjs:3:13","commonjs","parent","fixture","export")',
    );
    expect(result.source).toContain(
      'invoke("fixture","default",fixture,void 0,[3],"file:///work/app.mjs:4:13","commonjs","none","fixture","module")',
    );
    expect(result.source).toContain(
      'invoke("fixture","add",picked,void 0,[4, 5],"file:///work/app.mjs:5:15","commonjs","none","fixture","export")',
    );
  });

  it("uses a collision-free runtime binding when applications shadow globals", () => {
    const source = [
      'import { add } from "fixture";',
      "const globalThis = {};",
      "const Symbol = { for() { throw new Error('application binding'); } };",
      "const __prooftapeRuntime = null;",
      "export const total = add(1, 2);",
    ].join("\n");

    const result = transformApplicationSource(source, { ...options, format: "module" });

    expect(result.issues).toEqual([]);
    expect(result.source).not.toContain('globalThis[Symbol.for("prooftape.runtime.v1")]');
    expect(result.source).toMatch(/const __prooftapeRuntime\d+ = /u);
    expect(result.source).toMatch(/__prooftapeRuntime\d+\.invoke\("fixture","add"/u);
  });

  it("rejects modules that shadow both supported Node global aliases", () => {
    const source = [
      'import { add } from "fixture";',
      "const globalThis = {};",
      "const global = {};",
      "add(1, 2);",
    ].join("\n");

    const result = transformApplicationSource(source, { ...options, format: "module" });

    expect(result.source).toBe(source);
    expect(result.issues).toContainEqual({
      code: "PT_UNSUPPORTED_GLOBAL_BINDING",
      message: "application bindings shadow both supported Node global aliases",
    });
  });

  it("does not attribute loop or switch lexical bindings to the dependency", () => {
    const loop = [
      'import { add } from "fixture";',
      "for (const add of [(value) => value * 3]) { add(2); }",
    ].join("\n");
    const switchScope = [
      'import { add } from "fixture";',
      "switch (1) { case 1: const add = (value) => value * 3; add(2); break; }",
    ].join("\n");

    expect(transformApplicationSource(loop, { ...options, format: "module" }).source)
      .toBe(loop);
    expect(transformApplicationSource(switchScope, { ...options, format: "module" }).source)
      .toBe(switchScope);
  });

  it("still attributes a dependency call in a switch discriminant", () => {
    const source = [
      'import { add } from "fixture";',
      "switch (add(1, 2)) { case 3: const add = () => 0; break; }",
    ].join("\n");

    const result = transformApplicationSource(source, { ...options, format: "module" });

    expect(result.issues).toEqual([]);
    expect(result.source).toContain('__prooftapeRuntime.invoke("fixture","add"');
  });

  it("does not attribute a named class expression self-binding to the dependency", () => {
    const source = [
      'import { add } from "fixture";',
      "const Local = class add { static run() { return add.value(2); } };",
      "Local.run();",
    ].join("\n");

    expect(transformApplicationSource(source, { ...options, format: "module" }).source)
      .toBe(source);
  });

  it("rejects function-scoped CommonJS bindings instead of silently partially capturing", () => {
    const source = [
      'const stable = require("fixture");',
      "function local() {",
      '  const inner = require("fixture");',
      "  inner.changed();",
      "}",
      "stable.stable();",
      "local();",
    ].join("\n");

    const result = transformApplicationSource(source, { ...options, format: "commonjs" });

    expect(result.source).toBe(source);
    expect(result.issues).toContainEqual({
      code: "PT_UNSUPPORTED_SCOPED_REQUIRE",
      message: "dependency require bindings must be declared at module scope",
    });
  });

  it("rejects every unsupported dependency require usage instead of partially capturing", () => {
    const cases = [
      [
        'const fixture = require("fixture");',
        "fixture(1);",
        'require("fixture").other(2);',
      ].join("\n"),
      'const { other = () => 0 } = require("fixture"); other();',
      'const { nested: { other } } = require("fixture"); other();',
      'const [other] = require("fixture"); other();',
      'const other = require("fixture")[name]; other();',
    ];

    for (const source of cases) {
      const result = transformApplicationSource(source, {
        ...options,
        format: "commonjs",
      });
      expect(result.source).toBe(source);
      expect(result.issues[0]?.code).toMatch(/^PT_UNSUPPORTED_/);
    }
  });

  it("instruments nested dependency calls in evaluation order", () => {
    const source = [
      'import * as fixture from "fixture";',
      "export const value = fixture.outer(fixture.inner(1));",
    ].join("\n");

    const result = transformApplicationSource(source, { ...options, format: "module" });

    expect(result.issues).toEqual([]);
    expect(result.source).toContain(
      'invoke("fixture","outer",fixture.outer,fixture,[__prooftapeRuntime',
    );
    expect(result.source).toContain(
      'invoke("fixture","inner",fixture.inner,fixture,[1],"file:///work/app.mjs:2:36","esm","parent","fixture","export")',
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
      'invoke("fixture","add",add,void 0,[2, 3],"file:///work/app.mjs:4:16","esm","none","fixture","export")',
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

    const destructured = [
      'let fixture = require("fixture");',
      "({ fixture } = { fixture: (value) => value * 3 });",
      "fixture(2);",
    ].join("\n");
    expect(
      transformApplicationSource(destructured, { ...options, format: "commonjs" }).issues,
    ).toContainEqual({
      code: "PT_UNSUPPORTED_REASSIGNMENT",
      message: "reassigned dependency bindings cannot be attributed transparently",
    });

    const memberDestructuring = [
      'const fixture = require("fixture");',
      "const local = (value) => value * 3;",
      "[fixture.add] = [local];",
      "fixture.add(2);",
    ].join("\n");
    expect(
      transformApplicationSource(memberDestructuring, { ...options, format: "commonjs" }).issues,
    ).toContainEqual({
      code: "PT_UNSUPPORTED_REASSIGNMENT",
      message: "reassigned dependency bindings cannot be attributed transparently",
    });

    const loopMemberDestructuring = [
      'const fixture = require("fixture");',
      "for ([fixture.add] of [[(value) => value * 3]]) { fixture.add(2); }",
    ].join("\n");
    expect(
      transformApplicationSource(
        loopMemberDestructuring,
        { ...options, format: "commonjs" },
      ).issues,
    ).toContainEqual({
      code: "PT_UNSUPPORTED_REASSIGNMENT",
      message: "reassigned dependency bindings cannot be attributed transparently",
    });

    for (const source of [
      [
        'var fixture = require("fixture");',
        "var fixture = (value) => value * 3;",
        "fixture(2);",
      ].join("\n"),
      [
        'var fixture = require("fixture");',
        "const local = (value) => value * 3;",
        "for (var fixture of [local]) { fixture(2); }",
      ].join("\n"),
      [
        'const fixture = require("fixture");',
        "delete fixture.add;",
        "fixture.add(2);",
      ].join("\n"),
      [
        'var fixture = require("fixture");',
        "const local = (value) => value * 3;",
        "if (true) { var fixture = local; }",
        "fixture(2);",
      ].join("\n"),
      [
        'const fixture = require("fixture");',
        "delete fixture?.add;",
        "fixture.add(2);",
      ].join("\n"),
      [
        'var fixture = require("fixture");',
        "if (true) { function fixture() { return 0; } }",
        "fixture(2);",
      ].join("\n"),
    ]) {
      expect(
        transformApplicationSource(source, { ...options, format: "commonjs" }).issues,
      ).toContainEqual({
        code: "PT_UNSUPPORTED_REASSIGNMENT",
        message: "reassigned dependency bindings cannot be attributed transparently",
      });
    }
  });
});
