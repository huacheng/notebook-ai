import { describe, it, expect } from 'vitest';

/**
 * D2-5: Plugin key format validation
 *
 * pluginKey passed to execClaude must be validated against a safe pattern.
 * Marketplace name and source URL must also be validated.
 */

// These functions need to be exported from plugin.ts
import { validatePluginKey, validateMarketplaceName, validateMarketplaceSource } from '../routes/plugin.js';

describe('validatePluginKey (D2-5)', () => {
  it('should accept valid name@marketplace format', () => {
    expect(validatePluginKey('task-ai@moonview')).toBe(true);
  });

  it('should accept alphanumeric with hyphens and underscores', () => {
    expect(validatePluginKey('my_plugin@my-marketplace')).toBe(true);
  });

  it('should reject keys without @ separator', () => {
    expect(validatePluginKey('taskaimoonview')).toBe(false);
  });

  it('should reject empty string', () => {
    expect(validatePluginKey('')).toBe(false);
  });

  it('should reject keys with shell metacharacters', () => {
    expect(validatePluginKey('task-ai; rm -rf /@moonview')).toBe(false);
  });

  it('should reject keys with backticks', () => {
    expect(validatePluginKey('task-ai`whoami`@moonview')).toBe(false);
  });

  it('should reject keys with $() command substitution', () => {
    expect(validatePluginKey('task-ai$(whoami)@moonview')).toBe(false);
  });

  it('should reject excessively long keys (>200 chars)', () => {
    const longKey = 'a'.repeat(101) + '@' + 'b'.repeat(101);
    expect(validatePluginKey(longKey)).toBe(false);
  });

  it('should accept keys with dots (e.g. scoped names)', () => {
    expect(validatePluginKey('my.plugin@marketplace')).toBe(true);
  });
});

describe('validateMarketplaceName (D2-5)', () => {
  it('should accept valid alphanumeric names', () => {
    expect(validateMarketplaceName('moonview')).toBe(true);
  });

  it('should accept names with hyphens', () => {
    expect(validateMarketplaceName('my-marketplace')).toBe(true);
  });

  it('should reject empty string', () => {
    expect(validateMarketplaceName('')).toBe(false);
  });

  it('should reject names with shell metacharacters', () => {
    expect(validateMarketplaceName('moon; rm -rf /')).toBe(false);
  });

  it('should reject names with spaces', () => {
    expect(validateMarketplaceName('moon view')).toBe(false);
  });
});

describe('validateMarketplaceSource (D2-5)', () => {
  it('should accept GitHub HTTPS URLs', () => {
    expect(validateMarketplaceSource('https://github.com/user/repo')).toBe(true);
  });

  it('should accept GitHub SSH URLs', () => {
    expect(validateMarketplaceSource('git@github.com:user/repo.git')).toBe(true);
  });

  it('should reject empty string', () => {
    expect(validateMarketplaceSource('')).toBe(false);
  });

  it('should reject strings with shell metacharacters', () => {
    expect(validateMarketplaceSource('https://example.com; rm -rf /')).toBe(false);
  });

  it('should reject strings with backticks', () => {
    expect(validateMarketplaceSource('`whoami`')).toBe(false);
  });

  it('should reject excessively long source (>500 chars)', () => {
    expect(validateMarketplaceSource('https://example.com/' + 'a'.repeat(500))).toBe(false);
  });
});
