/** Shared canvas errors. Historical wire codes stay stable for saved clients. */
export class CanvasStateError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CanvasStateError';
  }
}
