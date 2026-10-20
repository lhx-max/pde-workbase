import React from 'react';

/** One queue per canvas. Gesture frames never run presentation/background work. */
export function createCanvasIdleWork() {
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let quietUntil = 0;
  let wakeAt = 0;
  const jobs = new Map<() => void, number>();
  const arm = () => {
    if (active || !jobs.size) return;
    const due = Math.max(quietUntil, Math.min(...jobs.values()));
    const nextWake = Math.max(Date.now() + 16, due);
    if (timer !== undefined && nextWake >= wakeAt) return;
    if (timer !== undefined) clearTimeout(timer);
    wakeAt = nextWake;
    timer = setTimeout(drain, nextWake - Date.now());
  };
  const drain = () => {
    timer = undefined;
    if (active) return;
    const now = Date.now();
    let count = 0;
    // Limit React commits/loads per frame as well as waiting for quiet time.
    for (const [job, due] of jobs) {
      if (due > now || quietUntil > now) continue;
      jobs.delete(job);
      job();
      if (++count >= 4 || active) break;
    }
    arm();
  };
  return {
    isActive: () => active,
    setActive(value: boolean) {
      if (value === active) return;
      active = value;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (!value) quietUntil = Date.now() + 180;
      arm();
    },
    schedule(job: () => void, delay = 180) {
      jobs.set(job, Date.now() + delay);
      arm();
      return () => { jobs.delete(job); };
    },
    clear() {
      jobs.clear();
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

export const CanvasIdleWorkContext = React.createContext<ReturnType<typeof createCanvasIdleWork> | null>(null);

export function useCanvasIdleWork() {
  const inherited = React.useContext(CanvasIdleWorkContext);
  const local = React.useMemo(createCanvasIdleWork, []);
  React.useEffect(() => () => local.clear(), [local]);
  return inherited ?? local;
}
