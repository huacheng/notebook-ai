/**
 * Utility to unquote git-quoted file paths.
 *
 * Git quotes paths containing non-ASCII characters using C-style escaping
 * wrapped in double quotes, e.g.:
 *   "\345\270\202\345\234\272.notebook.json"
 *
 * This function converts such paths back to their original UTF-8 form.
 */
export function unquoteGitPath(raw: string): string {
  // Not quoted — return as-is
  if (!raw.startsWith('"') || !raw.endsWith('"')) return raw;

  // Strip surrounding quotes
  const inner = raw.slice(1, -1);

  // Replace escape sequences
  const bytes: number[] = [];
  let i = 0;
  while (i < inner.length) {
    if (inner[i] === '\\' && i + 1 < inner.length) {
      const next = inner[i + 1];
      if (next >= '0' && next <= '7') {
        // Octal escape: \NNN (1–3 digits)
        let octal = '';
        for (let j = 0; j < 3 && i + 1 + j < inner.length; j++) {
          const ch = inner[i + 1 + j];
          if (ch >= '0' && ch <= '7') {
            octal += ch;
          } else {
            break;
          }
        }
        bytes.push(parseInt(octal, 8));
        i += 1 + octal.length;
      } else {
        // Named escapes
        switch (next) {
          case '\\': bytes.push(0x5c); break;
          case '"':  bytes.push(0x22); break;
          case 'n':  bytes.push(0x0a); break;
          case 't':  bytes.push(0x09); break;
          case 'r':  bytes.push(0x0d); break;
          case 'a':  bytes.push(0x07); break;
          case 'b':  bytes.push(0x08); break;
          case 'f':  bytes.push(0x0c); break;
          default:   bytes.push(next.charCodeAt(0)); break;
        }
        i += 2;
      }
    } else {
      bytes.push(inner.charCodeAt(i));
      i++;
    }
  }

  return Buffer.from(bytes).toString('utf-8');
}
