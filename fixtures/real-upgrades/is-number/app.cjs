const isNumber = require("is-number");

const result = isNumber("5e3");
if (result !== true) {
  throw new Error("scientific notation must be recognized");
}
