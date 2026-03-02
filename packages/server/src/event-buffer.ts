export const EVENT_BUFFER_SIZE = 500;

export interface BufferedEvent {
  event_index: number;
  event: Record<string, unknown>;
}

/**
 * Fixed-size ring buffer for WS events, enabling resume-after reconnection.
 * D4: Uses circular index for O(1) push — no linear eviction overhead.
 */
export class EventBuffer {
  private buffer: (BufferedEvent | null)[] = new Array(EVENT_BUFFER_SIZE).fill(null);
  private writeIdx = 0;
  private count = 0;
  nextIndex = 0;

  /** Push an event into the buffer, assigning a monotonically increasing index. */
  push(event: Record<string, unknown>): BufferedEvent & { event_index: number } {
    const entry: BufferedEvent = {
      event_index: this.nextIndex++,
      event,
    };
    this.buffer[this.writeIdx] = entry;
    this.writeIdx = (this.writeIdx + 1) % EVENT_BUFFER_SIZE;
    if (this.count < EVENT_BUFFER_SIZE) this.count++;
    return entry;
  }

  /** Get all buffered events in insertion order. */
  getEvents(): BufferedEvent[] {
    if (this.count === 0) return [];
    const result: BufferedEvent[] = [];
    const start = this.count < EVENT_BUFFER_SIZE
      ? 0
      : this.writeIdx; // oldest entry is at writeIdx when full
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % EVENT_BUFFER_SIZE;
      const entry = this.buffer[idx];
      if (entry) result.push(entry);
    }
    return result;
  }

  /** Get events with index > afterIndex, in order. */
  getEventsAfter(afterIndex: number): BufferedEvent[] {
    return this.getEvents().filter((e) => e.event_index > afterIndex);
  }

  /** Clear the buffer. */
  clear(): void {
    this.buffer = new Array(EVENT_BUFFER_SIZE).fill(null);
    this.writeIdx = 0;
    this.count = 0;
  }
}
