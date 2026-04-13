/**
 * Validates a notebook title for illegal filename characters.
 *
 * Returns null if the title is valid (or empty — empty is handled separately
 * by the submit-disabled logic).
 * Returns a Chinese error string if the title contains characters forbidden
 * in most file-system filenames: / \ : * ? " < > | or control chars 0x00-0x1f.
 */
export function validateNotebookTitle(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  if (/[/\\:*?"<>|\u0000-\u001f]/.test(trimmed)) {
    return '名称包含非法字符（/\\:*?"<>|）';
  }
  return null;
}
