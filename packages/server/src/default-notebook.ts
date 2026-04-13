import path from 'path';

/**
 * 判定 notebook 是否为默认 notebook（位于 project 根直接下）。
 * 通过 path.resolve 规范化两侧路径，避免末尾斜杠、相对路径、..段落导致误判。
 */
export function isDefaultNotebook(notebookPath: string, projectPath: string): boolean {
  const resolvedNb = path.resolve(notebookPath);
  const resolvedProject = path.resolve(projectPath);
  return path.dirname(resolvedNb) === resolvedProject;
}
