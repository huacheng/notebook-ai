import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../store';
import { cacheSet, cacheGet, cacheRemove, TTL } from '../utils/localCache';
import { storageKey as annotationStorageKey } from '../types/fileAnnotations';
import * as lz4 from 'lz4js';

export type FileFormat = 'text' | 'html' | 'pdf-binary' | 'docx-binary' | 'xlsx-binary' | 'pptx-binary' | 'image' | 'unsupported';

export interface FileStreamState {
  status: 'idle' | 'loading' | 'converting' | 'complete' | 'error';
  format: FileFormat | null;
  content: string;
  binaryBuffer: Uint8Array | null;
  mtime: number;
  error: string | null;
}

const INITIAL_STATE: FileStreamState = {
  status: 'idle',
  format: null,
  content: '',
  binaryBuffer: null,
  mtime: 0,
  error: null,
};

const THROTTLE_MS = 200;

import { b64ToUint8Array } from '../utils/b64';

export function useFileStream(
  sessionId: string | null,
  notebookId: string | null,
  filePath: string | null,
  source: 'workspace' | 'library' | 'deliverables',
  projectId?: string | null,
  suppressChanges = false,
) {
  const ws = useStore((s) => s.ws);
  const wsStatus = useStore((s) => s.wsStatus);
  const [state, setState] = useState<FileStreamState>(INITIAL_STATE);

  const contentChunksRef = useRef<string[]>([]);
  const b64ChunksRef = useRef<string[]>([]);
  const formatRef = useRef<FileFormat | null>(null);
  const throttleRef = useRef<number | null>(null);
  const skipStreamRef = useRef(false);

  const flushState = useCallback(() => {
    setState((prev) => ({
      ...prev,
      content: (formatRef.current?.endsWith('-binary') || formatRef.current === 'image') ? prev.content : contentChunksRef.current.join(''),
    }));
  }, []);

  const scheduleFlush = useCallback(() => {
    if (throttleRef.current !== null) return;
    throttleRef.current = window.setTimeout(() => {
      throttleRef.current = null;
      flushState();
    }, THROTTLE_MS);
  }, [flushState]);

  useEffect(() => {
    if (!filePath || !ws || wsStatus !== 'connected') return;
    if (!sessionId && source !== 'library' && !projectId) return;
    // Determine effective session for file access:
    // - For workspace/deliverables: use sessionId (real session) when available, or fallback to projectId-based pseudo-session
    // - Pseudo-session (__project_{projectId}__) works without active subscription, enabling file access after page refresh
    // - The key insight: file access only needs project context, not the Claude agent session
    const effectiveSessionId = sessionId || (projectId ? `__project_${projectId}__` : '__library__');

    contentChunksRef.current = [];
    b64ChunksRef.current = [];
    formatRef.current = null;
    skipStreamRef.current = false;
    let stale = false;
    setState({ ...INITIAL_STATE, status: 'loading' });

    // Check localStorage cache (text and binary both cached as strings)
    const cacheKey = `file-content-${notebookId ?? effectiveSessionId}-${filePath}`;
    let cachedMtime = 0;
    let cachedContent = '';
    let cachedFormat: FileFormat | null = null;
    const ttl = filePath.match(/\.(pdf|docx|xlsx|pptx|png|jpg|jpeg|gif|webp)$/i) ? TTL.BINARY_CONTENT : TTL.FILE_CONTENT;
    const cached = cacheGet<{ content: string; mtime: number; format: FileFormat }>(cacheKey, ttl);
    if (cached) {
      cachedMtime = cached.mtime;
      cachedContent = cached.content;
      cachedFormat = cached.format;
      formatRef.current = cached.format;
      if (!(cached.format.endsWith('-binary') || cached.format === 'image')) {
        contentChunksRef.current = [cached.content];
      }
      // Render cached content immediately while waiting for server mtime check
      setState({
        status: 'loading',
        format: cached.format,
        content: cached.format.endsWith('-binary') || cached.format === 'image' ? '' : cached.content,
        binaryBuffer: null,
        mtime: cached.mtime,
        error: null,
      });
    }

    function handleMessage(event: MessageEvent) {
      let msg: { type: string; session_id?: string; [key: string]: unknown };
      try { msg = JSON.parse(event.data as string); } catch { return; }
      if (msg.session_id !== effectiveSessionId) return;

      switch (msg.type) {
        case 'file-open-converting': {
          setState((prev) => ({ ...prev, status: 'converting' }));
          break;
        }
        case 'file-open-meta': {
          const { mtime, format } = msg as unknown as { mtime: number; format: FileFormat };
          formatRef.current = format;
          // If mtime matches cache, skip streaming — use cached content
          if (mtime === cachedMtime && cachedContent && cachedFormat === format) {
            if (format.endsWith('-binary') || format === 'image') {
              skipStreamRef.current = true;
              b64ToUint8Array(cachedContent).then((buf) => {
                if (stale) return;
                setState({ status: 'complete', format, content: '', binaryBuffer: buf, mtime, error: null });
              }).catch(() => {
                if (stale) return;
                // Corrupted cache — clear and re-request
                cacheRemove(cacheKey);
                skipStreamRef.current = false;
                contentChunksRef.current = [];
                b64ChunksRef.current = [];
                const retryMsg: Record<string, string> = { type: 'file-open', session_id: effectiveSessionId, path: filePath!, source };
                if (projectId) retryMsg.project_id = projectId;
                ws?.send(JSON.stringify(retryMsg));
              });
            } else {
              skipStreamRef.current = true;
              setState({ status: 'complete', format, content: cachedContent, binaryBuffer: null, mtime, error: null });
            }
          } else {
            contentChunksRef.current = [];
            b64ChunksRef.current = [];
          }
          break;
        }
        case 'file-chunk': {
          if (skipStreamRef.current) break;
          const { data, encoding } = msg as unknown as { data: string; encoding: 'utf8' | 'base64' };
          if (encoding === 'base64') {
            b64ChunksRef.current.push(data);
          } else {
            contentChunksRef.current.push(data);
          }
          scheduleFlush();
          break;
        }
        case 'file-chunk-compressed': {
          if (skipStreamRef.current) break;
          const { data, encoding } = msg as unknown as {
            data: string;
            encoding: 'utf8' | 'base64';
          };
          try {
            const compressedBytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
            // LZ4 decompression (server always sends LZ4 for chunked compression)
            const decompressed = lz4.decompress(compressedBytes);
            if (encoding === 'base64') {
              // Binary file: convert decompressed bytes back to base64 for existing flow
              const b64 = btoa(String.fromCharCode(...decompressed));
              b64ChunksRef.current.push(b64);
            } else {
              // Text file: decode as UTF-8
              const text = new TextDecoder().decode(decompressed);
              contentChunksRef.current.push(text);
            }
          } catch (e) {
            console.error('[useFileStream] Failed to decompress:', e);
            // D3: Update state to notify user of decompression failure
            setState((prev) => ({ ...prev, status: 'error', error: `Decompression failed: ${String(e)}` }));
          }
          break;
        }
        case 'file-open-end': {
          if (skipStreamRef.current) break;
          if (throttleRef.current !== null) { clearTimeout(throttleRef.current); throttleRef.current = null; }
          const fmt = formatRef.current;
          const mtime = (msg as unknown as { mtime: number }).mtime;
          if (fmt?.endsWith('-binary') || fmt === 'image') {
            const b64 = b64ChunksRef.current.join('');
            b64ToUint8Array(b64).then((buffer) => {
              if (stale) return;
              cacheSet(cacheKey, { content: b64, mtime, format: fmt });
              setState({ status: 'complete', format: fmt, content: '', binaryBuffer: buffer, mtime, error: null });
            }).catch((err) => {
              if (stale) return;
              setState((prev) => ({ ...prev, status: 'error', error: `Failed to decode binary data: ${String(err)}` }));
            });
          } else {
            cacheSet(cacheKey, { content: contentChunksRef.current.join(''), mtime, format: fmt });
            setState({ status: 'complete', format: fmt ?? 'text', content: contentChunksRef.current.join(''), binaryBuffer: null, mtime, error: null });
          }
          break;
        }
        case 'file-open-error': {
          setState((prev) => ({ ...prev, status: 'error', error: (msg as unknown as { error: string }).error }));
          break;
        }

        // ── Live push update handlers ─────────────────────────────────
        // Server pushes file changes when the file is modified on the backend
        // When suppressChanges is true (edit mode), ignore these to prevent flash/content loss

        case 'file-changed-meta': {
          if (suppressChanges) break; // Ignore external changes while editing
          const { path: changedPath, mtime, format } = msg as unknown as { path: string; mtime: number; format: FileFormat };
          // Only process if this is the file we're watching
          if (changedPath !== filePath) break;
          // Reset chunks for incoming update
          contentChunksRef.current = [];
          b64ChunksRef.current = [];
          formatRef.current = format;
          skipStreamRef.current = false;
          // Set loading status to indicate refresh in progress
          setState((prev) => ({ ...prev, status: 'loading', mtime, format }));
          break;
        }

        case 'file-changed-chunk': {
          if (suppressChanges) break;
          const { path: changedPath, data, encoding } = msg as unknown as { path: string; data: string; encoding: 'utf8' | 'base64' };
          if (changedPath !== filePath) break;
          if (encoding === 'base64') {
            b64ChunksRef.current.push(data);
          } else {
            contentChunksRef.current.push(data);
          }
          scheduleFlush();
          break;
        }

        case 'file-changed-chunk-compressed': {
          if (suppressChanges) break;
          const { path: changedPath, data, encoding } = msg as unknown as {
            path: string;
            data: string;
            encoding: 'utf8' | 'base64';
          };
          if (changedPath !== filePath) break;
          try {
            const compressedBytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
            const decompressed = lz4.decompress(compressedBytes);
            if (encoding === 'base64') {
              const b64 = btoa(String.fromCharCode(...decompressed));
              b64ChunksRef.current.push(b64);
            } else {
              const text = new TextDecoder().decode(decompressed);
              contentChunksRef.current.push(text);
            }
          } catch (e) {
            console.error('[useFileStream] Failed to decompress file-changed chunk:', e);
            // D3: Update state to notify user of decompression failure
            setState((prev) => ({ ...prev, status: 'error', error: `Decompression failed: ${String(e)}` }));
          }
          break;
        }

        case 'file-changed-end': {
          if (suppressChanges) break;
          const { path: changedPath, mtime } = msg as unknown as { path: string; mtime: number };
          if (changedPath !== filePath) break;
          if (throttleRef.current !== null) { clearTimeout(throttleRef.current); throttleRef.current = null; }
          const fmt = formatRef.current;
          if (fmt?.endsWith('-binary') || fmt === 'image') {
            const b64 = b64ChunksRef.current.join('');
            b64ToUint8Array(b64).then((buffer) => {
              if (stale) return;
              cacheSet(cacheKey, { content: b64, mtime, format: fmt });
              setState({ status: 'complete', format: fmt, content: '', binaryBuffer: buffer, mtime, error: null });
            }).catch((err) => {
              if (stale) return;
              setState((prev) => ({ ...prev, status: 'error', error: `Failed to decode binary data: ${String(err)}` }));
            });
          } else {
            const newContent = contentChunksRef.current.join('');
            cacheSet(cacheKey, { content: newContent, mtime, format: fmt });
            setState({ status: 'complete', format: fmt ?? 'text', content: newContent, binaryBuffer: null, mtime, error: null });
          }
          break;
        }

        case 'file-deleted': {
          const { path: deletedPath } = msg as unknown as { path: string };
          if (deletedPath !== filePath) break;
          setState((prev) => ({ ...prev, status: 'error', error: 'File has been deleted' }));
          cacheRemove(cacheKey);
          // D1: cleanup orphaned annotations when file is deleted
          if (notebookId) {
            cacheRemove(annotationStorageKey(notebookId, filePath));
          }
          break;
        }
      }
    }

    ws.addEventListener('message', handleMessage);
    const openMsg: Record<string, string> = { type: 'file-open', session_id: effectiveSessionId, path: filePath, source };
    if (projectId) openMsg.project_id = projectId;
    ws.send(JSON.stringify(openMsg));

    return () => {
      stale = true;
      ws.removeEventListener('message', handleMessage);
      if (throttleRef.current !== null) { clearTimeout(throttleRef.current); throttleRef.current = null; }
    };
  }, [sessionId, notebookId, filePath, source, projectId, ws, wsStatus, scheduleFlush, suppressChanges]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
