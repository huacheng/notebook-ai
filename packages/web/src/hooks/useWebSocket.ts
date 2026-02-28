import { useEffect, useRef } from 'react';
import { useStore } from '../store';

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;

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
  const openSessionIds = useStore(
    (s) => Object.values(s.openNotebooks).map((e) => e.sessionId).filter(Boolean).sort().join(','),
  );

  // Connect once on mount; auto-reconnect on disconnect.
  useEffect(() => {
    reconnectAttempts.current = 0;
    setWsReconnectExhausted(false);
    connectWebSocket();

    const interval = setInterval(() => {
      const status = useStore.getState().wsStatus;
      if (status === 'disconnected' && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts.current += 1;
        connectWebSocket();
      }
      if (status === 'disconnected' && reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
        setWsReconnectExhausted(true);
      }
      if (status === 'connected') {
        reconnectAttempts.current = 0;
        setWsReconnectExhausted(false);
      }
    }, RECONNECT_DELAY_MS);

    return () => {
      clearInterval(interval);
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
