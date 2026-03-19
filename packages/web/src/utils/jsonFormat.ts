export function isJsonFile(filename: string | null | undefined): boolean {
  if (!filename) return false;
  return filename.endsWith('.json') && !filename.endsWith('.notebook.json');
}

export function formatJsonContent(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}
