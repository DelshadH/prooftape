const ms = require("ms");

const result = ms("1.5h");
if (result !== 5_400_000) {
  throw new Error("1.5 hours must convert to milliseconds");
}
