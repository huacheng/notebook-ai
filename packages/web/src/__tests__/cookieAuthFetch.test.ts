import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const FILES = walk(SRC_ROOT);

describe('Cookie-based auth (production source guards)', () => {
  it('no production source file injects an Authorization Bearer header', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, 'utf-8');
      if (/Authorization['"]?\s*[:=]\s*[`'"]\s*Bearer/i.test(src)) {
        offenders.push(path.relative(SRC_ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no production source file uses sessionStorage or localStorage for nb-auth-token', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, 'utf-8');
      if (/(sessionStorage|localStorage)\.(get|set|remove)Item\(['"]nb-auth-token['"]/.test(src)) {
        offenders.push(path.relative(SRC_ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });
});
