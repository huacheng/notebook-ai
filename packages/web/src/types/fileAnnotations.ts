// FileAnnotation types — 4-mode annotation for file viewer

// D6: Extracted constants for annotation field limits
/** Maximum length for selected_text field (anchor snapshot) */
export const MAX_SELECTED_TEXT_LENGTH = 80;

/** Maximum length for annotation content field (D2 security limit) */
export const MAX_ANNOTATION_CONTENT_LENGTH = 10000;

/** Truncate selected text to MAX_SELECTED_TEXT_LENGTH */
export function truncateSelectedText(text: string): string {
  return text.slice(0, MAX_SELECTED_TEXT_LENGTH);
}

/** Truncate annotation content to MAX_ANNOTATION_CONTENT_LENGTH */
export function truncateAnnotationContent(content: string | undefined): string | undefined {
  if (content === undefined) return undefined;
  return content.slice(0, MAX_ANNOTATION_CONTENT_LENGTH);
}

export interface FileAnnotation {
  id: string;                   // uid()
  type: 'insert' | 'delete' | 'replace' | 'comment';
  file_path: string;            // relative path within workspace/library
  absolute_path: string;        // absolute path for prompt
  selected_text: string;        // anchor snapshot (max 80 chars)
  content?: string;             // insert/replace/comment text
  cursor: number;               // character offset in source text
  author: string;
  timestamp: string;            // ISO
  updatedAt: number;            // ms epoch
  highlightRects?: { x: number; y: number; width: number; height: number }[];
  capturedScale?: number;
}

export interface FileAnnotations {
  items: FileAnnotation[];
  updatedAt: number;
}

export const EMPTY_FILE_ANNOTATIONS: FileAnnotations = {
  items: [],
  updatedAt: 0,
};

export function uid(): string {
  return crypto.randomUUID();
}

export function storageKey(notebookId: string, filePath: string): string {
  return `file-annotations-${notebookId}-${filePath}`;
}

export function isTaskSystemFile(absolutePath: string): boolean {
  const segments = absolutePath.split('/');
  const workingIdx = segments.indexOf('.working');
  if (workingIdx < 0) return false;
  const filename = segments[segments.length - 1];
  return filename.startsWith('.');
}

export function resolveAbsolutePath(
  source: 'workspace' | 'library' | 'deliverables',
  filePath: string,
  workspaceDir: string | null,
  activeProjectPath: string | null,
): string {
  if (source === 'workspace') {
    // Use activeProjectPath (project root) as base when available,
    // because filePath is relative to project root (from the file list API).
    // Using workspaceDir (notebook cwd, may be a worktree subdirectory)
    // would cause duplicate path segments.
    const base = activeProjectPath ?? workspaceDir;
    return base ? `${base}/${filePath}` : '';
  }
  if (source === 'deliverables') {
    return workspaceDir ? `${workspaceDir}/.deliverables/${filePath}` : '';
  }
  // library
  const root = activeProjectPath
    ? activeProjectPath.substring(0, activeProjectPath.lastIndexOf('/'))
    : null;
  return root ? `${root}/.library/${filePath}` : '';
}

export function computeSourceCursor(
  selectedText: string,
  renderedOffset: number,
  renderedTextLen: number,
  sourceText: string,
): number {
  if (renderedTextLen === 0) return 0;
  if (!selectedText) {
    return Math.round((renderedOffset / renderedTextLen) * sourceText.length);
  }
  // Find all positions of selectedText in source
  const positions: number[] = [];
  let idx = 0;
  while ((idx = sourceText.indexOf(selectedText, idx)) !== -1) {
    positions.push(idx);
    idx += 1;
  }
  if (positions.length === 0) {
    return Math.round((renderedOffset / renderedTextLen) * sourceText.length);
  }
  if (positions.length === 1) return positions[0];
  // Multiple matches: pick closest by proportion
  const est = (renderedOffset / renderedTextLen) * sourceText.length;
  return positions.reduce((best, p) =>
    Math.abs(p - est) < Math.abs(best - est) ? p : best
  );
}

export function buildSingleAnnotationPrompt(ann: FileAnnotation): string {
  const { type, absolute_path, selected_text, content, cursor } = ann;

  const obj: Record<string, string | number> = {
    file: absolute_path,
    type,
    selected: selected_text,
    cursor,
  };

  if (type === 'insert' && content != null) {
    obj.content = content;
  } else if (type === 'replace' && content != null) {
    obj.replacement = content;
  } else if (type === 'comment' && content != null) {
    obj.comment = content;
  }
  // delete: no extra field

  return JSON.stringify(obj);
}

export function buildAnnotationPrompt(annotations: FileAnnotation[]): string {
  if (annotations.length === 0) return '';
  return annotations.map((a) => buildSingleAnnotationPrompt(a)).join('\n');
}

export function buildSendPayload(annotations: FileAnnotation[]): string {
  if (annotations.length === 0) return '';
  const jsonl = buildAnnotationPrompt(annotations);
  // Route: system file (dotfile inside .working/) gets /task-ai:annotate prefix
  const firstPath = annotations[0].absolute_path;
  if (isTaskSystemFile(firstPath)) {
    return `/task-ai:annotate\n${jsonl}`;
  }
  return jsonl;
}

export function collectAnnotationIds(items: FileAnnotation[]): Set<string> {
  return new Set(items.map((i) => i.id));
}

export function filterSendable(items: FileAnnotation[], baseline: Set<string>): FileAnnotation[] {
  return items.filter((i) => !baseline.has(i.id));
}

export function applyEdit(items: FileAnnotation[], id: string, newContent: string, newId?: string): FileAnnotation[] {
  const nid = newId ?? uid();
  return items.map((a) =>
    a.id === id ? { ...a, id: nid, content: newContent, updatedAt: Date.now() } : a,
  );
}

export function canEditFile(format: string | null, absolutePath: string): boolean {
  if (format === null) return false;
  if (format === 'unsupported') return false;
  if (format.endsWith('-binary')) return false;
  if (isTaskSystemFile(absolutePath)) return false;
  return true;
}

