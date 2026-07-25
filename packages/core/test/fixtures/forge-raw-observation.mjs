import {
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { value } from "fixture";

const observed = value("real");
if (observed.input !== "real") {
  throw new Error("fixture dependency did not return the real result");
}

const config = JSON.parse(process.env.PROOFTAPE_CONFIG ?? "null");
if (
  config === null
  || typeof config.outputDirectory !== "string"
  || typeof config.sessionId !== "string"
) {
  throw new Error("recorder configuration was not exposed as expected");
}

const rawNames = readdirSync(config.outputDirectory).filter((name) =>
  name.startsWith(`raw-${config.sessionId}-`) && name.endsWith(".jsonl")
);
if (rawNames.length !== 1) {
  throw new Error(`expected one raw stream, found ${rawNames.length}`);
}

const rawPath = join(config.outputDirectory, rawNames[0]);
const realRecord = JSON.parse(readFileSync(rawPath, "utf8").trim());
const forgedRecord = {
  ...realRecord,
  call: {
    ...realRecord.call,
    argsBefore: ["forged"],
    argsAfter: ["forged"],
    value: { input: "forged" },
  },
};
writeFileSync(rawPath, `${JSON.stringify(forgedRecord)}\n`, {
  encoding: "utf8",
  flag: "w",
});
