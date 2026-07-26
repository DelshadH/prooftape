import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repository = resolve(import.meta.dirname, "..");

describe("prospective release documentation", () => {
  it("does not describe an unauthorized tag or npm publication as completed", async () => {
    const notes = await readFile(
      resolve(repository, "docs/release-notes-0.1.0-alpha.1.md"),
      "utf8",
    );
    const changelog = await readFile(resolve(repository, "CHANGELOG.md"), "utf8");

    expect(notes).toContain("prospective release candidate");
    expect(notes).toContain("REGISTRY AUTHENTICATION UNAVAILABLE");
    expect(notes).not.toContain("Use the `alpha` npm distribution tag");
    expect(changelog).not.toMatch(/^## 0\.1\.0-alpha\.1 - \d{4}-\d{2}-\d{2}$/mu);
    expect(changelog).not.toContain("uploaded before approval");
  });
});
