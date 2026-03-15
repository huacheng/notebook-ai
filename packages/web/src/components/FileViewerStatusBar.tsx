export type FileFormat = 'text' | 'html' | 'pdf-binary' | 'docx-binary' | 'xlsx-binary' | 'pptx-binary' | 'image' | 'unsupported';

interface FileViewerStatusBarProps {
  filename: string;
  format: FileFormat | null;
  mode: 'render' | 'edit';
  onToggleMode: () => void;
  onClose: () => void;
  pdfPage?: number;
  pdfPages?: number;
  scale?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
}

const FORMAT_LABEL: Partial<Record<FileFormat, string>> = {
  text: 'Text', html: 'HTML', 'pdf-binary': 'PDF', 'docx-binary': 'DOCX', 'xlsx-binary': 'XLSX', 'pptx-binary': 'PPTX', unsupported: '—',
};

export function FileViewerStatusBar({
  filename, format, mode, onToggleMode, onClose,
  pdfPage, pdfPages, scale, onZoomIn, onZoomOut,
}: FileViewerStatusBarProps) {
  const canEdit = format !== null && !format.endsWith('-binary') && format !== 'unsupported';
  const showZoom = scale !== undefined;
  const showPdfPage = pdfPages !== undefined && pdfPages > 0;
  return (
    <div className="fv-statusbar">
      <span className="fv-statusbar__name" title={filename}>{filename}</span>
      {format && <span className="fv-statusbar__format">{FORMAT_LABEL[format] ?? format}</span>}

      {/* Page & zoom controls */}
      {showZoom && (
        <div className="fv-statusbar__pdf-controls">
          {showPdfPage && <span className="fv-statusbar__page-info">{pdfPage} / {pdfPages}</span>}
          <button className="fv-statusbar__btn" onClick={onZoomOut} title="Zoom out">−</button>
          <span className="fv-statusbar__zoom-level">{Math.round((scale ?? 1) * 100)}%</span>
          <button className="fv-statusbar__btn" onClick={onZoomIn} title="Zoom in">+</button>
        </div>
      )}

      <div className="fv-statusbar__actions">
        {canEdit && (
          <button className={`fv-statusbar__btn${mode === 'edit' ? ' active' : ''}`} onClick={onToggleMode}>
            {mode === 'edit' ? 'Preview' : 'Edit'}
          </button>
        )}
        <button className="fv-statusbar__btn fv-statusbar__close" onClick={onClose} title="Close">✕</button>
      </div>
    </div>
  );
}
