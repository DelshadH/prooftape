import { isIdentifierStart } from "acorn";

if (isIdentifierStart("A".codePointAt(0), true) !== true) {
  throw new Error("Acorn should recognize an ASCII identifier start");
}
