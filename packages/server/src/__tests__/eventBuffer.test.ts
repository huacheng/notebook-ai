import { describe, it, expect, beforeEach } from 'vitest';
import { EventBuffer, EVENT_BUFFER_SIZE } from '../event-buffer.js';

describe('EventBuffer', () => {
  let buffer: EventBuffer;

  beforeEach(() => {
    buffer = new EventBuffer();
  });

  it('is empty for new instance', () => {
    expect(buffer.getEvents()).toEqual([]);
    expect(buffer.nextIndex).toBe(0);
  });

  it('assigns monotonically increasing event_index', () => {
    const e1 = buffer.push({ type: 'cell_output', cell_id: 'c1' });
    const e2 = buffer.push({ type: 'cell_output', cell_id: 'c2' });
    const e3 = buffer.push({ type: 'cell_stream', cell_id: 'c1' });

    expect(e1.event_index).toBe(0);
    expect(e2.event_index).toBe(1);
    expect(e3.event_index).toBe(2);
    expect(buffer.nextIndex).toBe(3);
  });

  it('caps at EVENT_BUFFER_SIZE', () => {
    for (let i = 0; i < EVENT_BUFFER_SIZE + 50; i++) {
      buffer.push({ type: 'cell_output', cell_id: `c${i}` });
    }

    const events = buffer.getEvents();
    expect(events.length).toBe(EVENT_BUFFER_SIZE);
    // Oldest event should be index 50 (first 50 were evicted)
    expect(events[0].event_index).toBe(50);
    // Newest should be EVENT_BUFFER_SIZE + 49
    expect(events[events.length - 1].event_index).toBe(EVENT_BUFFER_SIZE + 49);
  });

  it('getEventsAfter returns events after given index', () => {
    buffer.push({ type: 'a' });
    buffer.push({ type: 'b' });
    buffer.push({ type: 'c' });

    const after1 = buffer.getEventsAfter(0);
    expect(after1.length).toBe(2);
    expect(after1[0].event.type).toBe('b');
    expect(after1[1].event.type).toBe('c');
  });

  it('getEventsAfter with index beyond range returns empty', () => {
    buffer.push({ type: 'a' });
    const result = buffer.getEventsAfter(999);
    expect(result).toEqual([]);
  });

  it('clear empties the buffer', () => {
    buffer.push({ type: 'a' });
    buffer.push({ type: 'b' });
    buffer.clear();
    expect(buffer.getEvents()).toEqual([]);
  });
});
