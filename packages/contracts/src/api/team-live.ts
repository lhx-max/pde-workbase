export interface NativeTeamSessionEvent {
  seq: number;
  runId: string;
  type: 'text_delta' | 'started' | 'finished' | 'failed';
  text?: string;
  /** Missing on historical records whose terminal outcome is unknown. */
  terminalStatus?: 'succeeded' | 'failed' | 'canceled';
  occurredAt: number;
}
export interface NativeTeamSessionEventPage {
  events: NativeTeamSessionEvent[];
  nextCursor: number;
  hasMore: boolean;
}
export interface NativeTeamPresence {
  userId: string;
  name: string;
  state: 'viewing' | 'working';
  lastSeenAt: number;
}

export interface NativeTeamSessionReadState {
  readThrough: number;
  latestSeq: number;
  unreadEvents: number;
}
