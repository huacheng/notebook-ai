// FileAnnotation types — 4-mode annotation for file viewer

export interface FileAnnotation {
  id: string;                   // uid()
  type: 'insert' | 'delete' | 'replace' | 'comment';
  file_path: string;            // relative path within workspace/library
  selected_text: string;        // anchor snapshot (max 80 chars)
  content?: string;             // insert/replace/comment text
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

let _idCounter = 0;
export function uid(): string {
  return `ann_${++_idCounter}_${Date.now()}`;
}

export function storageKey(notebookId: string, filePath: string): string {
  return `file-annotations-${notebookId}-${filePath}`;
}

export function buildAnnotationText(annotations: FileAnnotations): string {
  const { items } = annotations;
  if (items.length === 0) return '';

  const lines: string[] = ['## File Annotations'];
  const byType = {
    insert: items.filter((a) => a.type === 'insert'),
    delete: items.filter((a) => a.type === 'delete'),
    replace: items.filter((a) => a.type === 'replace'),
    comment: items.filter((a) => a.type === 'comment'),
  };

  if (byType.insert.length > 0) {
    lines.push('\n### Insert');
    byType.insert.forEach((a) => lines.push(`- After "${a.selected_text}": ${a.content ?? ''}`));
  }
  if (byType.delete.length > 0) {
    lines.push('\n### Delete');
    byType.delete.forEach((a) => lines.push(`- "${a.selected_text}"`));
  }
  if (byType.replace.length > 0) {
    lines.push('\n### Replace');
    byType.replace.forEach((a) => lines.push(`- "${a.selected_text}" → ${a.content ?? ''}`));
  }
  if (byType.comment.length > 0) {
    lines.push('\n### Comment');
    byType.comment.forEach((a) => lines.push(`- "${a.selected_text}": ${a.content ?? ''}`));
  }

  return lines.join('\n');
}
