export const MAX_TITLE_LENGTH = 60;

export function validateTitle(title: string): string {
  const t = title.trim();
  if (!t) return '';
  if (t.length > MAX_TITLE_LENGTH) return `Name too long (max ${MAX_TITLE_LENGTH} chars)`;
  if (!/[\p{L}\p{N}]/u.test(t)) return 'Name must contain at least one letter or number';
  if (/^[.\-_]/.test(t)) return 'Name cannot start with . - or _';
  return '';
}
