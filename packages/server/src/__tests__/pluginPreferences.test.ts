import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadPreferences,
  applyPreferences,
  PluginCandidate,
  PluginPreferences,
} from '../task-ai/plugin-preferences';

describe('pluginPreferences', () => {
  const tempDir = '/tmp/test-plugin-preferences';
  const settingsFile = path.join(tempDir, 'settings.json');

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadPreferences', () => {
    it('should load preferences from settings file', () => {
      const settings = {
        'task-ai': {
          'plugin-delegation': {
            slotBindings: { 'code-review': 'superpowers:code-review' },
            disabledPlugins: ['untrusted:plugin'],
            disabledSlots: ['domain-*'],
            confidenceThreshold: 'medium',
            trustLevelMinimum: 'verified',
          },
        },
      };

      fs.writeFileSync(settingsFile, JSON.stringify(settings));

      const prefs = loadPreferences(settingsFile);

      expect(prefs.slotBindings.get('code-review')).toBe('superpowers:code-review');
      expect(prefs.disabledPlugins.has('untrusted:plugin')).toBe(true);
      expect(prefs.disabledSlots.has('domain-*')).toBe(true);
      expect(prefs.confidenceThreshold).toBe('medium');
      expect(prefs.trustLevelMinimum).toBe('verified');
    });

    it('should return defaults when file does not exist', () => {
      const prefs = loadPreferences('/nonexistent/settings.json');

      expect(prefs.slotBindings.size).toBe(0);
      expect(prefs.disabledPlugins.size).toBe(0);
      expect(prefs.disabledSlots.size).toBe(0);
      expect(prefs.confidenceThreshold).toBe('low');
      expect(prefs.trustLevelMinimum).toBe('any');
    });

    it('should return defaults when task-ai section is missing', () => {
      fs.writeFileSync(settingsFile, JSON.stringify({ other: 'config' }));

      const prefs = loadPreferences(settingsFile);

      expect(prefs.slotBindings.size).toBe(0);
    });

    it('should handle partial configuration', () => {
      const settings = {
        'task-ai': {
          'plugin-delegation': {
            disabledPlugins: ['bad-plugin'],
          },
        },
      };

      fs.writeFileSync(settingsFile, JSON.stringify(settings));

      const prefs = loadPreferences(settingsFile);

      expect(prefs.disabledPlugins.has('bad-plugin')).toBe(true);
      expect(prefs.slotBindings.size).toBe(0);
      expect(prefs.confidenceThreshold).toBe('low');
    });
  });

  describe('applyPreferences', () => {
    const defaultPrefs: PluginPreferences = {
      slotBindings: new Map(),
      disabledPlugins: new Set(),
      disabledSlots: new Set(),
      confidenceThreshold: 'low',
      trustLevelMinimum: 'any',
    };

    it('should return empty array for disabled slot', () => {
      const prefs: PluginPreferences = {
        ...defaultPrefs,
        disabledSlots: new Set(['code-review']),
      };

      const candidates: PluginCandidate[] = [
        { plugin: 'superpowers:code-review', slot: 'code-review', relevanceScore: 0.9 },
      ];

      const result = applyPreferences('code-review', candidates, prefs);

      expect(result).toEqual([]);
    });

    it('should return only bound plugin when slot has binding', () => {
      const prefs: PluginPreferences = {
        ...defaultPrefs,
        slotBindings: new Map([['code-review', 'preferred:reviewer']]),
      };

      const candidates: PluginCandidate[] = [
        { plugin: 'superpowers:code-review', slot: 'code-review', relevanceScore: 0.9 },
        { plugin: 'preferred:reviewer', slot: 'code-review', relevanceScore: 0.7 },
        { plugin: 'other:reviewer', slot: 'code-review', relevanceScore: 0.8 },
      ];

      const result = applyPreferences('code-review', candidates, prefs);

      expect(result.length).toBe(1);
      expect(result[0].plugin).toBe('preferred:reviewer');
    });

    it('should return empty if bound plugin not in candidates', () => {
      const prefs: PluginPreferences = {
        ...defaultPrefs,
        slotBindings: new Map([['code-review', 'missing:plugin']]),
      };

      const candidates: PluginCandidate[] = [
        { plugin: 'superpowers:code-review', slot: 'code-review', relevanceScore: 0.9 },
      ];

      const result = applyPreferences('code-review', candidates, prefs);

      expect(result).toEqual([]);
    });

    it('should filter out disabled plugins', () => {
      const prefs: PluginPreferences = {
        ...defaultPrefs,
        disabledPlugins: new Set(['bad:plugin', 'untrusted:tool']),
      };

      const candidates: PluginCandidate[] = [
        { plugin: 'good:plugin', slot: 'test', relevanceScore: 0.9 },
        { plugin: 'bad:plugin', slot: 'test', relevanceScore: 0.8 },
        { plugin: 'untrusted:tool', slot: 'test', relevanceScore: 0.7 },
      ];

      const result = applyPreferences('test', candidates, prefs);

      expect(result.length).toBe(1);
      expect(result[0].plugin).toBe('good:plugin');
    });

    it('should return all candidates when no restrictions', () => {
      const candidates: PluginCandidate[] = [
        { plugin: 'plugin-a', slot: 'test', relevanceScore: 0.9 },
        { plugin: 'plugin-b', slot: 'test', relevanceScore: 0.8 },
      ];

      const result = applyPreferences('test', candidates, defaultPrefs);

      expect(result.length).toBe(2);
    });

    it('should apply multiple filters in order', () => {
      const prefs: PluginPreferences = {
        ...defaultPrefs,
        disabledPlugins: new Set(['disabled:one']),
      };

      const candidates: PluginCandidate[] = [
        { plugin: 'good:plugin', slot: 'test', relevanceScore: 0.9 },
        { plugin: 'disabled:one', slot: 'test', relevanceScore: 0.8 },
        { plugin: 'good:another', slot: 'test', relevanceScore: 0.7 },
      ];

      const result = applyPreferences('test', candidates, prefs);

      expect(result.length).toBe(2);
      expect(result.map(r => r.plugin)).toContain('good:plugin');
      expect(result.map(r => r.plugin)).toContain('good:another');
      expect(result.map(r => r.plugin)).not.toContain('disabled:one');
    });

    it('should handle empty candidates array', () => {
      const result = applyPreferences('test', [], defaultPrefs);
      expect(result).toEqual([]);
    });
  });
});
