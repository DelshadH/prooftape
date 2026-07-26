import { describe, expect, it } from "vitest";
import { parseHookOptions, recorderFailureExitCode } from "../src/register.js";

function config(dependency: string): string {
  return JSON.stringify({
    schemaVersion: "1",
    dependency,
    outputDirectory: process.cwd(),
    sessionId: "session-1234",
    limits: {
      maxEvents: 10,
      maxEventBytes: 4096,
      maxDepth: 12,
      maxCollectionEntries: 100,
      maxStringBytes: 1024,
    },
    redactLiterals: [],
  });
}

describe("parseHookOptions", () => {
  it("accepts unscoped and scoped npm package subpaths", () => {
    expect(parseHookOptions(config("fixture/subpath")).dependency).toBe("fixture/subpath");
    expect(parseHookOptions(config("@scope/pkg/subpath")).dependency).toBe(
      "@scope/pkg/subpath",
    );
  });

  it("promotes explicit success to a recorder failure exit", () => {
    expect(recorderFailureExitCode(true, 0)).toBe(86);
    expect(recorderFailureExitCode(true, undefined)).toBe(86);
    expect(recorderFailureExitCode(true, 9)).toBe(9);
    expect(recorderFailureExitCode(false, 0)).toBe(0);
  });
});
