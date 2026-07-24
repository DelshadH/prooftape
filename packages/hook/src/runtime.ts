import type {
  CallObservationV1,
  JsonValue,
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
  readonly emit: (call: CallObservationV1) => void;
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

  const fields: Record<string, JsonValue> = {};
  const unsupported: UnsupportedObservation[] = [];
  let code: JsonValue | undefined;
  for (const key of Object.keys(thrown).sort()) {
    if (key === "stack" || key === "message" || key === "name") continue;
    const descriptor = Object.getOwnPropertyDescriptor(thrown, key);
    if (!descriptor || descriptor.get || descriptor.set) {
      fields[key] = { $prooftape: "unsupported", reason: "accessor-property" };
      unsupported.push({ path: `/error/${key}`, reason: "accessor-property", type: "error" });
      continue;
    }
    const serialized = safeSerialize(descriptor.value, options);
    unsupported.push(...serialized.unsupported.map((item) => ({
      ...item,
      path: `/error/${key}${item.path === "/" ? "" : item.path}`,
    })));
    if (key === "code") code = serialized.value;
    else fields[key] = serialized.value;
  }

  return {
    error: {
      name: redactedString(thrown.name, options),
      message: redactedString(thrown.message, options),
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

function isNativePromise(value: unknown): value is Promise<unknown> {
  return value instanceof Promise && Object.getPrototypeOf(value) === Promise.prototype;
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

  const emit = (call: CallObservationV1): void => {
    try {
      options.emit(call);
    } catch (error) {
      options.onInternalError?.(error);
    }
  };

  return {
    invoke<T>(
      dependency: string,
      exportPath: string,
      callable: (...args: never[]) => T,
      thisArgument: unknown,
      args: unknown[],
    ): T {
      sequence += 1;
      const callSequence = sequence;
      const callId = `${options.processId}:${callSequence}`;
      const callSiteFingerprint = (
        options.callSiteFingerprint ?? defaultCallSiteFingerprint
      )();
      const started = process.hrtime.bigint();
      const argsBefore = safeSerialize(args, serializationOptions);

      const finish = (
        outcome: CallObservationV1["outcome"],
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
          dependency,
          exportPath,
          callSiteFingerprint,
          argsBefore: argsBefore.value,
          argsAfter: argsAfter.value,
          outcome,
          durationNanoseconds: (process.hrtime.bigint() - started).toString(10),
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
        finish("throw", { thrown: error });
        throw error;
      }

      if (isNativePromise(result)) {
        void Promise.prototype.then.call(
          result,
          (value: unknown) => {
            finish("resolve", { value });
          },
          (error: unknown) => {
            finish("reject", { thrown: error });
          },
        );
      } else {
        finish("return", { value: result });
      }
      return result;
    },
  };
}
