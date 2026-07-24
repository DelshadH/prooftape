import camelCase from "camelcase";

const result = camelCase("-");
if (typeof result !== "string") {
  throw new Error("camelcase must return a string");
}
