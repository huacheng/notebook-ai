import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { useFileStream } from '../hooks/useFileStream';
import { useAnnotationPersistence } from '../hooks/useAnnotationPersistence';
import type { FileAnnotations } from '../types/fileAnnotations';
import { EMPTY_FILE_ANNOTATIONS } from '../types/fileAnnotations';
import { FileViewerStatusBar } from './FileViewerStatusBar';
import { FileViewerRender } from './FileViewerRender';
import { FileViewerEditor } from './FileViewerEditor';

export function FileViewer() {
  const openFiles = useStore((s) => s.openFiles);
  const activeFileTabId = useStore((s) => s.activeFileTabId);
  const activeFile = activeFileTabId ? openFiles[activeFileTabId] ?? null : null;
  const fileViewerMaximized = useStore((s) => s.fileViewerMaximized);
  const closeFileTab = useStore((s) => s.closeFileTab);
  const toggleFileViewerMaximized = useStore((s) => s.toggleFileViewerMaximized);
  const setFileTabLoading = useStore((s) => s.setFileTabLoading);
  const activeNotebookId = useStore((s) => s.activeNotebookId);
  const submitPrompt = useStore((s) => s.submitPrompt);

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

  if (!activeFile) return null;

  const filename = activeFile.path.split('/').pop() ?? activeFile.path;
  const canEdit = fileState.format !== null && !fileState.format.endsWith('-binary') && fileState.format !== 'unsupported';
  const isPdf = fileState.format === 'pdf-binary';
  const isText = fileState.format === 'text';
  const showZoom = isPdf || isText;

  return (
    <div className="file-viewer">
      <FileViewerStatusBar
        filename={filename}
        format={fileState.format}
        mode={mode}
        maximized={fileViewerMaximized}
        onToggleMode={() => { if (canEdit) setMode((m) => m === 'render' ? 'edit' : 'render'); }}
        onToggleMaximize={toggleFileViewerMaximized}
        onClose={() => closeFileTab(activeFileTabId!)}
        pdfPage={isPdf ? pdfPage : undefined}
        pdfPages={isPdf ? pdfPages : undefined}
        scale={showZoom ? contentScale : undefined}
        onZoomIn={showZoom ? handleZoomIn : undefined}
        onZoomOut={showZoom ? handleZoomOut : undefined}
      />
      {(fileState.status === 'loading' || fileState.status === 'converting') && (
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
      {fileState.status === 'complete' && mode === 'render' && (
        <FileViewerRender
          format={fileState.format!}
          content={fileState.content}
          binaryBuffer={fileState.binaryBuffer}
          filename={filename}
          annotations={annotations}
          filePath={activeFile.path}
          onAnnotationsChange={setAnnotations}
          onSendToPrompt={submitPrompt}
          pdfScale={contentScale}
          onPdfPagesLoaded={setPdfPages}
          onPdfVisiblePage={setPdfPage}
        />
      )}
      {fileState.status === 'complete' && mode === 'edit' && canEdit && (
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
