import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import type { FileAnnotations } from '../types/fileAnnotations';
import { storageKey, EMPTY_FILE_ANNOTATIONS } from '../types/fileAnnotations';
import { cacheSet, cacheGet, TTL } from '../utils/localCache';

interface UseAnnotationPersistenceArgs {
  sessionId: string;
  notebookId: string;
  filePath: string;
  annotations: FileAnnotations;
  annLoadedRef: { current: boolean };
  setAnnotations: React.Dispatch<React.SetStateAction<FileAnnotations>>;
}

/**
 * Dual-layer annotation persistence:
 * - L1: localStorage with 50ms debounce
 * - L2: WebSocket annotation-sync with adaptive interval (max(200ms, latency×3))
 * - Load: L1 instant + L2 async merge (take newer by updatedAt)
 */
export function useAnnotationPersistence({
  sessionId, notebookId, filePath, annotations, annLoadedRef, setAnnotations,
}: UseAnnotationPersistenceArgs) {
  const ws = useStore((s) => s.ws);
  const wsStatus = useStore((s) => s.wsStatus);
  const latency = useStore((s) => s.latency);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const syncInFlightRef = useRef(false);

  // L1 + L2 save whenever annotations change
  useEffect(() => {
    // Guard: skip if sessionId is empty (e.g. page refresh before session restored)
    if (!annLoadedRef.current || !ws || wsStatus !== 'connected' || !sessionId) return;
    const lsKey = storageKey(notebookId, filePath);
    const serialized = JSON.stringify(annotations);

    // L1: 50ms → localStorage
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      cacheSet(lsKey, annotations);
    }, 50);

    // L2: adaptive ≥200ms → WS annotation-sync
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    const syncInterval = Math.max(200, (latency ?? 30) * 3);
    syncTimerRef.current = setTimeout(() => {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      ws.send(JSON.stringify({
        type: 'annotation-sync',
        session_id: sessionId,
        path: filePath,
        content: serialized,
        updated_at: annotations.updatedAt,
      }));
      setTimeout(() => { syncInFlightRef.current = false; }, 5000);
    }, syncInterval);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [annotations, sessionId, notebookId, filePath, ws, wsStatus, latency, annLoadedRef]);

  // Load on filePath change: L1 instant + L2 async merge
  useEffect(() => {
    annLoadedRef.current = false;

    // L1: instant from localStorage (always reset, even without WS)
    let localUpdatedAt = 0;
    const saved = cacheGet<FileAnnotations>(storageKey(notebookId, filePath), TTL.ANNOTATION);
    if (saved) {
      setAnnotations(saved);
      localUpdatedAt = saved.updatedAt ?? 0;
    } else {
      setAnnotations(EMPTY_FILE_ANNOTATIONS);
    }

    // Guard: skip WS load if sessionId is empty (page refresh before session restored)
    if (!ws || wsStatus !== 'connected' || !sessionId) {
      annLoadedRef.current = true;
      return;
    }

    // L2: async from server
    function handleMessage(event: MessageEvent) {
      let msg: { type: string; session_id?: string; path?: string; [key: string]: unknown };
      try { msg = JSON.parse(event.data as string); } catch { return; }
      if (msg.type !== 'annotation-data') return;
      if (msg.session_id !== sessionId) return;
      if (msg.path !== filePath) return;

      const serverUpdatedAt = (msg.updated_at as number) ?? 0;
      if (serverUpdatedAt > localUpdatedAt) {
        try {
          const parsed = JSON.parse(msg.content as string) as FileAnnotations;
          setAnnotations(parsed);
          cacheSet(storageKey(notebookId, filePath), parsed);
        } catch { /* corrupt */ }
      }
      annLoadedRef.current = true;
    }

    ws.addEventListener('message', handleMessage);
    ws.send(JSON.stringify({ type: 'annotation-load', session_id: sessionId, path: filePath }));
    annLoadedRef.current = true; // allow saving even while fetch is in flight

    return () => {
      ws.removeEventListener('message', handleMessage);
    };
  }, [sessionId, notebookId, filePath, ws, wsStatus]); // eslint-disable-line react-hooks/exhaustive-deps
}
