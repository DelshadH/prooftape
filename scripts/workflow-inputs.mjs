import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const toolRoot = resolve(import.meta.dirname, "..");
const { parseCommand } = await import(
  pathToFileURL(resolve(toolRoot, "packages/cli/dist/command.js")).href
);

function required(name, maximum) {
  const value = process.env[name];
  if (!value || value.length > maximum || value.includes("\0")) {
    throw new Error(`${name} is missing or outside supported bounds`);
  }
  return value;
}

for (const name of ["PROOFTAPE_BASE_REF", "PROOFTAPE_CANDIDATE_REF"]) {
  if (!/^[a-f0-9]{40}$/u.test(required(name, 40))) {
    throw new Error(`${name} must be a full lowercase commit SHA`);
  }
}
const dependency = required("PROOFTAPE_DEPENDENCY", 256);
if (!/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u.test(dependency)) {
  throw new Error("PROOFTAPE_DEPENDENCY must be an exact npm package name");
}
parseCommand(required("PROOFTAPE_COMMAND", 16_384));
process.stdout.write("Workflow inputs are bounded direct-execution values.\n");
