import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repository = resolve(import.meta.dirname, "..");

describe("release documentation", () => {
  it("records the authorized alpha publication and registry tags", async () => {
    const notes = await readFile(
      resolve(repository, "docs/release-notes-0.1.0-alpha.1.md"),
      "utf8",
    );
    const changelog = await readFile(resolve(repository, "CHANGELOG.md"), "utf8");
    const currentNotes = await readFile(
      resolve(repository, "docs/release-notes-0.1.0-alpha.2.md"),
      "utf8",
    );

    expect(notes).toContain("`0.1.0-alpha.1` is published");
    expect(notes).toContain("both `alpha` and `latest`");
    expect(notes).not.toContain("prospective release candidate");
    expect(notes).not.toContain("REGISTRY AUTHENTICATION UNAVAILABLE");
    expect(changelog).toContain("## 0.1.0-alpha.1 - 2026-07-31");
    expect(changelog).toContain("## 0.1.0-alpha.2 - 2026-08-20");
    expect(currentNotes).toContain("Observation authenticity is not established");
    expect(currentNotes).toContain("`alpha` dist-tag");
    expect(changelog).not.toContain("unpublished release candidate");
    expect(changelog).not.toContain("uploaded before approval");
  });

  it("documents only the reviewed real-alpha first-publication bootstrap", async () => {
    const releasing = await readFile(resolve(repository, "RELEASING.md"), "utf8");
    const github = await readFile(resolve(repository, "docs/github.md"), "utf8");

    for (const document of [releasing, github]) {
      expect(document).toContain(".github/workflows/npm-bootstrap.yml");
      expect(document).toContain("0.1.0-alpha.1");
      expect(document).not.toContain("0.0.0-bootstrap.0");
    }
    expect(releasing).toContain("Do not publish empty, placeholder, or unrelated packages.");
    expect(releasing).toContain("ONE_TIME_TOKEN_AUTHORIZED");
    expect(releasing).toContain("Require two-factor authentication and disallow tokens");
    expect(releasing).toContain("Do not run `release.yml` for `0.1.0-alpha.1`");
    expect(releasing).toContain("Node `24.18.0` and npm `11.16.0`");
    expect(releasing).toContain(
      "The workflow creates the GitHub prerelease only after",
    );
    expect(releasing).not.toContain(
      "create the GitHub release from the verified evidence",
    );
    expect(github).toMatch(/GitHub prerelease is created only\s+after/u);
    expect(releasing).not.toMatch(/^\s*npm publish\b/mu);
  });
});
