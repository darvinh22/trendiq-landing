export const STORE_FILE_NAME: string;
export const PROVISION_MARKER_NAME: string;
export const AUDIT_LOG_NAME: string;
export const LOCK_STALE_MS: number;

export class OpenAnalysisStoreError extends Error {
  constructor(message: string);
}

export function provisionStore(directory: string, now?: Date): Promise<"created" | "unchanged">;
export function readStoreDocument(directory: string): Promise<Record<string, any>>;
export function withStoreFile<T>(
  directory: string,
  options: { lockWaitMs?: number },
  mutator: (document: any) => T | Promise<T>,
  afterWrite?: (result: T) => Promise<void>
): Promise<T>;
export function reconcileVerifiedHold(
  directory: string,
  input: {
    holdId: string;
    providerCostUsd: number;
    evidenceRef: string;
    now?: Date;
    lockWaitMs?: number;
  }
): Promise<{ idempotent: boolean; actualMicros: number; dayKey: string; evidenceRef: string }>;
export function commitStaleSteal(
  lockPath: string,
  observed: { pid?: number; createdAt?: string; token?: string }
): Promise<boolean>;
export function releaseStoreLock(lock: { path: string; token: string; pid: number }): Promise<void>;
export function isEvidenceRef(value: string): boolean;
