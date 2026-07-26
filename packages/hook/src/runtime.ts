import type {
  JsonValue,
  RawCallObservationV1,
  SerializedError,
  UnsupportedObservation,
} from "@prooftape/schema";
import {
  serializeValue,
  type SerializeOptions,
  type SerializeResult,
} from "@prooftape/core";
import { pathToFileURL } from "node:url";

export interface RuntimeOptions extends SerializeOptions {
  readonly processId: string;
  readonly emit: (call: RawCallObservationV1) => void;
  readonly callSiteFingerprint?: () => string;
  readonly onInternalError?: (error: unknown) => void;
}

export interface ProofTapeRuntime {
  invoke<T>(
    dependency: string,
    exportPath: string,
    callable: (...args: never[]) => T,
    thisArgument: unknown,
    args: unknown[],
    staticCallSiteFingerprint?: string,
    moduleKind?: "esm" | "commonjs",
    receiverKind?: "none" | "parent",
    moduleSpecifier?: string,
    targetKind?: "module" | "export",
  ): T;
}

function fallbackSerialization(reason: "serialization-trap"): SerializeResult {
  return {
    value: { $prooftape: "unsupported", reason },
    unsupported: [{ path: "/", reason, type: "unknown" }],
  };
}

function safeSerialize(value: unknown, options: SerializeOptions): SerializeResult {
  try {
    return serializeValue(value, options);
  } catch {
    return fallbackSerialization("serialization-trap");
  }
}

function redactedString(value: string, options: SerializeOptions): string {
  const serialized = safeSerialize(value, options).value;
  return typeof serialized === "string" ? serialized : "[UNSUPPORTED]";
}

function dataProperty(
  value: object,
  key: string,
): { readonly value?: unknown; readonly accessor: boolean } {
  try {
    let current: object | null = value;
    while (current !== null) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) {
        return descriptor.get || descriptor.set
          ? { accessor: true }
          : { accessor: false, value: descriptor.value };
      }
      current = Object.getPrototypeOf(current);
    }
  } catch {
    return { accessor: true };
  }
  return { accessor: false };
}

function serializeError(
  thrown: unknown,
  options: SerializeOptions,
): { error: SerializedError; unsupported: readonly UnsupportedObservation[] } {
  if (!(thrown instanceof Error)) {
    const serialized = safeSerialize(thrown, options);
    return {
      error: {
        name: "NonError",
        message: "non-Error value thrown",
        fields: { value: serialized.value },
      },
      unsupported: serialized.unsupported,
    };
  }

  const rawFields: Record<string, unknown> = {};
  const unsupported: UnsupportedObservation[] = [];
  let keys: string[];
  try {
    keys = Object.keys(thrown).sort();
  } catch {
    return {
      error: { name: "Error", message: "[UNSUPPORTED]" },
      unsupported: [{ path: "/error", reason: "serialization-trap", type: "error" }],
    };
  }
  for (const key of keys) {
    if (key === "stack" || key === "message" || key === "name") continue;
    const descriptor = Object.getOwnPropertyDescriptor(thrown, key);
    if (!descriptor || descriptor.get || descriptor.set) {
      rawFields[key] = { $prooftape: "unsupported", reason: "accessor-property" };
      const persistedKey = redactedString(key, options)
        .replaceAll("~", "~0")
        .replaceAll("/", "~1");
      unsupported.push({
        path: `/error/${persistedKey}`,
        reason: "accessor-property",
        type: "error",
      });
      continue;
    }
    rawFields[key] = descriptor.value;
  }
  const serializedFields = safeSerialize(rawFields, options);
  unsupported.push(...serializedFields.unsupported.map((item) => ({
    ...item,
    path: `/error${item.path === "/" ? "" : item.path}`,
  })));
  const fields = (
    serializedFields.value !== null
    && typeof serializedFields.value === "object"
    && !Array.isArray(serializedFields.value)
  ) ? serializedFields.value as Record<string, JsonValue> : {};
  const code = fields.code;
  delete fields.code;
  const name = dataProperty(thrown, "name");
  const message = dataProperty(thrown, "message");
  if (name.accessor) {
    unsupported.push({ path: "/error/name", reason: "accessor-property", type: "error" });
  }
  if (message.accessor) {
    unsupported.push({ path: "/error/message", reason: "accessor-property", type: "error" });
  }

  return {
    error: {
      name: name.accessor
        ? "[UNSUPPORTED]"
        : redactedString(typeof name.value === "string" ? name.value : "Error", options),
      message: message.accessor
        ? "[UNSUPPORTED]"
        : redactedString(typeof message.value === "string" ? message.value : "", options),
      ...(code !== undefined ? { code } : {}),
      ...(Object.keys(fields).length > 0 ? { fields } : {}),
    },
    unsupported,
  };
}

function defaultCallSiteFingerprint(): string {
  const stack = new Error().stack?.split(/\r?\n/u).slice(1) ?? [];
  const frame = stack.find((line) =>
    !line.includes("/packages/hook/")
    && !line.includes("\\packages\\hook\\")
    && !line.includes("node:internal"),
  );
  if (!frame) return "unknown";
  const normalizedCwd = process.cwd().replaceAll("\\", "/");
  const cwdUrl = pathToFileURL(process.cwd()).href.replace(/\/$/u, "");
  return frame
    .trim()
    .replaceAll("\\", "/")
    .replace(/:\d+:\d+\)?$/u, ")")
    .replace(cwdUrl, "<cwd>")
    .replace(normalizedCwd, "<cwd>");
}

export function createRuntime(options: RuntimeOptions): ProofTapeRuntime {
  let sequence = 0;
  const serializationOptions: SerializeOptions = {
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.maxCollectionEntries === undefined
      ? {}
      : { maxCollectionEntries: options.maxCollectionEntries }),
    ...(options.maxStringBytes === undefined ? {} : { maxStringBytes: options.maxStringBytes }),
    ...(options.redactLiterals === undefined ? {} : { redactLiterals: options.redactLiterals }),
  };

  const emit = (call: RawCallObservationV1): void => {
    try {
      options.emit(call);
    } catch (error) {
      try {
        options.onInternalError?.(error);
      } catch {
        // Observation failures must never replace application behavior.
      }
    }
  };

  return {
    invoke<T>(
      dependency: string,
      exportPath: string,
      callable: (...args: never[]) => T,
      thisArgument: unknown,
      args: unknown[],
      staticCallSiteFingerprint?: string,
      moduleKind?: "esm" | "commonjs",
      receiverKind?: "none" | "parent",
      moduleSpecifier?: string,
      targetKind?: "module" | "export",
    ): T {
      sequence += 1;
      const callSequence = sequence;
      const callId = `${options.processId}:${callSequence}`;
      let callSiteFingerprint = "unknown";
      try {
        callSiteFingerprint = staticCallSiteFingerprint ?? (
          options.callSiteFingerprint ?? defaultCallSiteFingerprint
        )();
      } catch {
        // A hostile stack hook cannot be allowed to replace the application call.
      }
      let started = 0n;
      try {
        started = process.hrtime.bigint();
      } catch {
        // Duration is diagnostic raw evidence and is discarded from the capsule.
      }
      const argsBefore = safeSerialize(args, serializationOptions);

      const finish = (
        outcome: RawCallObservationV1["outcome"],
        result: { readonly value?: unknown; readonly thrown?: unknown },
      ): void => {
        const argsAfter = safeSerialize(args, serializationOptions);
        const unsupported: UnsupportedObservation[] = [
          ...argsBefore.unsupported,
          ...argsAfter.unsupported,
        ];
        const base = {
          schemaVersion: "1" as const,
          callId,
          sequence: callSequence,
          processId: options.processId,
          dependency: redactedString(dependency, serializationOptions),
          exportPath: redactedString(exportPath, serializationOptions),
          callSiteFingerprint: redactedString(callSiteFingerprint, serializationOptions),
          moduleKind: moduleKind ?? "esm",
          receiverKind: receiverKind ?? "none",
          moduleSpecifier: redactedString(
            moduleSpecifier ?? dependency,
            serializationOptions,
          ),
          targetKind: targetKind ?? "export",
          argsBefore: argsBefore.value,
          argsAfter: argsAfter.value,
          outcome,
          durationNanoseconds: (() => {
            try {
              return (process.hrtime.bigint() - started).toString(10);
            } catch {
              return "0";
            }
          })(),
        };

        if (outcome === "throw" || outcome === "reject") {
          const serializedError = serializeError(result.thrown, serializationOptions);
          unsupported.push(...serializedError.unsupported);
          emit({
            ...base,
            error: serializedError.error,
            ...(unsupported.length > 0 ? { unsupported } : {}),
          });
          return;
        }

        const serializedValue = safeSerialize(result.value, serializationOptions);
        unsupported.push(...serializedValue.unsupported);
        emit({
          ...base,
          value: serializedValue.value,
          ...(unsupported.length > 0 ? { unsupported } : {}),
        });
      };

      let result: T;
      try {
        result = Reflect.apply(callable, thisArgument, args) as T;
      } catch (error) {
        try {
          finish("throw", { thrown: error });
        } catch {
          // Capture finalization is failure-contained.
        }
        throw error;
      }

      try {
        finish("return", { value: result });
      } catch {
        // Capture finalization is failure-contained.
      }
      return result;
    },
  };
}
