import { useEffect, useRef } from 'react';
import { useStore } from '../store';

// D3-2: Exponential backoff with jitter, never permanently give up
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

/** Pure helper: compute which sessions need subscribe/unsubscribe. */
export function computeSubscriptionDiff(
  subscribed: Set<string>,
  current: Set<string>,
): { toSubscribe: string[]; toUnsubscribe: string[] } {
  const toSubscribe: string[] = [];
  const toUnsubscribe: string[] = [];
  for (const sid of current) {
    if (sid && !subscribed.has(sid)) toSubscribe.push(sid);
  }
  for (const sid of subscribed) {
    if (!current.has(sid)) toUnsubscribe.push(sid);
  }
  return { toSubscribe, toUnsubscribe };
}

/**
 * Manages WebSocket lifecycle: single persistent connection per tab,
 * subscribes to ALL open notebook sessions (not just the active one).
 */
export function useWebSocket(sessionId: string | null) {
  const connectWebSocket = useStore((s) => s.connectWebSocket);
  const disconnectWebSocket = useStore((s) => s.disconnectWebSocket);
  const subscribeToSession = useStore((s) => s.subscribeToSession);
  const unsubscribeFromSession = useStore((s) => s.unsubscribeFromSession);
  const setWsReconnectExhausted = useStore((s) => s.setWsReconnectExhausted);

  const reconnectAttempts = useRef(0);
  const subscribedRef = useRef<Set<string>>(new Set());

  // Derive a stable string key from all open session IDs.
  // Include both openNotebooks sessions AND global sessionId for backward compat (restoreNotebook sets global sessionId)
  const openSessionIds = useStore(
    (s) => {
      const ids = Object.values(s.openNotebooks).map((e) => e.sessionId).filter(Boolean);
      // Also include global sessionId (set by restoreNotebook after page refresh)
      if (s.sessionId && !ids.includes(s.sessionId)) {
        ids.push(s.sessionId);
      }
      return ids.sort().join(',');
    },
  );

  // Connect once on mount; auto-reconnect with exponential backoff.
  useEffect(() => {
    reconnectAttempts.current = 0;
    setWsReconnectExhausted(false);
    connectWebSocket();

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = () => {
      const status = useStore.getState().wsStatus;
      if (status === 'connected') {
        reconnectAttempts.current = 0;
        setWsReconnectExhausted(false);
        return;
      }
      if (status === 'disconnected') {
        reconnectAttempts.current += 1;
        // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 30s + jitter
        const backoff = Math.min(BASE_DELAY_MS * Math.pow(2, reconnectAttempts.current - 1), MAX_DELAY_MS);
        const jitter = Math.random() * backoff * 0.3;
        reconnectTimer = setTimeout(() => {
          connectWebSocket();
          scheduleReconnect();
        }, backoff + jitter);
      } else {
        // connecting state — check again in 1s
        reconnectTimer = setTimeout(scheduleReconnect, 1000);
      }
    };

    // Monitor connection state changes via zustand subscribe
    const unsub = useStore.subscribe((state, prev) => {
      if (state.wsStatus !== prev.wsStatus) {
        if (state.wsStatus === 'connected') {
          reconnectAttempts.current = 0;
          setWsReconnectExhausted(false);
          if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        } else if (state.wsStatus === 'disconnected' && prev.wsStatus === 'connected') {
          scheduleReconnect();
        }
      }
    });

    return () => {
      unsub();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      disconnectWebSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe/unsubscribe when the set of open sessions changes.
  useEffect(() => {
    const current = new Set(openSessionIds ? openSessionIds.split(',') : []);
    const { toSubscribe, toUnsubscribe } = computeSubscriptionDiff(subscribedRef.current, current);

    for (const sid of toSubscribe) {
      subscribeToSession(sid);
      subscribedRef.current.add(sid);
    }
    for (const sid of toUnsubscribe) {
      unsubscribeFromSession(sid);
      subscribedRef.current.delete(sid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSessionIds]);
}
