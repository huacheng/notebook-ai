import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { useFileStream } from '../hooks/useFileStream';
import { useAnnotationPersistence } from '../hooks/useAnnotationPersistence';
import type { FileAnnotations } from '../types/fileAnnotations';
import { EMPTY_FILE_ANNOTATIONS, resolveAbsolutePath, canEditFile } from '../types/fileAnnotations';
import { FileViewerStatusBar } from './FileViewerStatusBar';
import { FileViewerRender } from './FileViewerRender';
import { FileViewerEditor } from './FileViewerEditor';

export function FileViewer() {
  const openFiles = useStore((s) => s.openFiles);
  const activeFileTabId = useStore((s) => s.activeFileTabId);
  const activeFile = activeFileTabId ? openFiles[activeFileTabId] ?? null : null;
  const closeFileTab = useStore((s) => s.closeFileTab);
  const setFileTabLoading = useStore((s) => s.setFileTabLoading);
  const activeNotebookId = useStore((s) => s.activeNotebookId);
  /** Send annotation text to the prompt textarea (nb:appendPrompt) instead of executing directly. */
  const appendToPrompt = useCallback((text: string) => {
    window.dispatchEvent(new CustomEvent('nb:appendPrompt', { detail: { text } }));
  }, []);
  const workspaceDir = useStore((s) => s.workspaceDir);
  const activeProjectPath = useStore((s) => s.activeProjectPath);

  const [mode, setMode] = useState<'render' | 'edit'>('render');
  const [annotations, setAnnotations] = useState<FileAnnotations>(EMPTY_FILE_ANNOTATIONS);
  const annLoadedRef = useRef(false);

  // Zoom controls: page tracking (PDF) + scale (PDF & text)
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfPages, setPdfPages] = useState(0);
  const [contentScale, setContentScale] = useState(1.0);

  const fileState = useFileStream(
    activeFile?.sessionId ?? null,
    activeNotebookId,
    activeFile?.path ?? null,
    activeFile?.source ?? 'workspace',
    activeFile?.projectId ?? null,
    mode === 'edit', // suppressChanges: ignore file-changed notifications while editing
  );

  const effectiveAnnSessionId = activeFile?.sessionId
    || (activeFile?.projectId ? `__project_${activeFile.projectId}__` : '');
  useAnnotationPersistence({
    sessionId: effectiveAnnSessionId,
    notebookId: activeNotebookId ?? '',
    filePath: activeFile?.path ?? '',
    annotations,
    annLoadedRef,
    setAnnotations,
  });

  // Sync loading state to store so tabs can show spinner
  useEffect(() => {
    if (!activeFileTabId) return;
    const isLoading = fileState.status === 'loading' || fileState.status === 'converting';
    setFileTabLoading(activeFileTabId, isLoading);
  }, [activeFileTabId, fileState.status, setFileTabLoading]);

  // Auto-close with alert when file format is unsupported
  useEffect(() => {
    if (fileState.status === 'complete' && fileState.format === 'unsupported' && activeFile && activeFileTabId) {
      const name = activeFile.path.split('/').pop() ?? activeFile.path;
      alert(`不支持预览此文件格式: ${name}`);
      closeFileTab(activeFileTabId);
    }
  }, [fileState.status, fileState.format, activeFile, activeFileTabId, closeFileTab]);

  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 3.0;
  const ZOOM_STEP = 0.25;
  const clampScale = useCallback((s: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(s * 100) / 100)), []);
  const handleZoomIn = useCallback(() => setContentScale((s) => clampScale(s + ZOOM_STEP)), [clampScale]);
  const handleZoomOut = useCallback(() => setContentScale((s) => clampScale(s - ZOOM_STEP)), [clampScale]);

  if (!activeFile) {
    return (
      <div className="file-viewer file-viewer--empty">
        <div className="fv-empty-state">
          <span className="fv-empty-icon">📄</span>
          <p className="fv-empty-text">No file open</p>
          <p className="fv-empty-hint">Click a file in the sidebar to view it here</p>
        </div>
      </div>
    );
  }

  const filename = activeFile.path.split('/').pop() ?? activeFile.path;
  const absolutePath = resolveAbsolutePath(
    activeFile.source, activeFile.path, workspaceDir, activeProjectPath,
  );
  const canEdit = canEditFile(fileState.format, absolutePath);
  const isPdf = fileState.format === 'pdf-binary';
  const isText = fileState.format === 'text';
  const showZoom = isPdf || isText;

  return (
    <div className="file-viewer">
      <FileViewerStatusBar
        filename={filename}
        format={fileState.format}
        mode={mode}
        onToggleMode={() => { if (canEdit) setMode((m) => m === 'render' ? 'edit' : 'render'); }}
        onClose={() => closeFileTab(activeFileTabId!)}
        pdfPage={isPdf ? pdfPage : undefined}
        pdfPages={isPdf ? pdfPages : undefined}
        scale={showZoom ? contentScale : undefined}
        onZoomIn={showZoom ? handleZoomIn : undefined}
        onZoomOut={showZoom ? handleZoomOut : undefined}
      />
      {(fileState.status === 'loading' || fileState.status === 'converting') && !fileState.content && (
        <div className="fv-loading">
          <div className="fv-loading-bar" />
          <div className="fv-loading-body">
            <div className="fv-loading-spinner" />
            <p className="fv-loading-text">
              {fileState.status === 'converting' ? 'Converting document…' : 'Loading…'}
            </p>
          </div>
        </div>
      )}
      {fileState.status === 'error' && <div className="fv-error">Error: {fileState.error}</div>}
      {(fileState.status === 'complete' || (fileState.status === 'loading' && fileState.content && fileState.format)) && mode === 'render' && (
        <FileViewerRender
          format={fileState.format!}
          content={fileState.content}
          binaryBuffer={fileState.binaryBuffer}
          filename={filename}
          annotations={annotations}
          filePath={activeFile.path}
          onAnnotationsChange={setAnnotations}
          onSendToPrompt={appendToPrompt}
          absolutePath={absolutePath}
          pdfScale={contentScale}
          onPdfPagesLoaded={setPdfPages}
          onPdfVisiblePage={setPdfPage}
        />
      )}
      {/* Keep editor mounted during loading to prevent content loss from self-triggered file updates */}
      {(fileState.status === 'complete' || (mode === 'edit' && fileState.status === 'loading')) && mode === 'edit' && canEdit && (
        <FileViewerEditor
          content={fileState.content}
          format={fileState.format === 'html' ? 'html' : 'text'}
          sessionId={activeFile.sessionId}
          filePath={activeFile.path}
          source={activeFile.source}
          projectId={activeFile.projectId}
        />
      )}
    </div>
  );
}
