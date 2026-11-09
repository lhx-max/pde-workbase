/** Stable error raised by this package. `status` is an HTTP-style status and
 * `code` is a machine-stable string; upstream/network response bodies are
 * never copied into the message. */
export class CloudStateError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'CloudStateError';
  }
}
