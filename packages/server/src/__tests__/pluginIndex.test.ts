import { describe, it, expect } from 'vitest';
import {
  buildPluginIndex,
  findPluginsForSlot,
  extractKeywords,
  inferCapabilities,
  PluginInfo,
  PluginIndex,
} from '../task-ai/plugin-index';

describe('pluginIndex', () => {
  describe('extractKeywords', () => {
    it('should extract keywords from description', () => {
      const keywords = extractKeywords('Parse PDF documents and extract text');
      expect(keywords).toContain('pdf');
      expect(keywords).toContain('parse');
      expect(keywords).toContain('documents');
      expect(keywords).toContain('extract');
      expect(keywords).toContain('text');
    });

    it('should lowercase all keywords', () => {
      const keywords = extractKeywords('PDF Parser for Documents');
      expect(keywords.every(k => k === k.toLowerCase())).toBe(true);
    });

    it('should filter out common stop words', () => {
      const keywords = extractKeywords('This is a tool for the parsing of documents');
      expect(keywords).not.toContain('this');
      expect(keywords).not.toContain('is');
      expect(keywords).not.toContain('a');
      expect(keywords).not.toContain('for');
      expect(keywords).not.toContain('the');
      expect(keywords).not.toContain('of');
    });

    it('should filter out short words', () => {
      const keywords = extractKeywords('A to do app');
      expect(keywords).not.toContain('a');
      expect(keywords).not.toContain('to');
      expect(keywords).not.toContain('do');
    });

    it('should handle empty description', () => {
      const keywords = extractKeywords('');
      expect(keywords).toEqual([]);
    });
  });

  describe('inferCapabilities', () => {
    it('should infer doc-parse from PDF-related description', () => {
      const caps = inferCapabilities('pdf-parser', 'Parse PDF documents', ['pdf', 'parse']);
      expect(caps).toContain('doc-parse');
    });

    it('should infer doc-parse from document-related name', () => {
      const caps = inferCapabilities('document-skills:docx', 'Process Word documents', ['word', 'docx']);
      expect(caps).toContain('doc-parse');
    });

    it('should infer code-review from review-related keywords', () => {
      const caps = inferCapabilities('superpowers:code-review', 'Code review tools', ['code', 'review']);
      expect(caps).toContain('code-review');
    });

    it('should infer brainstorm from design/explore keywords', () => {
      const caps = inferCapabilities('brainstorm-tool', 'Explore design space', ['explore', 'design']);
      expect(caps).toContain('brainstorm');
    });

    it('should infer debugging from debug/fix keywords', () => {
      const caps = inferCapabilities('debugger', 'Debug and fix issues', ['debug', 'fix']);
      expect(caps).toContain('debugging');
    });

    it('should infer tdd from test/tdd keywords', () => {
      const caps = inferCapabilities('test-helper', 'TDD workflow support', ['tdd', 'test']);
      expect(caps).toContain('tdd');
    });

    it('should infer frontend-design from frontend/ui keywords', () => {
      const caps = inferCapabilities('ui-builder', 'Frontend UI design', ['frontend', 'ui', 'design']);
      expect(caps).toContain('frontend-design');
    });

    it('should return domain-* for unrecognized capabilities', () => {
      const caps = inferCapabilities('generic-tool', 'Some generic tool', ['generic', 'tool']);
      expect(caps).toContain('domain-*');
    });

    it('should return multiple capabilities when applicable', () => {
      const caps = inferCapabilities('all-in-one', 'Debug, test, and review code', ['debug', 'test', 'review', 'code']);
      expect(caps).toContain('debugging');
      expect(caps).toContain('tdd');
      expect(caps).toContain('code-review');
    });
  });

  describe('buildPluginIndex', () => {
    it('should build index with correct structure', async () => {
      const plugins: PluginInfo[] = [
        { name: 'doc:pdf', description: 'Parse PDF documents' },
        { name: 'superpowers:code-review', description: 'Code review tools' },
      ];

      const index = await buildPluginIndex(plugins);

      expect(index.version).toBe(1);
      expect(index.pluginCount).toBe(2);
      expect(index.plugins.length).toBe(2);
      expect(index.buildTime).toBeDefined();
      expect(index.pluginListHash).toBeDefined();
    });

    it('should extract keywords from each plugin', async () => {
      const plugins: PluginInfo[] = [
        { name: 'doc:pdf', description: 'Parse PDF documents' },
      ];

      const index = await buildPluginIndex(plugins);
      const plugin = index.plugins[0];

      expect(plugin.keywords).toContain('pdf');
      expect(plugin.keywords).toContain('parse');
    });

    it('should build capability inverted index', async () => {
      const plugins: PluginInfo[] = [
        { name: 'doc:pdf', description: 'Parse PDF documents' },
        { name: 'doc:docx', description: 'Parse Word documents' },
      ];

      const index = await buildPluginIndex(plugins);

      expect(index.capabilityIndex['doc-parse']).toContain('doc:pdf');
      expect(index.capabilityIndex['doc-parse']).toContain('doc:docx');
    });

    it('should handle plugins with multiple capabilities', async () => {
      const plugins: PluginInfo[] = [
        { name: 'all-in-one', description: 'Debug, test, and review code' },
      ];

      const index = await buildPluginIndex(plugins);

      expect(index.capabilityIndex['debugging']).toContain('all-in-one');
      expect(index.capabilityIndex['tdd']).toContain('all-in-one');
      expect(index.capabilityIndex['code-review']).toContain('all-in-one');
    });

    it('should handle empty plugin list', async () => {
      const index = await buildPluginIndex([]);

      expect(index.pluginCount).toBe(0);
      expect(index.plugins).toEqual([]);
      expect(Object.keys(index.capabilityIndex)).toHaveLength(0);
    });
  });

  describe('findPluginsForSlot', () => {
    it('should find plugins by slot in O(1)', async () => {
      const plugins: PluginInfo[] = [
        { name: 'doc:pdf', description: 'Parse PDF documents' },
        { name: 'doc:docx', description: 'Parse Word documents' },
        { name: 'superpowers:code-review', description: 'Code review tools' },
      ];

      const index = await buildPluginIndex(plugins);
      const found = findPluginsForSlot(index, 'doc-parse');

      expect(found).toContain('doc:pdf');
      expect(found).toContain('doc:docx');
      expect(found).not.toContain('superpowers:code-review');
    });

    it('should return empty array for unknown slot', async () => {
      const plugins: PluginInfo[] = [
        { name: 'doc:pdf', description: 'Parse PDF documents' },
      ];

      const index = await buildPluginIndex(plugins);
      const found = findPluginsForSlot(index, 'unknown-slot');

      expect(found).toEqual([]);
    });

    it('should handle slot with single plugin', async () => {
      const plugins: PluginInfo[] = [
        { name: 'unique-tool', description: 'Unique debugging tool' },
      ];

      const index = await buildPluginIndex(plugins);
      const found = findPluginsForSlot(index, 'debugging');

      expect(found).toEqual(['unique-tool']);
    });
  });

  describe('index hash', () => {
    it('should generate consistent hash for same plugins', async () => {
      const plugins: PluginInfo[] = [
        { name: 'plugin-a', description: 'Description A' },
        { name: 'plugin-b', description: 'Description B' },
      ];

      const index1 = await buildPluginIndex(plugins);
      const index2 = await buildPluginIndex(plugins);

      expect(index1.pluginListHash).toBe(index2.pluginListHash);
    });

    it('should generate different hash for different plugins', async () => {
      const plugins1: PluginInfo[] = [{ name: 'plugin-a', description: 'A' }];
      const plugins2: PluginInfo[] = [{ name: 'plugin-b', description: 'B' }];

      const index1 = await buildPluginIndex(plugins1);
      const index2 = await buildPluginIndex(plugins2);

      expect(index1.pluginListHash).not.toBe(index2.pluginListHash);
    });
  });
});
