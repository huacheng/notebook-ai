// FileAnnotation types — 4-mode annotation for file viewer

export interface FileAnnotation {
  id: string;                   // uid()
  type: 'insert' | 'delete' | 'replace' | 'comment';
  file_path: string;            // relative path within workspace/library
  absolute_path: string;        // absolute path for prompt
  selected_text: string;        // anchor snapshot (max 80 chars)
  content?: string;             // insert/replace/comment text
  textOffset: number;           // selection start in rendered text
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
    return workspaceDir ? `${workspaceDir}/${filePath}` : '';
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

const CONTEXT_CAP = 40;

export function buildSingleAnnotationPrompt(ann: FileAnnotation, fullText: string): string {
  const { type, absolute_path, selected_text, content, textOffset } = ann;
  const before = fullText.substring(Math.max(0, textOffset - CONTEXT_CAP), textOffset);
  const afterStart = textOffset + selected_text.length;
  const after = fullText.substring(afterStart, afterStart + CONTEXT_CAP);

  const obj: Record<string, string> = {
    type,
    file: absolute_path,
    selected_text,
    before,
    after,
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

export function buildAnnotationPrompt(annotations: FileAnnotation[], fullText: string): string {
  if (annotations.length === 0) return '';
  return annotations.map((a) => buildSingleAnnotationPrompt(a, fullText)).join('\n');
}

export function buildSendPayload(annotations: FileAnnotation[], fullText: string): string {
  if (annotations.length === 0) return '';
  const jsonl = buildAnnotationPrompt(annotations, fullText);
  // Route: system file (dotfile inside .working/) gets /task-ai:annotate prefix
  const firstPath = annotations[0].absolute_path;
  if (isTaskSystemFile(firstPath)) {
    return `/task-ai:annotate\n${jsonl}`;
  }
  return jsonl;
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
