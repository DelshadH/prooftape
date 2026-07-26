import ms from "ms";

if (ms("2 days") !== 172800000) {
  throw new Error("unexpected ms result");
}
