import { AsyncLocalStorage } from 'node:async_hooks';
import type { RecordProjectLedgerEventInput } from './service.js';
export type ProjectLedgerObservationRecorder = (input: RecordProjectLedgerEventInput) => void;
const recorders = new AsyncLocalStorage<ProjectLedgerObservationRecorder>();
/** Scope observations to the server instance, including async delivery descendants. */
export function withProjectLedgerRecorder<T>(recorder: ProjectLedgerObservationRecorder, operation: () => T): T {
  return recorders.run(recorder, operation);
}
/** Explicit context injection for service-only callers and upstream isolated tests. */
export function setActiveProjectLedgerRecorder(recorder: ProjectLedgerObservationRecorder | null): void {
  if (recorder) recorders.enterWith(recorder); else recorders.disable();
}
export function recordProjectLedgerObservation(input: RecordProjectLedgerEventInput): void {
  const recorder = recorders.getStore();
  if (!recorder) return; // Pure state-only consumers may omit history; HTTP service always injects it.
  recorder(input);
}
