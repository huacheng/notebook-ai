import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';

/** WebSocket request timeout in milliseconds */
const WS_TIMEOUT = 120_000;

interface UseWsRequestOptions<T> {
  /** Whether the request should be triggered */
  enabled: boolean;
  /** Factory to create WebSocket message (called only when sending) */
  createWsMessage: () => Record<string, unknown>;
  /** Event name for successful response */
  responseEvent: string;
  /** Event name for error response */
  errorEvent: string;
  /** Extract data from successful response */
  extractData: (detail: Record<string, unknown>) => T;
  /** REST fallback function */
  restFallback: () => Promise<T>;
  /** Initial/reset value for data */
  initialValue: T;
  /** Error value for data */
  errorValue: T;
  /** Whether to allow retry on error (resets internal loaded flag) */
  allowRetry?: boolean;
  /** Dependencies array to trigger re-fetch (similar to useEffect deps) */
  deps?: readonly unknown[];
  /** If true, skip first load (data is preloaded) */
  preloaded?: boolean;
}

interface UseWsRequestResult<T> {
  data: T;
  loading: boolean;
  /** Reset to allow re-fetching (for allowRetry scenarios) */
  reset: () => void;
}

/**
 * Hook for WebSocket-first requests with REST fallback.
 * Handles request_id matching, timeout, cleanup, and cancellation.
 */
export function useWsRequest<T>({
  enabled,
  createWsMessage,
  responseEvent,
  errorEvent,
  extractData,
  restFallback,
  initialValue,
  errorValue,
  allowRetry = false,
  deps = [],
  preloaded = false,
}: UseWsRequestOptions<T>): UseWsRequestResult<T> {
  const [data, setData] = useState<T>(initialValue);
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef(preloaded);
  // Track deps to reset loadedRef when they change
  const prevDepsRef = useRef<readonly unknown[]>(deps);

  const reset = useCallback(() => {
    loadedRef.current = false;
    setData(initialValue);
  }, [initialValue]);

  // Reset loadedRef when deps change
  const depsChanged = deps.length !== prevDepsRef.current.length ||
    deps.some((d, i) => d !== prevDepsRef.current[i]);
  if (depsChanged) {
    loadedRef.current = false;
    prevDepsRef.current = deps;
  }

  useEffect(() => {
    if (!enabled || loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    let cancelled = false;

    const ws = useStore.getState().ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { cleanup(); fallbackRest(); }, WS_TIMEOUT);

      function onResponse(e: Event) {
        const d = (e as CustomEvent).detail;
        if (d.request_id === requestId) {
          cleanup();
          if (!cancelled) {
            setData(extractData(d));
            setLoading(false);
          }
        }
      }

      function onError(e: Event) {
        const d = (e as CustomEvent).detail;
        if (d.request_id === requestId) {
          cleanup();
          if (allowRetry) loadedRef.current = false;
          if (!cancelled) {
            setData(errorValue);
            setLoading(false);
          }
        }
      }

      function cleanup() {
        clearTimeout(timeout);
        window.removeEventListener(responseEvent, onResponse);
        window.removeEventListener(errorEvent, onError);
      }

      function fallbackRest() {
        restFallback()
          .then((result) => { if (!cancelled) setData(result); })
          .catch(() => {
            if (allowRetry) loadedRef.current = false;
            if (!cancelled) setData(errorValue);
          })
          .finally(() => { if (!cancelled) setLoading(false); });
      }

      window.addEventListener(responseEvent, onResponse);
      window.addEventListener(errorEvent, onError);
      ws.send(JSON.stringify({ ...createWsMessage(), request_id: requestId }));

      return () => { cancelled = true; cleanup(); };
    } else {
      // No WebSocket - use REST directly
      restFallback()
        .then((result) => { if (!cancelled) setData(result); })
        .catch(() => {
          if (allowRetry) loadedRef.current = false;
          if (!cancelled) setData(errorValue);
        })
        .finally(() => { if (!cancelled) setLoading(false); });

      return () => { cancelled = true; };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return { data, loading, reset };
}
