const isNumber = require("is-number");

if (isNumber("0xFF") !== true) {
  throw new Error("unexpected is-number result");
}
