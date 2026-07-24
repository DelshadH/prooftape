#!/usr/bin/env node
import { EXIT } from "@prooftape/schema";

const HELP = `ProofTape (pre-release)

Target commands:
  prooftape record --dependency <name> --command <command> --out <file>
  prooftape diff --baseline <file> --candidate <file> --repro-dir <dir>
  prooftape compare --base-ref <sha> --candidate-ref <sha> --dependency <name> --command <command>

Exit codes: 0 no blocking difference; 2 changed behavior; 3 harness failure; 4 invalid/unsupported input.
`;

const command = process.argv[2];
if (!command || command === "--help" || command === "-h") {
  process.stdout.write(HELP);
  process.exit(EXIT.OK);
}

process.stderr.write(`Command ${JSON.stringify(command)} is not available in this pre-release build.\n`);
process.exit(EXIT.INVALID_INPUT);
