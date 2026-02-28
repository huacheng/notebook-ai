import { useEffect, useRef } from 'react';
import { useStore } from '../store';

/**
 * useWatcher — subscribe to server-side file/git change notifications via WebSocket.
 *
 * @param kind  'git' (watch HEAD changes) or 'files' (watch directory changes)
 * @param opts  projectId (for git/files) and/or dirPath (for files, use '__library__' for library)
 *
 * When the server detects a change, it sends a git_changed or files_changed message.
 * The wsSlice dispatches a CustomEvent ('nb:git-changed' or 'nb:files-changed') which
 * consuming components can listen to via standard addEventListener.
 */
export function useWatcher(
  kind: 'git' | 'files',
  opts: { projectId?: string | null; dirPath?: string },
) {
  const ws = useStore((s) => s.ws);
  const wsStatus = useStore((s) => s.wsStatus);
  const watchIdRef = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    if (!ws || wsStatus !== 'connected') return;

    // Determine if we have enough info to subscribe
    if (kind === 'git' && !opts.projectId) return;
    if (kind === 'files' && !opts.projectId && !opts.dirPath) return;

    const watchId = watchIdRef.current;

    const msg: Record<string, unknown> = {
      type: 'watch_subscribe',
      watch_id: watchId,
      kind,
    };
    if (opts.projectId) msg.project_id = opts.projectId;
    if (opts.dirPath) msg.dir_path = opts.dirPath;

    ws.send(JSON.stringify(msg));

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'watch_unsubscribe', watch_id: watchId }));
      }
      // Generate new ID for next subscription cycle
      watchIdRef.current = crypto.randomUUID();
    };
  }, [ws, wsStatus, kind, opts.projectId, opts.dirPath]);
}
