import { useState, useRef, useEffect, useCallback, Fragment } from 'react';
import { cacheSet, cacheGet, TTL } from '../utils/localCache';
import { makeFetchGuard } from '../utils/fetchGuard';
import { computeBreadcrumb, computeNavigateUp } from '../utils/worktreePath';
import { isWsFresh } from '../utils/wsFilesPush';
import { useT } from '../i18n';

// Compute a POSIX-style relative path from `fromDir` to `toFile`.
// Both arguments must be absolute Unix paths.
function relativePath(fromDir: string, toFile: string): string {
  const from = fromDir.replace(/\/+$/, '').split('/');
  const to = toFile.replace(/\/+$/, '').split('/');
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const ups = from.length - i;
  const downs = to.slice(i);
  return [...Array(ups).fill('..'), ...downs].join('/') || '.';
}

// ── Types ──────────────────────────────────────────────────────────────────

interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: string;
  /** D6-5: Project file list may include these optional fields */
  isNotebook?: boolean;
  worktreePath?: string;
}

interface ListResult {
  dirPath: string;
  files: FileEntry[];
  truncated: boolean;
  exists?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const EXT_TYPE: Record<string, string> = {
  py: 'py', js: 'js', jsx: 'js', ts: 'ts', tsx: 'ts',
  json: 'json', md: 'md', txt: 'txt', sh: 'sh',
  csv: 'csv', html: 'html', css: 'css', yaml: 'yml', yml: 'yml', log: 'txt', changelog: 'txt',
  png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', svg: 'img', webp: 'img',
  pdf: 'pdf', zip: 'zip', tar: 'zip', gz: 'zip',
  docx: 'doc', doc: 'doc', rtf: 'doc',
  pptx: 'ppt', ppt: 'ppt',
  xlsx: 'xls', xls: 'xls',
};

export function fileType(name: string): string {
  if (name.endsWith('.notebook.json')) return 'nb';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TYPE[ext] ?? (ext.slice(0, 4) || '···');
}

// ── SVG Icons ──────────────────────────────────────────────────────────────

function IconUpload() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="6" y1="8" x2="6" y2="1.5" />
      <polyline points="3.5,4 6,1.5 8.5,4" />
      <line x1="2" y1="10.5" x2="10" y2="10.5" />
    </svg>
  );
}

function IconNewFile() {
  return (
    <svg width="11" height="13" viewBox="0 0 11 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.5 1h6l3 3v8H1.5V1z" />
      <path d="M7.5 1v3h3" />
      <line x1="5.5" y1="6" x2="5.5" y2="9.5" />
      <line x1="3.8" y1="7.75" x2="7.2" y2="7.75" />
    </svg>
  );
}

function IconNewFolder() {
  return (
    <svg width="13" height="12" viewBox="0 0 13 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 2.5h4.5l1 1.5H12v7H1V2.5z" />
      <line x1="6.5" y1="6" x2="6.5" y2="9" />
      <line x1="5" y1="7.5" x2="8" y2="7.5" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.5 2.5a5 5 0 1 0 .5 4" />
      <polyline points="10.5,2.5 10.5,5.5 7.5,5.5" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="6" y1="1.5" x2="6" y2="8" />
      <polyline points="3.5,5.5 6,8 8.5,5.5" />
      <line x1="2" y1="10.5" x2="10" y2="10.5" />
    </svg>
  );
}

function IconFile() {
  return (
    <svg width="11" height="13" viewBox="0 0 11 13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="fp-entry-icon" aria-hidden="true">
      <path d="M1.5 1h6l3 3v8H1.5V1z" />
      <path d="M7.5 1v3h3" />
    </svg>
  );
}

/* ── File type badge icons (VS Code–inspired) ── */

const FILE_ICON_CONFIG: Record<string, { label: string; cls: string }> = {
  nb:   { label: 'NB',  cls: 'fp-ti-nb' },
  pdf:  { label: 'PDF', cls: 'fp-ti-pdf' },
  doc:  { label: 'W',   cls: 'fp-ti-doc' },
  ppt:  { label: 'P',   cls: 'fp-ti-ppt' },
  xls:  { label: 'X',   cls: 'fp-ti-xls' },
  py:   { label: 'PY',  cls: 'fp-ti-py' },
  js:   { label: 'JS',  cls: 'fp-ti-js' },
  ts:   { label: 'TS',  cls: 'fp-ti-ts' },
  json: { label: '{ }', cls: 'fp-ti-json' },
  html: { label: '</>',  cls: 'fp-ti-html' },
  css:  { label: '#',   cls: 'fp-ti-css' },
  md:   { label: 'MD',  cls: 'fp-ti-md' },
  txt:  { label: 'TXT', cls: 'fp-ti-txt' },
  sh:   { label: '$_',  cls: 'fp-ti-sh' },
  yml:  { label: 'YML', cls: 'fp-ti-yml' },
  csv:  { label: 'CSV', cls: 'fp-ti-csv' },
  img:  { label: 'IMG', cls: 'fp-ti-img' },
  zip:  { label: 'ZIP', cls: 'fp-ti-zip' },
};

export function FileIcon({ name }: { name: string }) {
  const t = fileType(name);
  const cfg = FILE_ICON_CONFIG[t];
  if (cfg) return <span className={`fp-type-icon ${cfg.cls}`} aria-hidden="true">{cfg.label}</span>;
  return <IconFile />;
}

function IconFolder() {
  return (
    <svg width="13" height="12" viewBox="0 0 13 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="fp-entry-icon fp-entry-icon-dir" aria-hidden="true">
      <path d="M1 2.5h4.5l1 1.5H12v7H1V2.5z" />
    </svg>
  );
}

// ── Drop zone hook — tracks external OS file drags ─────────────────────────

function useDropZone(onUpload: (files: FileList) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const count = useRef(0);

  const isFileDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes('Files');

  const dropProps = {
    onDragEnter(e: React.DragEvent) {
      if (!isFileDrag(e)) return;
      count.current++;
      setIsDragOver(true);
    },
    onDragLeave(e: React.DragEvent) {
      if (!isFileDrag(e)) return;
      count.current = Math.max(0, count.current - 1);
      if (count.current === 0) setIsDragOver(false);
    },
    onDragOver(e: React.DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDrop(e: React.DragEvent) {
      count.current = 0;
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        e.preventDefault();
        onUpload(e.dataTransfer.files);
      }
    },
  };

  return { isDragOver, dropProps };
}

// ── Type badge ─────────────────────────────────────────────────────────────

function TypeBadge({ name }: { name: string }) {
  const t = fileType(name);
  return <span className={`fp-badge fp-badge-${t}`}>{t}</span>;
}

// ── Unified FileSection ────────────────────────────────────────────────────

export interface FileSectionProps {
  baseUrl: string;
  authToken: string | null;
  showDownloadAll?: boolean;
  dropLabel?: string;
  /** If provided, drag paths are computed relative to this directory (library mode). */
  workspaceDir?: string | null;
  onFileClick?: (subPath: string, filename: string) => void;
  /** Initial sub-path to display (default: '.'). */
  initialPath?: string;
  /** Files matching this filter are NOT draggable (e.g. notebook files in sidebar). */
  noDragFilter?: (filename: string) => boolean;
  /** Custom action buttons for specific file entries. Return non-null to replace defaults. */
  renderItemActions?: (file: { name: string; type: string }, subPath: string) => React.ReactNode | null;
  /** When returns true for a file/directory name + subPath, the delete button is hidden. */
  noDeleteFilter?: (name: string, subPath: string) => boolean;
  /** Increment to force an immediate file list refresh. */
  refreshKey?: number;
  /** When returns true for a subPath, all write operations (upload/create/delete/download) are hidden. */
  readOnlyPath?: (subPath: string) => boolean;
  /** Called when the user navigates to a different sub-path. */
  onSubPathChange?: (subPath: string) => void;
  /** Optional callback for directory clicks. Return true (or resolve true) to prevent default navigateInto. */
  onDirClick?: (subPath: string, name: string, meta: { isNotebook?: boolean; worktreePath?: string }) => boolean | void | Promise<boolean | void>;
  /** Called when the directory existence is determined from API response. */
  onExists?: (exists: boolean) => void;
}

export function FileSection({
  baseUrl,
  authToken,
  showDownloadAll = false,
  dropLabel = 'Drop to upload',
  workspaceDir,
  onFileClick,
  initialPath = '.',
  noDragFilter,
  renderItemActions,
  noDeleteFilter,
  readOnlyPath,
  onSubPathChange,
  refreshKey,
  onDirClick,
  onExists,
}: FileSectionProps) {
  const t = useT();
  const [subPath, setSubPath] = useState(initialPath);

  useEffect(() => {
    onSubPathChange?.(subPath);
  }, [subPath]); // eslint-disable-line
  const isReadOnly = readOnlyPath?.(subPath) ?? false;
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [currentDirPath, setCurrentDirPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null);
  const [newName, setNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newNameRef = useRef<HTMLInputElement>(null);
  const fetchGuard = useRef(makeFetchGuard()).current;

  useEffect(() => {
    if (creating) { setNewName(''); setTimeout(() => newNameRef.current?.focus(), 0); }
  }, [creating]);

  const fetchFiles = useCallback(async (path: string, silent = false) => {
    const id = fetchGuard.next();
    const cacheKey = `nb-filelist-${baseUrl}-${path}`;

    // On silent refresh (WS-triggered), check if cache was just written by WS push
    if (silent && isWsFresh(cacheKey)) {
      const cached = cacheGet<ListResult>(cacheKey, TTL.FILE_LIST);
      if (cached) {
        setFiles(cached.files);
        setCurrentDirPath(cached.dirPath);
        onExists?.(cached.exists !== false);
        return; // Skip REST — WS already pushed fresh data
      }
    }

    // On non-silent loads, try cache first to avoid loading flash
    if (!silent) {
      const cached = cacheGet<ListResult>(cacheKey, TTL.FILE_LIST);
      if (cached) {
        setFiles(cached.files);
        setCurrentDirPath(cached.dirPath);
        // If cached response says directory doesn't exist, skip the background refetch
        // entirely — only a watcher refreshKey can re-trigger the check.
        if (cached.exists === false) {
          onExists?.(false);
          return;
        }
        // Don't set loading — render cached data immediately, fetch in background
      } else {
        setLoading(true);
      }
    }
    setError(null);
    try {
      const h: Record<string, string> = {};
      if (authToken) h['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(
        `${baseUrl}/files?path=${encodeURIComponent(path)}`,
        { headers: h },
      );
      if (!fetchGuard.isCurrent(id)) return; // stale — discard
      if (!res.ok) { if (!silent) setError(((await res.json()) as { error: string }).error); return; }
      const result = (await res.json()) as ListResult;
      if (!fetchGuard.isCurrent(id)) return; // stale — discard
      setFiles(result.files);
      setCurrentDirPath(result.dirPath);
      cacheSet(cacheKey, result);
      onExists?.(result.exists !== false);
    } catch (err) {
      if (!fetchGuard.isCurrent(id)) return;
      if (!silent) setError(String(err));
    }
    finally { if (!silent && fetchGuard.isCurrent(id)) setLoading(false); }
  }, [baseUrl, authToken, fetchGuard]);

  useEffect(() => { setSubPath(initialPath); fetchFiles(initialPath); }, [baseUrl]); // eslint-disable-line

  const prevPath = useRef<string | null>(null);
  useEffect(() => {
    if (prevPath.current === null) { prevPath.current = subPath; return; }
    if (prevPath.current !== subPath) { prevPath.current = subPath; fetchFiles(subPath); }
  }, [subPath, fetchFiles]);

  useEffect(() => {
    if (refreshKey) fetchFiles(subPath, true);
  }, [refreshKey]); // eslint-disable-line

  // Auto-refresh removed: consumers use useWatcher + refreshKey instead

  const uploadFileList = useCallback((fileList: FileList | File[]) => {
    const formData = new FormData();
    for (const f of Array.from(fileList)) formData.append('files', f);
    setUploading(true); setUploadProgress(0); setError(null);
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      setUploading(false); setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (xhr.status >= 200 && xhr.status < 300) fetchFiles(subPath);
      else {
        try { setError((JSON.parse(xhr.responseText) as { error: string }).error); }
        catch { setError(`Upload failed (${xhr.status})`); }
      }
    };
    xhr.onerror = () => { setUploading(false); setError('Upload failed — network error'); };
    xhr.open('POST', `${baseUrl}/files?path=${encodeURIComponent(subPath)}`);
    if (authToken) xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
    xhr.send(formData);
  }, [baseUrl, authToken, subPath, fetchFiles]);

  const { isDragOver, dropProps } = useDropZone(uploadFileList);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) uploadFileList(e.target.files);
  }

  async function submitCreate() {
    const name = newName.trim(); if (!name) { setCreating(null); return; }
    const endpoint = creating === 'file' ? 'new-file' : 'mkdir';
    const h: Record<string, string> = {}; if (authToken) h['Authorization'] = `Bearer ${authToken}`;
    try {
      const res = await fetch(
        `${baseUrl}/files/${endpoint}?path=${encodeURIComponent(subPath)}&name=${encodeURIComponent(name)}`,
        { method: 'POST', headers: h },
      );
      if (!res.ok) setError(((await res.json()) as { error: string }).error);
      else fetchFiles(subPath);
    } catch (err) { setError(String(err)); }
    setCreating(null);
  }

  async function deleteEntry(name: string) {
    if (confirmDelete !== name) { setConfirmDelete(name); return; }
    setConfirmDelete(null);
    const fp = subPath === '.' ? name : `${subPath}/${name}`;
    const h: Record<string, string> = {}; if (authToken) h['Authorization'] = `Bearer ${authToken}`;
    try {
      const res = await fetch(
        `${baseUrl}/files?path=${encodeURIComponent(fp)}`,
        { method: 'DELETE', headers: h },
      );
      if (!res.ok) setError(((await res.json()) as { error: string }).error);
      else setFiles((prev) => prev.filter((f) => f.name !== name));
    } catch (err) { setError(String(err)); }
  }

  function downloadFile(name: string) {
    const fp = subPath === '.' ? name : `${subPath}/${name}`;
    triggerDl(`${baseUrl}/files/download?path=${encodeURIComponent(fp)}`, name);
  }

  async function triggerDl(url: string, filename?: string) {
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || '';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  function startFileDrag(e: React.DragEvent, name: string) {
    let fp: string;
    if (workspaceDir && currentDirPath) {
      // Library mode: compute path relative to the workspace CWD
      const absFile = `${currentDirPath}/${name}`;
      fp = relativePath(workspaceDir, absFile);
    } else {
      // Workspace mode: subPath is already relative to workspace root (= CWD)
      fp = subPath === '.' ? name : `${subPath}/${name}`;
    }
    e.dataTransfer.setData('text/plain', `[file: ${fp}]`);
    e.dataTransfer.effectAllowed = 'copy';
  }

  function navigateInto(dirName: string) {
    setSubPath((p) => (p === '.' ? dirName : `${p}/${dirName}`));
  }

  function navigateUp() {
    setSubPath(computeNavigateUp(subPath, initialPath));
  }

  const { displayPath, pathParts, crumbPaths } = computeBreadcrumb(subPath, initialPath);

  return (
    <div className="fp-section-body">
      {/* Toolbar: breadcrumbs + action buttons */}
      <div className="fp-toolbar">
        <div className="fp-crumbs">
          <button
            className={`fp-crumb${displayPath === '.' ? ' fp-crumb-active' : ''}`}
            onClick={() => setSubPath(initialPath)} title="Root"
          >/</button>
          {pathParts.map((part, i) => {
            const crumbPath = crumbPaths[i];
            return (
            <Fragment key={i}>
              <span className="fp-crumb-sep">›</span>
              <button
                className={`fp-crumb${i === pathParts.length - 1 ? ' fp-crumb-active' : ''}`}
                onClick={() => setSubPath(crumbPath)}
              >{part}</button>
            </Fragment>
            );
          })}
        </div>
        <div className="fp-toolbar-btns">
          {!isReadOnly && (
          <>
          <button className="fp-btn" onClick={() => fileInputRef.current?.click()} disabled={uploading} title={t('file.upload')}>
            <IconUpload />
          </button>
          <input ref={fileInputRef} type="file" multiple onChange={handleFileChange} style={{ display: 'none' }} />
          <button className="fp-btn" onClick={() => setCreating('file')} title={t('file.newFile')}>
            <IconNewFile />
          </button>
          <button className="fp-btn" onClick={() => setCreating('folder')} title={t('file.newFolder')}>
            <IconNewFolder />
          </button>
          </>
          )}
          {showDownloadAll && !isReadOnly && (
            <button className="fp-btn" onClick={() => triggerDl(`${baseUrl}/files/zip`)} title={t('file.downloadAll')}>
              <IconDownload />
            </button>
          )}
          <button className="fp-btn" onClick={() => fetchFiles(subPath)} disabled={loading} title={t('file.refresh')}>
            <IconRefresh />
          </button>
        </div>
      </div>

      {/* Inline create input */}
      {creating && (
        <div className="fp-new-row">
          <span className="fp-new-icon">
            {creating === 'file' ? <IconFile /> : <IconFolder />}
          </span>
          <input
            ref={newNameRef} className="fp-new-input" value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitCreate(); if (e.key === 'Escape') setCreating(null); }}
            placeholder={creating === 'file' ? 'filename.txt' : 'folder-name'}
          />
          <button className="fp-new-ok" onClick={submitCreate} title={t('file.create')}>✓</button>
          <button className="fp-new-cancel" onClick={() => setCreating(null)} title={t('fv.cancel')}>✗</button>
        </div>
      )}

      {/* Upload progress */}
      {uploading && (
        <div className="fp-progress">
          <div className="fp-progress-bar" style={{ width: `${uploadProgress}%` }} />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="fp-error">
          <span>{error}</span>
          <button className="fp-error-close" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* File list — also a drop zone for external files */}
      <div className="fp-list-wrap" {...dropProps}>
        {isDragOver && (
          <div className="fp-drop-overlay">
            <span className="fp-drop-label">{dropLabel}</span>
          </div>
        )}
        <div className="fp-list">
          {loading && <div className="fp-empty">{t('file.loading')}</div>}

          {/* Up directory */}
          {!loading && subPath !== initialPath && subPath !== '.' && (
            <div className="fp-entry fp-entry-dir fp-entry-up" onClick={navigateUp}>
              <span className="fp-dir-up-icon">↩</span>
              <span className="fp-name">..</span>
            </div>
          )}

          {/* Entries */}
          {!loading && files.map((f) => {
            const isNbDir = f.type === 'directory' && f.isNotebook;
            const isNbFile = f.name.endsWith('.notebook.json');
            // Strip task- prefix and .notebook.json suffix for notebook display names
            const displayName = (isNbDir || isNbFile)
              ? f.name.replace('.notebook.json', '').replace(/^task-/, '')
              : f.name;
            return f.type === 'directory' ? (
            <div key={f.name} className="fp-entry fp-entry-dir" data-tooltip={f.name} onClick={async () => {
              const meta = { isNotebook: isNbDir || undefined, worktreePath: f.worktreePath };
              if (onDirClick) {
                const result = await onDirClick(subPath, f.name, meta);
                if (result === true) return;
              }
              navigateInto(f.worktreePath || f.name);
            }}>
              {isNbDir ? <FileIcon name={`${f.name}.notebook.json`} /> : <IconFolder />}
              <span className="fp-name">{displayName}</span>
              {isNbDir && <TypeBadge name={`${f.name}.notebook.json`} />}
              {renderItemActions?.(f, subPath) ?? (
                !isReadOnly && !noDeleteFilter?.(f.name, subPath) && (
                <div className="fp-actions" onClick={(e) => e.stopPropagation()}>
                  {confirmDelete === f.name ? (
                    <span className="fp-confirm">
                      <button className="fp-confirm-ok" onClick={() => deleteEntry(f.name)}>del?</button>
                      <button className="fp-confirm-cancel" onClick={() => setConfirmDelete(null)}>✗</button>
                    </span>
                  ) : (
                    <button className="fp-action" onClick={() => deleteEntry(f.name)} title={t('file.delete')}>✕</button>
                  )}
                </div>
                )
              )}
            </div>
          ) : (
            <div
              key={f.name}
              className={`fp-entry${!noDragFilter?.(f.name) ? ' fp-entry-draggable' : ''}`}
              data-tooltip={f.name}
              draggable={!noDragFilter?.(f.name)}
              onDragStart={!noDragFilter?.(f.name) ? (e) => startFileDrag(e, f.name) : undefined}
              onClick={() => onFileClick?.(subPath, f.name)}
              style={{ cursor: onFileClick ? 'pointer' : undefined }}
            >
              <span className="fp-name">{displayName}</span>
              <FileIcon name={f.name} />
              {renderItemActions?.(f, subPath) ?? (
              <div className="fp-actions">
                {isReadOnly ? null : confirmDelete === f.name ? (
                  <span className="fp-confirm">
                    <button className="fp-confirm-ok" onClick={() => deleteEntry(f.name)}>del?</button>
                    <button className="fp-confirm-cancel" onClick={() => setConfirmDelete(null)}>✗</button>
                  </span>
                ) : (
                  <>
                    {!isReadOnly && <button className="fp-action" onClick={() => downloadFile(f.name)} title={t('file.download')}>↓</button>}
                    {!isReadOnly && !noDeleteFilter?.(f.name, subPath) && f.name !== 'MEMORY.md' && (
                      <button className="fp-action" onClick={() => deleteEntry(f.name)} title={t('file.delete')}>✕</button>
                    )}
                  </>
                )}
              </div>
              )}
            </div>
          )})}

          {!loading && files.length === 0 && !error && (
            <div className="fp-empty">{t('file.dropEmpty')}</div>
          )}
        </div>
      </div>
    </div>
  );
}

