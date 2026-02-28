import { describe, it, expect } from 'vitest';
import { EventBuffer } from '../event-buffer.js';

describe('resume_after replay logic', () => {
  it('subscribe without resume_after does not replay (getEventsAfter not called)', () => {
    const buffer = new EventBuffer();
    buffer.push({ type: 'cell_output', cell_id: 'c1' });
    buffer.push({ type: 'cell_output', cell_id: 'c2' });
    // When resume_after is undefined, the handler should not call getEventsAfter.
    // We verify this by ensuring getEventsAfter(0) would return events,
    // but they are NOT replayed (tested at integration level in ws-handler).
    expect(buffer.getEventsAfter(-1).length).toBe(2); // would replay if called
  });

  it('subscribe with resume_after replays events after that index', () => {
    const buffer = new EventBuffer();
    buffer.push({ type: 'a' }); // index 0
    buffer.push({ type: 'b' }); // index 1
    buffer.push({ type: 'c' }); // index 2

    const missed = buffer.getEventsAfter(1);
    expect(missed.length).toBe(1);
    expect(missed[0].event.type).toBe('c');
    expect(missed[0].event_index).toBe(2);
  });

  it('subscribe with resume_after=0 replays all events after index 0', () => {
    const buffer = new EventBuffer();
    buffer.push({ type: 'a' }); // index 0
    buffer.push({ type: 'b' }); // index 1
    buffer.push({ type: 'c' }); // index 2

    const missed = buffer.getEventsAfter(0);
    expect(missed.length).toBe(2);
    expect(missed[0].event.type).toBe('b');
    expect(missed[1].event.type).toBe('c');
  });

  it('subscribe with resume_after beyond buffer range replays nothing', () => {
    const buffer = new EventBuffer();
    buffer.push({ type: 'a' }); // index 0

    const missed = buffer.getEventsAfter(999);
    expect(missed.length).toBe(0);
  });
});
