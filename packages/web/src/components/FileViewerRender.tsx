import { useState, useRef, useCallback, useEffect, useMemo, Fragment } from 'react';
import ReactMarkdown from 'react-markdown';
import DOMPurify from 'dompurify';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { renderAsync } from 'docx-preview';
import * as XLSX from 'xlsx';
import type { FileFormat } from '../hooks/useFileStream';
import type { FileAnnotations, FileAnnotation } from '../types/fileAnnotations';
import { uid, buildAnnotationText } from '../types/fileAnnotations';
import { FileSelectionFloat } from './FileSelectionFloat';
import { FileAnnotationCard } from './FileAnnotationCard';
import { FileAnnotationDropdown } from './FileAnnotationDropdown';
import type { HighlightsMap } from '../utils/annotationHighlight';
import {
  captureSelectionRects,
  addHighlight,
  removeHighlight,
  formatTagLabel,
  computeScrollTarget,
  computeMarginAnchor,
  scaleHighlightCoordsWithOffset,
  computeZoomScrollTop,
  rebuildHighlightsFromAnnotations,
} from '../utils/annotationHighlight';

import { isJsonFile, formatJsonContent } from '../utils/jsonFormat';

// Set PDF.js worker — served from public/ to avoid pnpm symlink issues
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

// ── Lazy PDF Page — only renders when near viewport ───────────────────────
const PAGE_PLACEHOLDER_HEIGHT = 842; // A4 height in px (approx)

function LazyPage({ pageNumber, scale, onVisible }: { pageNumber: number; scale: number; onVisible?: (n: number, vis: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  // Lazy load: start rendering once near viewport
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setLoaded(true); observer.disconnect(); } },
      { rootMargin: '2500px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Track which page is currently visible for page indicator
  useEffect(() => {
    if (!loaded || !onVisible) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => onVisible(pageNumber, entry.isIntersecting),
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loaded, pageNumber, onVisible]);

  return (
    <div ref={ref} style={loaded ? undefined : { minHeight: PAGE_PLACEHOLDER_HEIGHT * scale }}>
      {loaded && <Page pageNumber={pageNumber} scale={scale} renderTextLayer={true} renderAnnotationLayer={false} />}
    </div>
  );
}

// ── DOCX Renderer ─────────────────────────────────────────────────────────
function DocxRenderer({ buffer }: { buffer: Uint8Array }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '';
    renderAsync(buffer.buffer, ref.current, undefined, { className: 'fv-docx', inWrapper: true });
  }, [buffer]);
  return <div ref={ref} className="fv-render__docx-container" />;
}

// ── XLSX Renderer ─────────────────────────────────────────────────────────
function XlsxRenderer({ buffer }: { buffer: Uint8Array }) {
  const [sheets, setSheets] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [html, setHtml] = useState('');

  useEffect(() => {
    const wb = XLSX.read(buffer, { type: 'array' });
    setSheets(wb.SheetNames);
    if (wb.SheetNames.length > 0) {
      setActiveSheet(0);
      setHtml(XLSX.utils.sheet_to_html(wb.Sheets[wb.SheetNames[0]]));
    }
  }, [buffer]);

  useEffect(() => {
    if (sheets.length === 0) return;
    const wb = XLSX.read(buffer, { type: 'array' });
    setHtml(XLSX.utils.sheet_to_html(wb.Sheets[sheets[activeSheet]]));
  }, [activeSheet, sheets, buffer]);

  return (
    <div className="fv-render__xlsx">
      {sheets.length > 1 && (
        <div className="fv-render__xlsx-tabs">
          {sheets.map((name, i) => (
            <button key={name} className={i === activeSheet ? 'active' : ''} onClick={() => setActiveSheet(i)}>
              {name}
            </button>
          ))}
        </div>
      )}
      <div className="fv-render__xlsx-content" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

// ── PPTX Placeholder ──────────────────────────────────────────────────────
function PptxPlaceholder({ buffer, filename }: { buffer: Uint8Array; filename: string }) {
  const handleDownload = useCallback(() => {
    const blob = new Blob([buffer.slice().buffer], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [buffer, filename]);

  return (
    <div className="fv-render__pptx-placeholder">
      <p>PPTX preview is not available in the browser.</p>
      <button onClick={handleDownload}>Download {filename}</button>
    </div>
  );
}

// ── Edit Float — in-place editing near selected text ─────────────────────
function AnnotationEditFloat({ x, y, initialContent, onSave, onCancel }: {
  x: number; y: number; initialContent?: string;
  onSave: (content: string) => void; onCancel: () => void;
}) {
  const [text, setText] = useState(initialContent ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => ref.current?.focus({ preventScroll: false }));
  }, []);

  return (
    <div className="fv-edit-float" style={{ top: y, left: x }}>
      <textarea
        ref={ref}
        className="fv-edit-float__textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSave(text); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        rows={3}
        placeholder="Enter content… (Ctrl+Enter to save, Esc to cancel)"
      />
      <div className="fv-edit-float__actions">
        <button className="fv-edit-float__btn" onMouseDown={(e) => { e.preventDefault(); onSave(text); }}>Save</button>
        <button className="fv-edit-float__btn fv-edit-float__btn--cancel" onMouseDown={(e) => { e.preventDefault(); onCancel(); }}>Cancel</button>
      </div>
    </div>
  );
}

interface FileViewerRenderProps {
  format: FileFormat;
  content: string;
  binaryBuffer: Uint8Array | null;
  filename: string;
  annotations: FileAnnotations;
  filePath: string;
  onAnnotationsChange: (a: FileAnnotations) => void;
  onSendToPrompt: (text: string) => void;
  pdfScale?: number;
  onPdfPagesLoaded?: (n: number) => void;
  onPdfVisiblePage?: (n: number) => void;
}

export function FileViewerRender({
  format, content, binaryBuffer, filename, annotations, filePath, onAnnotationsChange, onSendToPrompt,
  pdfScale = 1.0, onPdfPagesLoaded, onPdfVisiblePage,
}: FileViewerRenderProps) {
  const [float, setFloat] = useState<{ x: number; y: number; selectionBottom: number; text: string; rects: { x: number; y: number; width: number; height: number }[] } | null>(null);
  const [editFloat, setEditFloat] = useState<{ x: number; y: number; annotationId: string; isNew: boolean } | null>(null);
  const [highlights, setHighlights] = useState<HighlightsMap>({});
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const [pdfPages, setPdfPages] = useState(0);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const visiblePagesRef = useRef(new Set<number>());

  // Container padding — fixed offset that doesn't participate in PDF scaling
  const PADDING_X = 24;
  const PADDING_Y = 20;

  // Helper: scale a highlight's coords with padding offset excluded
  const scaleHl = useCallback((hl: HighlightsMap[string]) => {
    const ratio = pdfScale / (hl.capturedScale || 1);
    return scaleHighlightCoordsWithOffset(hl, ratio, PADDING_X, PADDING_Y);
  }, [pdfScale]);

  // Zoom scroll adjustment — keep content position stable when scale changes
  const prevScaleRef = useRef(pdfScale);

  useEffect(() => {
    const oldScale = prevScaleRef.current;
    prevScaleRef.current = pdfScale;
    if (oldScale === pdfScale) return;
    const container = containerRef.current;
    if (!container) return;
    const newScrollTop = computeZoomScrollTop(container.scrollTop, oldScale, pdfScale, PADDING_Y);
    container.scrollTop = newScrollTop;
  }, [pdfScale]);

  // Restore highlights from persisted annotation data (after file re-open)
  useEffect(() => {
    const missing = annotations.items.filter(
      a => a.highlightRects && a.highlightRects.length > 0 && !highlights[a.id]
    );
    if (missing.length === 0) return;
    setHighlights(prev => {
      const rebuilt = rebuildHighlightsFromAnnotations(missing);
      return { ...prev, ...rebuilt };
    });
  }, [annotations]); // deliberately omit highlights — one-shot restore

  const handlePageVisible = useCallback((pageNum: number, isVisible: boolean) => {
    const set = visiblePagesRef.current;
    if (isVisible) set.add(pageNum);
    else set.delete(pageNum);
    if (set.size > 0 && onPdfVisiblePage) {
      onPdfVisiblePage(Math.min(...set));
    }
  }, [onPdfVisiblePage]);
  const isMd = filename.endsWith('.md');
  const isJson = isJsonFile(filename);

  // Copy buffer for PDF.js — postMessage transfers ArrayBuffer ownership,
  // so we must give it a fresh copy each time to avoid "detached" errors on re-render.
  const pdfFile = useMemo(() => {
    if (format !== 'pdf-binary' || !binaryBuffer) return null;
    return { data: binaryBuffer.slice().buffer };
  }, [format, binaryBuffer]);

  useEffect(() => {
    setPdfPages(0);
    setPdfError(null);
  }, [binaryBuffer]);

  const addAnnotation = useCallback((type: FileAnnotation['type'], selectedText: string, defaultContent?: string) => {
    const id = uid();
    const ann: FileAnnotation = {
      id,
      type,
      file_path: filePath,
      selected_text: selectedText.slice(0, 80),
      content: defaultContent,
      author: 'user',
      timestamp: new Date().toISOString(),
      updatedAt: Date.now(),
      highlightRects: float?.rects,
      capturedScale: pdfScale,
    };
    onAnnotationsChange({ items: [...annotations.items, ann], updatedAt: Date.now() });
    // Persist selection rects as highlight (record current scale for proportional re-scaling).
    if (float?.rects && float.rects.length > 0) {
      setHighlights(prev => addHighlight(prev, id, float.rects, type, pdfScale));
    }
    // Transition: selection float → edit float (at same position) for non-delete types
    if (type !== 'delete') {
      setEditFloat({ x: float!.x, y: float!.selectionBottom, annotationId: id, isNew: true });
    }
    setFloat(null);
  }, [annotations, filePath, onAnnotationsChange, float, pdfScale]);

  const removeAnnotation = useCallback((id: string) => {
    onAnnotationsChange({ items: annotations.items.filter((a) => a.id !== id), updatedAt: Date.now() });
    setHighlights(prev => removeHighlight(prev, id));
    if (activeHighlightId === id) setActiveHighlightId(null);
  }, [annotations, onAnnotationsChange, activeHighlightId]);

  const editAnnotation = useCallback((id: string, newContent: string) => {
    onAnnotationsChange({
      items: annotations.items.map((a) => a.id === id ? { ...a, content: newContent, updatedAt: Date.now() } : a),
      updatedAt: Date.now(),
    });
  }, [annotations, onAnnotationsChange]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { setFloat(null); return; }
    const text = sel.toString().trim();
    if (!text) { setFloat(null); return; }
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const range = sel.getRangeAt(0);
    const rangeRect = range.getBoundingClientRect();
    const scrollTop = container.scrollTop;
    const scrollLeft = container.scrollLeft;
    const rects = captureSelectionRects(
      Array.from(range.getClientRects()),
      containerRect,
      scrollTop,
      scrollLeft,
    );
    setFloat({
      x: e.clientX - containerRect.left + scrollLeft,
      y: e.clientY - containerRect.top + scrollTop - 40,
      selectionBottom: rangeRect.bottom - containerRect.top + scrollTop + 8,
      text,
      rects,
    });
  }, []);

  const handleSendSingle = useCallback((id: string) => {
    const ann = annotations.items.find((a) => a.id === id);
    if (ann) {
      onSendToPrompt(`[File annotation: ${ann.type}] "${ann.selected_text}"${ann.content ? ` → ${ann.content}` : ''}`);
    }
  }, [annotations, onSendToPrompt]);

  const handleSendAll = useCallback(() => {
    onSendToPrompt(buildAnnotationText(annotations));
  }, [annotations, onSendToPrompt]);

  const handleCancelAll = useCallback(() => {
    onAnnotationsChange({ items: [], updatedAt: Date.now() });
    setHighlights({});
    setEditFloat(null);
    setFloat(null);
    setActiveHighlightId(null);
  }, [onAnnotationsChange]);

  const handleHighlightClick = useCallback((annId: string) => {
    const ann = annotations.items.find(a => a.id === annId);
    if (!ann) return;
    const hl = highlights[annId];
    if (!hl) return;
    const container = containerRef.current;
    const containerW = container?.clientWidth ?? 600;
    const scaled = scaleHl(hl);
    setActiveHighlightId(annId);
    setEditFloat({ x: Math.max(containerW - 320, 0), y: computeMarginAnchor(scaled.rects) + 10, annotationId: annId, isNew: false });
  }, [annotations, highlights, scaleHl]);

  const handleScrollTo = useCallback((annId: string) => {
    const container = containerRef.current;
    if (!container) return;
    const hl = highlights[annId];
    if (!hl) return;
    const scaled = scaleHl(hl);
    const scaledMap: HighlightsMap = { [annId]: { ...hl, rects: scaled.rects, bottomY: scaled.bottomY } };
    const target = computeScrollTarget(scaledMap, annId, container.clientHeight);
    if (target !== null) {
      container.scrollTo({ top: target, behavior: 'smooth' });
      setActiveHighlightId(annId);
      setTimeout(() => setActiveHighlightId(null), 2000);
    }
  }, [highlights, scaleHl]);

  return (
    <div ref={containerRef} className="fv-render" onMouseUp={handleMouseUp}>
      {/* Annotation dropdown — top-right corner */}
      <div className="fv-render__ann-overlay">
        <FileAnnotationDropdown
          annotations={annotations}
          onSendAll={handleSendAll}
          onSendSingle={handleSendSingle}
          onRemove={removeAnnotation}
          onCancelAll={handleCancelAll}
          onScrollTo={handleScrollTo}
        />
      </div>

      {/* Highlight overlays + margin tags with connecting lines */}
      {Object.entries(highlights).map(([annId, hl]) => {
        const ann = annotations.items.find(a => a.id === annId);
        if (!ann) return null;
        const isActive = activeHighlightId === annId;
        // Scale rects proportionally when zoom changes
        const scaled = scaleHl(hl);
        const anchorY = computeMarginAnchor(scaled.rects);
        const rightX = Math.max(...scaled.rects.map(r => r.x + r.width));
        // Hide connecting line when highlight edge is too close to / past the tag
        const cw = containerRef.current?.clientWidth ?? 800;
        const tagRightPx = 8; // matches .fv-ann-tag { right: 8px }
        const showLine = rightX < cw - tagRightPx - 4;
        return (
          <Fragment key={annId}>
            {scaled.rects.map((r, i) => (
              <div
                key={i}
                className={`fv-ann-hl fv-ann-hl--${hl.type}${isActive ? ' fv-ann-hl--active' : ''}`}
                style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
              />
            ))}
            {/* SVG connecting line from highlight to margin tag */}
            {showLine && (
              <svg className="fv-ann-line" style={{ top: anchorY - 2, left: rightX }}>
                <line x1="0" y1="4" x2="100%" y2="4" className={`fv-ann-line__stroke fv-ann-line__stroke--${hl.type}`} />
              </svg>
            )}
            <div
              className={`fv-ann-tag fv-ann-tag--${hl.type}${isActive ? ' fv-ann-tag--active' : ''}`}
              style={{ top: anchorY }}
              onClick={() => handleHighlightClick(annId)}
            >
              {formatTagLabel(hl.type, ann.content)}
              <span
                className="fv-ann-tag__delete"
                onClick={(e) => { e.stopPropagation(); removeAnnotation(annId); }}
                title="删除批注"
              >×</span>
            </div>
          </Fragment>
        );
      })}

      {/* Selection float */}
      {float && (
        <FileSelectionFloat
          x={float.x}
          y={float.y}
          onDelete={() => addAnnotation('delete', float.text)}
          onReplace={() => addAnnotation('replace', float.text, '(replacement)')}
          onComment={() => addAnnotation('comment', float.text, '(comment)')}
          onInsertAfter={() => addAnnotation('insert', float.text, '(insert content)')}
        />
      )}

      {/* File content */}
      {format === 'text' && (
        <div
          className="fv-render__text-zoom-wrapper"
          style={{
            zoom: pdfScale,
            width: `${100 / pdfScale}%`,
          }}
        >
          {isMd && (
            <div className="fv-render__markdown">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          )}
          {!isMd && isJson && (
            <pre className="fv-render__json">{formatJsonContent(content)}</pre>
          )}
          {!isMd && !isJson && (
            <pre className="fv-render__text">{content}</pre>
          )}
        </div>
      )}
      {format === 'html' && (
        <div
          className="fv-render__html"
          dangerouslySetInnerHTML={{ __html: String(DOMPurify.sanitize(content)) }}
        />
      )}
      {format === 'unsupported' && (
        <div className="fv-render__unsupported">
          <p>This file format is not supported for preview.</p>
        </div>
      )}
      {format === 'pdf-binary' && pdfFile && (
        <div className="fv-render__pdf-wrapper" style={{ '--pdf-page-gap': `${12 * pdfScale}px` } as React.CSSProperties}>
          {pdfError && <div className="fv-render__pdf-error">Failed to load PDF: {pdfError}</div>}
          <Document
            file={pdfFile}
            onLoadSuccess={(pdf: { numPages: number }) => { setPdfPages(pdf.numPages); onPdfPagesLoaded?.(pdf.numPages); }}
            onLoadError={(err: Error) => setPdfError(err.message)}
            loading={<div className="fv-render__pdf-loading">Loading PDF…</div>}
            className="fv-render__pdf"
          >
            {Array.from({ length: pdfPages }, (_, i) => (
              <LazyPage key={i + 1} pageNumber={i + 1} scale={pdfScale} onVisible={handlePageVisible} />
            ))}
          </Document>
        </div>
      )}
      {format === 'docx-binary' && binaryBuffer && <DocxRenderer buffer={binaryBuffer} />}
      {format === 'xlsx-binary' && binaryBuffer && <XlsxRenderer buffer={binaryBuffer} />}
      {format === 'pptx-binary' && binaryBuffer && <PptxPlaceholder buffer={binaryBuffer} filename={filename} />}

      {/* Edit float — in-place editing near selected text */}
      {editFloat && (
        <AnnotationEditFloat
          key={editFloat.annotationId}
          x={editFloat.x}
          y={editFloat.y}
          initialContent={editFloat.isNew ? '' : (annotations.items.find(a => a.id === editFloat.annotationId)?.content ?? '')}
          onSave={(content) => {
            const trimmed = content.trim();
            if (trimmed) editAnnotation(editFloat.annotationId, trimmed);
            else removeAnnotation(editFloat.annotationId);
            setEditFloat(null);
            setActiveHighlightId(null);
          }}
          onCancel={() => {
            if (editFloat.isNew) removeAnnotation(editFloat.annotationId);
            setEditFloat(null);
            setActiveHighlightId(null);
          }}
        />
      )}

      {/* Inline annotation cards */}
      {annotations.items.length > 0 && (
        <div className="fv-render__ann-cards">
          {annotations.items.map((a) => (
            <FileAnnotationCard
              key={a.id}
              annotation={a}
              onEdit={editAnnotation}
              onRemove={removeAnnotation}
              onSend={handleSendSingle}
            />
          ))}
        </div>
      )}
    </div>
  );
}
