import { describe, it, expect } from 'vitest';
import { generateSlug } from '../workspace.js';

describe('generateSlug', () => {
  it('should generate slug with nb- prefix by default', () => {
    const slug = generateSlug();
    expect(slug).toMatch(/^nb-[a-z0-9]{8}$/);
  });

  it('should generate slug with proj- prefix', () => {
    const slug = generateSlug('proj');
    expect(slug).toMatch(/^proj-[a-z0-9]{8}$/);
  });

  it('should generate slug with nb- prefix explicitly', () => {
    const slug = generateSlug('nb');
    expect(slug).toMatch(/^nb-[a-z0-9]{8}$/);
  });

  it('should generate unique slugs on repeated calls', () => {
    const slugs = new Set(Array.from({ length: 100 }, () => generateSlug()));
    expect(slugs.size).toBe(100);
  });

  it('should only contain ASCII characters', () => {
    for (let i = 0; i < 50; i++) {
      const slug = generateSlug();
      // eslint-disable-next-line no-control-regex
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
