export const DRAFT_PREFIX = 'nb-prompt-draft-';

export function loadDraft(sessionKey: string): string {
  try {
    return localStorage.getItem(`${DRAFT_PREFIX}${sessionKey}`) ?? '';
  } catch {
    return '';
  }
}

export function saveDraft(sessionKey: string, text: string): void {
  try {
    if (text) {
      localStorage.setItem(`${DRAFT_PREFIX}${sessionKey}`, text);
    } else {
      localStorage.removeItem(`${DRAFT_PREFIX}${sessionKey}`);
    }
  } catch { /* quota exceeded — ignore */ }
}

export function clearDraft(sessionKey: string): void {
  try {
    localStorage.removeItem(`${DRAFT_PREFIX}${sessionKey}`);
  } catch { /* ignore */ }
}
