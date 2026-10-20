/** 组 / 组内子图共享 hover，避免移到子图时组胶囊消失 */
const listeners = new Set<(groupId: string | null) => void>();
let activeGroupHot: string | null = null;
let leaveTimer: number | null = null;

function clearLeaveTimer() {
  if (leaveTimer == null) return;
  window.clearTimeout(leaveTimer);
  leaveTimer = null;
}

export function setImageGroupHot(groupId: string | null) {
  clearLeaveTimer();
  if (activeGroupHot === groupId) return;
  activeGroupHot = groupId;
  listeners.forEach(listener => listener(groupId));
}

export function scheduleClearImageGroupHot(delayMs = 180) {
  clearLeaveTimer();
  leaveTimer = window.setTimeout(() => {
    leaveTimer = null;
    if (activeGroupHot == null) return;
    activeGroupHot = null;
    listeners.forEach(listener => listener(null));
  }, delayMs);
}

export function getImageGroupHot() {
  return activeGroupHot;
}

export function subscribeImageGroupHot(listener: (groupId: string | null) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
