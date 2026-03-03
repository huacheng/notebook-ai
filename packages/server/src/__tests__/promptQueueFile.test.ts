import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

// Will be implemented
import { loadQueueFromFile, saveQueueToFile, createDebouncedSaver } from '../queue-file.js';
import type { QueuedPrompt } from '@notebook-ai/shared';

describe('Prompt Queue File Persistence', () => {
  let tempDir: string;
  let queuePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'queue-test-'));
    queuePath = path.join(tempDir, '.prompt-queue.json');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('loadQueueFromFile', () => {
    it('should return empty queue if file does not exist', async () => {
      const result = await loadQueueFromFile(queuePath);
      expect(result.items).toEqual([]);
      expect(result.version).toBe(0);
    });

    it('should load queue from valid JSON file', async () => {
      const data = {
        version: 5,
        items: [
          { id: 'uuid1', source: 'test prompt', createdAt: '2026-03-03T10:00:00Z' },
        ],
      };
      await writeFile(queuePath, JSON.stringify(data), 'utf-8');

      const result = await loadQueueFromFile(queuePath);
      expect(result.version).toBe(5);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].source).toBe('test prompt');
    });

    it('should recover empty queue if file is corrupted JSON', async () => {
      await writeFile(queuePath, '{ invalid json !!!', 'utf-8');

      const result = await loadQueueFromFile(queuePath);
      expect(result.items).toEqual([]);
      expect(result.version).toBe(0);
    });

    it('should recover empty queue if file has invalid structure', async () => {
      await writeFile(queuePath, JSON.stringify({ foo: 'bar' }), 'utf-8');

      const result = await loadQueueFromFile(queuePath);
      expect(result.items).toEqual([]);
      expect(result.version).toBe(0);
    });
  });

  describe('saveQueueToFile', () => {
    it('should save queue to JSON file', async () => {
      const items: QueuedPrompt[] = [
        { id: 'uuid1', source: 'prompt 1', createdAt: '2026-03-03T10:00:00Z' },
        { id: 'uuid2', source: 'prompt 2', createdAt: '2026-03-03T10:01:00Z' },
      ];

      await saveQueueToFile(queuePath, items, 3);

      const content = await readFile(queuePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.version).toBe(3);
      expect(parsed.items).toHaveLength(2);
      expect(parsed.items[0].id).toBe('uuid1');
    });

    it('should create parent directory if not exists', async () => {
      const nestedPath = path.join(tempDir, 'nested', 'dir', '.prompt-queue.json');
      const items: QueuedPrompt[] = [];

      await saveQueueToFile(nestedPath, items, 0);

      const content = await readFile(nestedPath, 'utf-8');
      expect(JSON.parse(content)).toEqual({ version: 0, items: [] });
    });

    it('should preserve images in queue items', async () => {
      const items: QueuedPrompt[] = [
        {
          id: 'uuid1',
          source: 'prompt with image',
          images: [{ media_type: 'image/png', data: 'base64data...' }],
          createdAt: '2026-03-03T10:00:00Z',
        },
      ];

      await saveQueueToFile(queuePath, items, 1);

      const content = await readFile(queuePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.items[0].images).toHaveLength(1);
      expect(parsed.items[0].images[0].media_type).toBe('image/png');
    });
  });

  describe('createDebouncedSaver', () => {
    it('should debounce multiple saves within interval', async () => {
      let saveCount = 0;
      const mockSave = async () => { saveCount++; };
      const debouncedSave = createDebouncedSaver(mockSave, 100);

      // Call multiple times rapidly
      debouncedSave();
      debouncedSave();
      debouncedSave();

      // Wait for debounce
      await new Promise((r) => setTimeout(r, 150));

      expect(saveCount).toBe(1);
    });

    it('should save with latest data after debounce', async () => {
      const savedVersions: number[] = [];
      const mockSave = async (version: number) => { savedVersions.push(version); };
      const debouncedSave = createDebouncedSaver(mockSave, 100);

      debouncedSave(1);
      debouncedSave(2);
      debouncedSave(3);

      await new Promise((r) => setTimeout(r, 150));

      expect(savedVersions).toEqual([3]); // Only last version saved
    });

    it('should allow immediate flush', async () => {
      let saveCount = 0;
      const mockSave = async () => { saveCount++; };
      const debouncedSave = createDebouncedSaver(mockSave, 500);

      debouncedSave();
      await debouncedSave.flush();

      expect(saveCount).toBe(1);
    });
  });

  describe('Performance', () => {
    it('should write queue file in < 50ms for 30 items', async () => {
      const items: QueuedPrompt[] = Array.from({ length: 30 }, (_, i) => ({
        id: `uuid-${i}`,
        source: `This is a test prompt number ${i} with some reasonable length content`,
        createdAt: new Date().toISOString(),
      }));

      const start = Date.now();
      await saveQueueToFile(queuePath, items, 1);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
    });
  });
});
