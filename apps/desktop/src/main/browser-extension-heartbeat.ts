export const EXTENSION_HEARTBEAT_MS = 8000;

export function isExtensionHeartbeatLive(lastSeenAt: number | null, now: number, windowMs = EXTENSION_HEARTBEAT_MS): boolean {
  return lastSeenAt != null && now - lastSeenAt <= windowMs;
}
