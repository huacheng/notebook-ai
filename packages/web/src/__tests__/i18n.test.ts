import { describe, it, expect } from 'vitest';
import { messages, type Language } from '../i18n/locales';
import { createT } from '../i18n/index';

describe('i18n locales', () => {
  it('en and zh have identical key sets', () => {
    const enKeys = Object.keys(messages.en).sort();
    const zhKeys = Object.keys(messages.zh).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it('no empty values in en', () => {
    for (const [key, val] of Object.entries(messages.en)) {
      expect(val, `en key "${key}" is empty`).not.toBe('');
    }
  });

  it('no empty values in zh', () => {
    for (const [key, val] of Object.entries(messages.zh)) {
      expect(val, `zh key "${key}" is empty`).not.toBe('');
    }
  });
});

describe('createT', () => {
  it('returns English text for en language', () => {
    const t = createT('en');
    expect(t('toolbar.plugins')).toBe('Plugins');
  });

  it('returns Chinese text for zh language', () => {
    const t = createT('zh');
    expect(t('toolbar.plugins')).toBe('插件');
  });

  it('returns key itself for unknown key (fallback)', () => {
    const t = createT('en');
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });

  it('supports parameter interpolation with {0}, {1}', () => {
    const t = createT('en');
    expect(t('plugin.installing', 'task-ai')).toBe('Installing task-ai…');
    const tZh = createT('zh');
    expect(tZh('plugin.installing', 'task-ai')).toBe('正在安装 task-ai…');
  });
});
