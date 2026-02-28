/**
 * Simple fetch-race guard: prevents stale async responses from overwriting
 * newer state. Each call to `next()` returns a new ID and invalidates
 * all previous IDs.
 */
export function makeFetchGuard() {
  let current = 0;
  return {
    /** Start a new fetch — returns its unique ID and invalidates all previous. */
    next(): number {
      return ++current;
    },
    /** Check whether the given ID is still the latest. */
    isCurrent(id: number): boolean {
      return id === current;
    },
  };
}
