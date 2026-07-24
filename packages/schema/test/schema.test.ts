import { describe, expect, it } from "vitest";
import { EXIT } from "../src/index.js";

describe("public exit contract", () => {
  it("does not overlap conventional success", () => {
    expect(EXIT.OK).toBe(0);
    expect(new Set(Object.values(EXIT)).size).toBe(4);
  });
});
