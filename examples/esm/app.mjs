import camelCase from "camelcase";

const observed = camelCase("-");
if (typeof observed !== "string") {
  throw new Error("camelcase must return a string");
}
