export const EVENT_BUFFER_SIZE = 500;

export interface BufferedEvent {
  event_index: number;
  event: Record<string, unknown>;
}

/**
 * Fixed-size ring buffer for WS events, enabling resume-after reconnection.
 */
export class EventBuffer {
  private buffer: BufferedEvent[] = [];
  nextIndex = 0;

  /** Push an event into the buffer, assigning a monotonically increasing index. */
  push(event: Record<string, unknown>): BufferedEvent & { event_index: number } {
    const entry: BufferedEvent = {
      event_index: this.nextIndex++,
      event,
    };
    this.buffer.push(entry);
    if (this.buffer.length > EVENT_BUFFER_SIZE) {
      this.buffer.shift();
    }
    return entry;
  }

  /** Get all buffered events. */
  getEvents(): BufferedEvent[] {
    return this.buffer;
  }

  /** Get events with index > afterIndex, in order. */
  getEventsAfter(afterIndex: number): BufferedEvent[] {
    return this.buffer.filter((e) => e.event_index > afterIndex);
  }

  /** Clear the buffer. */
  clear(): void {
    this.buffer = [];
  }
}
