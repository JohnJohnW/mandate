/**
 * In-process event bus feeding the SSE stream. Every state change the
 * dashboard shows passes through here.
 */
export type EventName =
  | "intent.updated"
  | "trace.step"
  | "approval.created"
  | "approval.updated"
  | "audit.appended"
  | "mandate.updated"
  | "attack.progress"
  | "chat.message"
  | "system";

export interface BusEvent {
  id: number;
  name: EventName;
  at: string;
  data: unknown;
}

export class EventBus {
  private seq = 0;
  private listeners = new Set<(e: BusEvent) => void>();
  private recent: BusEvent[] = [];

  emit(name: EventName, data: unknown): BusEvent {
    const e: BusEvent = { id: ++this.seq, name, at: new Date().toISOString(), data };
    this.recent.push(e);
    if (this.recent.length > 500) this.recent.shift();
    for (const l of this.listeners) l(e);
    return e;
  }

  subscribe(fn: (e: BusEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  since(id: number): BusEvent[] {
    return this.recent.filter((e) => e.id > id);
  }
}
