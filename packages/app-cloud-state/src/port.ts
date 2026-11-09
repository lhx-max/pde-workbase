/** Structural slice of an Appwrite REST client this package consumes. The
 * caller supplies the implementation (and owns credentials, endpoint and
 * project); no vendor SDK is imported here. */
export interface AppwriteStateClient {
  call<T>(method: string, path: string, body?: unknown): Promise<T>;
  /** GET that resolves to null when the addressed document is missing. */
  getOrNull<T>(path: string): Promise<T | null>;
  /** `/databases/<db>/collections/<collection>/documents` resource path. */
  docsPath(databaseId: string, collectionId: string): string;
}

/** Synchronous in-memory view of cloud-owned JSON slots with an explicit
 * readiness gate and durability barrier. */
export interface JsonStatePort {
  /** Resolves once the namespace has been loaded (or the manifest created
   * under explicit `initialize`). Rejects if the backend is unavailable or
   * the stored data is malformed. */
  readonly ready: Promise<void>;
  /** Deep-cloned slot value, or `undefined` for an absent slot. Throws when
   * not ready, on a reserved slot name, or after a persistence failure. */
  read(key: string): unknown | undefined;
  /** Synchronously validates, snapshots and stages the value, then queues a
   * serialized document write. Returns before the network completes; use
   * `flush()` for durability. Throws when not ready, on a reserved slot, on
   * a non-JSON/oversize value, or after a persistence failure. */
  write(key: string, value: unknown): void;
  /** Resolves when every queued write has reached the backend; rejects with
   * the recorded failure if persistence failed. */
  flush(): Promise<void>;
}

/** Opt-in bounds for write-acknowledgement reconciliation. Bounds come from
 * the caller's OWN clock (typically the invocation deadline): `deadlineAt`
 * is an absolute epoch-ms bound shared with the rest of the invocation,
 * `timeoutMs` an additional per-attempt relative bound. At least one is
 * required — the reconcile never gets a fresh, unbounded window. */
export interface WriteReconcileOptions {
  /** Absolute deadline (epoch ms, Date.now() clock) — e.g. the end of the
   * invocation business window. */
  deadlineAt?: number;
  /** Additional relative bound measured from the failed write (ms). */
  timeoutMs?: number;
  /** Delay between read-backs while the row is missing/undecidable (ms);
   * default 150. */
  pollIntervalMs?: number;
}

export interface AppwriteJsonStateOptions {
  client: AppwriteStateClient;
  databaseId: string;
  collectionId: string;
  /** Explicit namespace; never inferred from cwd, env or document paths. */
  namespace: string;
  /** Must be `true`. There is no distributed CAS and no replica safety: the
   * caller must explicitly acknowledge that exactly one writer instance owns
   * the namespace at a time. */
  singleWriter: boolean;
  /** Explicit one-time bootstrap acknowledgement. When the namespace has no
   * manifest, creates exactly the manifest document — never collection
   * schema, indexes or ACLs. On a create conflict the existing manifest is
   * re-read and validated, never reset. */
  initialize?: boolean;
  /** Required to enable `reconcileWrite`: declares that this invocation
   * already holds the exclusive external writer lock covering this
   * namespace, so a read-back reconciliation is the only second writer
   * decision ever made. Without the lock contract, reconciling an ambiguous
   * write could mask another writer's row. */
  externalWriterLock?: boolean;
  /** Opt-in lost-acknowledgement reconcile for slot writes. Absent = legacy
   * behavior: any failed persist poisons the port immediately. */
  reconcileWrite?: WriteReconcileOptions;
}
