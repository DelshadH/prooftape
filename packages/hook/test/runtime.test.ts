import { describe, expect, it } from "vitest";
import type { CallObservationV1 } from "@prooftape/schema";
import { createRuntime } from "../src/runtime.js";

function harness() {
  const calls: CallObservationV1[] = [];
  const runtime = createRuntime({
    processId: "raw-1",
    redactLiterals: ["pt-secret-canary"],
    emit: (call) => calls.push(call),
    callSiteFingerprint: () => "fixture.test:call",
  });
  return { calls, runtime };
}

describe("recording runtime", () => {
  it("preserves this, return identity, descriptors, and argument mutation", () => {
    const { calls, runtime } = harness();
    const receiver = { prefix: "ok" };
    const value = { stable: true };
    function mutate(this: typeof receiver, input: { count: number }) {
      input.count += 1;
      return this.prefix === "ok" ? value : null;
    }
    const descriptorBefore = Object.getOwnPropertyDescriptor(mutate, "length");
    const input = { count: 1 };

    const returned = runtime.invoke("fixture", "mutate", mutate, receiver, [input]);

    expect(returned).toBe(value);
    expect(input.count).toBe(2);
    expect(Object.getOwnPropertyDescriptor(mutate, "length")).toEqual(descriptorBefore);
    expect(calls[0]).toMatchObject({
      argsBefore: [{ count: 1 }],
      argsAfter: [{ count: 2 }],
      outcome: "return",
      value: { stable: true },
    });
  });

  it("rethrows the exact error object after recording its contract", () => {
    const { calls, runtime } = harness();
    const error = Object.assign(new TypeError("bad pt-secret-canary"), {
      code: "E_BAD",
      safeField: 7,
    });

    expect(() =>
      runtime.invoke("fixture", "fail", () => {
        throw error;
      }, undefined, []),
    ).toThrow(error);
    expect(calls[0]?.outcome).toBe("throw");
    expect(JSON.stringify(calls[0])).not.toContain("pt-secret-canary");
    expect(calls[0]?.error).toMatchObject({
      name: "TypeError",
      message: "bad [REDACTED]",
      code: "E_BAD",
      fields: { safeField: 7 },
    });
  });

  it("returns the original native promise while observing resolution", async () => {
    const { calls, runtime } = harness();
    const original = Promise.resolve({ result: 3 });

    const returned = runtime.invoke("fixture", "asyncValue", () => original, undefined, []);

    expect(returned).toBe(original);
    await returned;
    await Promise.resolve();
    expect(calls[0]).toMatchObject({
      outcome: "resolve",
      value: { result: 3 },
    });
  });

  it("returns the original rejected promise and records the same rejection", async () => {
    const { calls, runtime } = harness();
    const error = new RangeError("outside");
    const original = Promise.reject(error);

    const returned = runtime.invoke("fixture", "asyncError", () => original, undefined, []);

    expect(returned).toBe(original);
    await expect(returned).rejects.toBe(error);
    await Promise.resolve();
    expect(calls[0]).toMatchObject({
      outcome: "reject",
      error: { name: "RangeError", message: "outside" },
    });
  });

  it("marks unsupported captured values without changing the application result", () => {
    const { calls, runtime } = harness();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    const returned = runtime.invoke("fixture", "cycle", (value) => value, undefined, [cyclic]);

    expect(returned).toBe(cyclic);
    expect(calls[0]?.unsupported?.map((item) => item.reason)).toContain("cycle");
  });

  it("contains hostile proxy traps instead of changing the call", () => {
    const { calls, runtime } = harness();
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error("trap");
      },
    });

    const returned = runtime.invoke("fixture", "proxy", () => 9, undefined, [hostile]);

    expect(returned).toBe(9);
    expect(calls[0]?.unsupported?.map((item) => item.reason)).toContain("serialization-trap");
  });
});
