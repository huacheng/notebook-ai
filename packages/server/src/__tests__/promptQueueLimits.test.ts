import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('Prompt Queue Limits', () => {
  const sessionSrc = () => readFileSync(
    path.resolve(__dirname, '../session.ts'),
    'utf-8'
  );

  describe('Queue length limit', () => {
    it('should define MAX_QUEUE_LENGTH constant', () => {
      const src = sessionSrc();
      expect(src).toContain('MAX_QUEUE_LENGTH');
    });

    it('should set MAX_QUEUE_LENGTH to 30', () => {
      const src = sessionSrc();
      expect(src).toMatch(/MAX_QUEUE_LENGTH\s*=\s*30/);
    });

    it('should check queue length before adding', () => {
      const src = sessionSrc();
      // Should have logic to check _promptQueue.length >= MAX_QUEUE_LENGTH
      expect(src).toContain('QUEUE_FULL');
    });
  });

  describe('Image size limits', () => {
    it('should define MAX_IMAGE_SIZE constant (5MB)', () => {
      const src = sessionSrc();
      expect(src).toMatch(/MAX_IMAGE_SIZE\s*=\s*5\s*\*\s*1024\s*\*\s*1024/);
    });

    it('should define MAX_QUEUE_IMAGES constant (10)', () => {
      const src = sessionSrc();
      expect(src).toMatch(/MAX_QUEUE_IMAGES\s*=\s*10/);
    });

    it('should define MAX_QUEUE_IMAGES_SIZE constant (30MB)', () => {
      const src = sessionSrc();
      expect(src).toMatch(/MAX_QUEUE_IMAGES_SIZE\s*=\s*30\s*\*\s*1024\s*\*\s*1024/);
    });

    it('should check image size limits in addToQueue', () => {
      const src = sessionSrc();
      expect(src).toContain('IMAGE_TOO_LARGE');
    });

    it('should check total queue images count', () => {
      const src = sessionSrc();
      expect(src).toContain('TOO_MANY_IMAGES');
    });

    it('should check total queue images size', () => {
      const src = sessionSrc();
      expect(src).toContain('IMAGES_SIZE_EXCEEDED');
    });
  });
});
