export class ProjectSerialLock {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.catch(() => undefined).then(() => current);
    this.tails.set(projectId, tail);
    await prior.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(projectId) === tail) this.tails.delete(projectId);
    }
  }
}
