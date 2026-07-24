import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const directory = resolve(process.env.PROOFTAPE_VERIFY_DIRECTORY ?? "");
const value = (await readFile(resolve(directory, "exit-code.txt"), "utf8")).trim();
if (!/^(?:0|2|3|4)$/u.test(value)) throw new Error("verifier exit code is missing or invalid");
process.exitCode = Number(value);
