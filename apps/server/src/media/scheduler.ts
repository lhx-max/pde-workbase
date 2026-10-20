/** Process-local capacity, independent of chat. No automatic provider replay. */
export class MediaScheduler {
  private active = 0;
  private waiting: Array<{ start: () => void; reject: (error: Error) => void }> = [];
  private closed = false;
  constructor(readonly limit = 4) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 32) throw new Error('媒体并发上限必须为 1–32');
  }
  run<T>(work: () => Promise<T>, queued: () => void = () => {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active++;
        void Promise.resolve().then(work).then(resolve, reject).finally(() => {
          this.active--;
          if (!this.closed) this.waiting.shift()?.start();
        });
      };
      if (this.closed) { reject(new Error('服务已停止，尚未向供应商提交')); return; }
      if (this.active < this.limit) start();
      else { queued(); this.waiting.push({ start, reject }); }
    });
  }
  close() {
    this.closed = true;
    for (const entry of this.waiting.splice(0)) entry.reject(new Error('服务已停止，尚未向供应商提交'));
  }
}
