import { useState, useRef, useCallback, useEffect, useMemo, Fragment } from 'react';
import { useT } from '../i18n';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import DOMPurify from 'dompurify';
import { useMermaidRender } from '../hooks/useMermaidRender';
import { extractHeadings, headingComponents, MarkdownToc } from './MarkdownToc';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { renderAsync } from 'docx-preview';
import * as XLSX from 'xlsx';
import type { FileFormat } from '../hooks/useFileStream';
import type { FileAnnotations, FileAnnotation } from '../types/fileAnnotations';
import { uid, buildSendPayload, collectAnnotationIds, filterSendable, applyEdit, computeSourceCursor, truncateSelectedText, truncateAnnotationContent } from '../types/fileAnnotations';
import { FileSelectionFloat } from './FileSelectionFloat';
import { FileAnnotationCard } from './FileAnnotationCard';
import { FileAnnotationDropdown } from './FileAnnotationDropdown';
import type { HighlightsMap } from '../utils/annotationHighlight';
import {
  captureSelectionRects,
  addHighlight,
  removeHighlight,
  rekeyHighlight,
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
    const el = ref.current;
    el.innerHTML = '';
    // D2: render into a detached element to prevent XSS from inline event handlers
    // (e.g. <img onerror="...">) firing before sanitization
    const detached = document.createElement('div');
    renderAsync(buffer.buffer, detached, undefined, { className: 'fv-docx', inWrapper: true })
      .then(() => {
        el.innerHTML = DOMPurify.sanitize(detached.innerHTML);
      })
      .catch(() => { /* renderAsync failure — leave empty */ });
  }, [buffer]);
  return <div ref={ref} className="fv-render__docx-container" />;
}

// ── XLSX Renderer ─────────────────────────────────────────────────────────
function XlsxRenderer({ buffer }: { buffer: Uint8Array }) {
  const [sheets, setSheets] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [html, setHtml] = useState('');
  // D4: cache workbook in ref to avoid redundant XLSX.read on sheet switch
  const wbRef = useRef<ReturnType<typeof XLSX.read> | null>(null);

  useEffect(() => {
    const wb = XLSX.read(buffer, { type: 'array' });
    wbRef.current = wb;
    setSheets(wb.SheetNames);
    if (wb.SheetNames.length > 0) {
      setActiveSheet(0);
      setHtml(XLSX.utils.sheet_to_html(wb.Sheets[wb.SheetNames[0]]));
    }
  }, [buffer]);

  useEffect(() => {
    if (sheets.length === 0 || !wbRef.current) return;
    setHtml(XLSX.utils.sheet_to_html(wbRef.current.Sheets[sheets[activeSheet]]));
  }, [activeSheet, sheets]);

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
      <div className="fv-render__xlsx-content" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
    </div>
  );
}

// ── PPTX Placeholder ──────────────────────────────────────────────────────
function PptxPlaceholder({ buffer, filename }: { buffer: Uint8Array; filename: string }) {
  const t = useT();
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
      <p>{t('fv.pptxPreview')}</p>
      <button onClick={handleDownload}>{t('fv.downloadFile', filename)}</button>
    </div>
  );
}

// ── Image Renderer ───────────────────────────────────────────────────────
function ImageRenderer({ buffer, filename }: { buffer: Uint8Array; filename: string }) {
  const objectUrl = useMemo(() => {
    const ext = filename.split('.').pop()?.toLowerCase() ?? 'png';
    const mime = ext === 'svg' ? 'image/svg+xml'
      : ext === 'gif' ? 'image/gif'
      : ext === 'webp' ? 'image/webp'
      : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : 'image/png';
    // D2: sanitize SVG to prevent XSS via embedded scripts/event handlers
    if (ext === 'svg') {
      const raw = new TextDecoder().decode(buffer);
      const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true } });
      return URL.createObjectURL(new Blob([clean], { type: mime }));
    }
    return URL.createObjectURL(new Blob([buffer.slice().buffer], { type: mime }));
  }, [buffer, filename]);

  useEffect(() => () => URL.revokeObjectURL(objectUrl), [objectUrl]);

  return (
    <div className="fv-render__image">
      <img src={objectUrl} alt={filename} style={{ maxWidth: '100%', display: 'block' }} />
    </div>
  );
}

// ── Edit Float — in-place editing near selected text ─────────────────────
function AnnotationEditFloat({ x, y, initialContent, onSave, onCancel }: {
  x: number; y: number; initialContent?: string;
  onSave: (content: string) => void; onCancel: () => void;
}) {
  const t = useT();
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
        placeholder={t('fv.editPlaceholder')}
      />
      <div className="fv-edit-float__actions">
        <button className="fv-edit-float__btn" onMouseDown={(e) => { e.preventDefault(); onSave(text); }}>{t('fv.save')}</button>
        <button className="fv-edit-float__btn fv-edit-float__btn--cancel" onMouseDown={(e) => { e.preventDefault(); onCancel(); }}>{t('fv.cancel')}</button>
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
  absolutePath: string;
  pdfScale?: number;
  onPdfPagesLoaded?: (n: number) => void;
  onPdfVisiblePage?: (n: number) => void;
}

export function FileViewerRender({
  format, content, binaryBuffer, filename, annotations, filePath, onAnnotationsChange, onSendToPrompt, absolutePath,
  pdfScale = 1.0, onPdfPagesLoaded, onPdfVisiblePage,
}: FileViewerRenderProps) {
  const t = useT();
  const [float, setFloat] = useState<{ x: number; y: number; selectionBottom: number; text: string; rects: { x: number; y: number; width: number; height: number }[]; renderedOffset: number; renderedTextLen: number } | null>(null);
  const [editFloat, setEditFloat] = useState<{ x: number; y: number; annotationId: string; isNew: boolean } | null>(null);
  const [highlights, setHighlights] = useState<HighlightsMap>({});
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const [pdfPages, setPdfPages] = useState(0);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const visiblePagesRef = useRef(new Set<number>());

  // ── Baseline set: tracks which annotation IDs have been sent ──
  const baselineIdsRef = useRef<Set<string>>(collectAnnotationIds(annotations.items));
  const [baselineVer, setBaselineVer] = useState(0);

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
    if (annotations.items.length === 0) return;
    setHighlights(prev => {
      const missing = annotations.items.filter(
        a => a.highlightRects && a.highlightRects.length > 0 && !prev[a.id]
      );
      if (missing.length === 0) return prev;
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

  // ── Markdown enhancements ──────────────────────────────────────────────
  const mdRef = useRef<HTMLDivElement>(null);
  const [tocOpen, setTocOpen] = useState(() => {
    try { return localStorage.getItem('fv-toc-open') === '1'; } catch { return false; }
  });
  const mdHeadings = useMemo(() => isMd ? extractHeadings(content) : [], [isMd, content]);
  const mdComponents = useMemo(() => {
    const comps = headingComponents();
    // MermaidCodeBlock: render mermaid fences as-is so the hook can find them
    const MermaidCodeBlock = ({ className, children, ...rest }: any) => {
      if (className === 'language-mermaid') {
        return <pre><code className={className} {...rest}>{children}</code></pre>;
      }
      return <code className={className} {...rest}>{children}</code>;
    };
    return { ...comps, code: MermaidCodeBlock };
  }, []);
  useMermaidRender(mdRef, content);
  const handleTocToggle = useCallback(() => {
    setTocOpen(v => {
      const next = !v;
      try { localStorage.setItem('fv-toc-open', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

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
    // D6: Use centralized constants for field length limits
    const truncated = truncateSelectedText(selectedText);
    const ann: FileAnnotation = {
      id,
      type,
      file_path: filePath,
      absolute_path: absolutePath,
      selected_text: truncated,
      // D2: Truncate content to prevent oversized annotations
      content: truncateAnnotationContent(defaultContent),
      cursor: float ? computeSourceCursor(truncated, float.renderedOffset, float.renderedTextLen, content) : 0,
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
  }, [annotations, filePath, absolutePath, onAnnotationsChange, float, pdfScale, content]);

  const removeAnnotation = useCallback((id: string) => {
    onAnnotationsChange({ items: annotations.items.filter((a) => a.id !== id), updatedAt: Date.now() });
    setHighlights(prev => removeHighlight(prev, id));
    if (activeHighlightId === id) setActiveHighlightId(null);
  }, [annotations, onAnnotationsChange, activeHighlightId]);

  const editAnnotation = useCallback((id: string, newContent: string) => {
    const newId = uid();
    // D2: Truncate content to prevent oversized annotations
    const truncatedContent = truncateAnnotationContent(newContent) ?? '';
    onAnnotationsChange({ items: applyEdit(annotations.items, id, truncatedContent, newId), updatedAt: Date.now() });
    setHighlights((prev) => rekeyHighlight(prev, id, newId));
    if (activeHighlightId === id) setActiveHighlightId(newId);
  }, [annotations, onAnnotationsChange, activeHighlightId]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { setFloat(null); return; }
    const text = sel.toString().trim();
    if (!text) { setFloat(null); return; }
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const range = sel.getRangeAt(0);
    // Compute renderedOffset: character offset of selection start in rendered text
    const preRange = document.createRange();
    preRange.setStart(container, 0);
    preRange.setEnd(range.startContainer, range.startOffset);
    const renderedOffset = preRange.toString().length;
    const renderedTextLen = container.innerText.length;
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
      renderedOffset,
      renderedTextLen,
    });
  }, []);

  const isSent = useCallback((id: string) => baselineIdsRef.current.has(id), []);

  const sendableCount = useMemo(() => {
    void baselineVer; // trigger recompute on baseline changes
    return filterSendable(annotations.items, baselineIdsRef.current).length;
  }, [annotations, baselineVer]);

  const handleSendSingle = useCallback((id: string) => {
    if (baselineIdsRef.current.has(id)) return;
    const ann = annotations.items.find((a) => a.id === id);
    if (!ann) return;
    onSendToPrompt(buildSendPayload([ann]));
    baselineIdsRef.current.add(id);
    setBaselineVer((v) => v + 1);
  }, [annotations, onSendToPrompt]);

  const handleSendAll = useCallback(() => {
    const sendable = filterSendable(annotations.items, baselineIdsRef.current);
    if (sendable.length === 0) return;
    onSendToPrompt(buildSendPayload(sendable));
    baselineIdsRef.current = collectAnnotationIds(annotations.items);
    setBaselineVer((v) => v + 1);
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
          isSent={isSent}
          sendableCount={sendableCount}
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
                title={t('fv.deleteAnnotation')}
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
            <div className="fv-render__markdown" ref={mdRef}>
              {mdHeadings.length > 0 && (
                <MarkdownToc headings={mdHeadings} isOpen={tocOpen} onToggle={handleTocToggle} />
              )}
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={mdComponents}
              >
                {content}
              </ReactMarkdown>
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
          <p>{t('fv.unsupported')}</p>
        </div>
      )}
      {format === 'pdf-binary' && pdfFile && (
        <div className="fv-render__pdf-wrapper" style={{ '--pdf-page-gap': `${12 * pdfScale}px` } as React.CSSProperties}>
          {pdfError && <div className="fv-render__pdf-error">{t('fv.pdfError', pdfError)}</div>}
          <Document
            file={pdfFile}
            onLoadSuccess={(pdf: { numPages: number }) => { setPdfPages(pdf.numPages); onPdfPagesLoaded?.(pdf.numPages); }}
            onLoadError={(err: Error) => setPdfError(err.message)}
            loading={<div className="fv-render__pdf-loading">{t('fv.pdfLoading')}</div>}
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
      {format === 'image' && binaryBuffer && <ImageRenderer buffer={binaryBuffer} filename={filename} />}

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
              isSent={isSent(a.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
