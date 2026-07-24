import { describe, expect, it } from "vitest";
import { CommandSyntaxError, parseCommand } from "../src/command.js";

describe("parseCommand", () => {
  it("turns a quoted command into a direct argument vector", () => {
    expect(parseCommand('npm test -- --run "one two" \'three four\'')).toEqual([
      "npm",
      "test",
      "--",
      "--run",
      "one two",
      "three four",
    ]);
  });

  it("supports escaped spaces without invoking a shell", () => {
    expect(parseCommand("node path\\ with\\ spaces/test.mjs")).toEqual([
      "node",
      "path with spaces/test.mjs",
    ]);
  });

  it.each([
    "npm test && publish",
    "npm test | upload",
    "npm test > output",
    "npm test; publish",
    "node $(steal)",
    "node `steal`",
    "node test\npublish",
    'node "unterminated',
  ])("rejects shell syntax: %s", (command) => {
    expect(() => parseCommand(command)).toThrow(CommandSyntaxError);
  });

  it("bounds command length and argument count", () => {
    expect(() => parseCommand(`node ${"x".repeat(16_385)}`)).toThrow(/length/);
    expect(() => parseCommand(Array.from({ length: 257 }, () => "x").join(" ")))
      .toThrow(/argument/);
  });
});
