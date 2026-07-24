export interface HookOptions {
  readonly dependency: string;
  readonly outputPath: string;
}

export function registerProofTapeHooks(_options: HookOptions): never {
  throw new Error("ProofTape interception is not available in this pre-release build.");
}
