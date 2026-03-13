import { describe, it, expect } from 'vitest';
import { extractImagesFromClipboard, MAX_IMAGES, MAX_SIZE_BYTES } from '../utils/pasteImages';

function makeClipboardEvent(items: Array<{ type: string; blob: Blob }>): React.ClipboardEvent {
  const clipboardItems = items.map(({ type, blob }) => ({
    kind: 'file' as const,
    type,
    getAsFile: () => blob as unknown as File,
    getAsString: () => {},
    webkitGetAsEntry: () => null,
  }));

  return {
    clipboardData: {
      items: clipboardItems as unknown as DataTransferItemList,
    },
    preventDefault: () => {},
  } as unknown as React.ClipboardEvent;
}

function makePngBlob(sizeBytes = 100): Blob {
  return new Blob([new Uint8Array(sizeBytes)], { type: 'image/png' });
}

describe('extractImagesFromClipboard', () => {
  it('extracts PNG from clipboard', async () => {
    const event = makeClipboardEvent([{ type: 'image/png', blob: makePngBlob() }]);
    const { images } = await extractImagesFromClipboard(event);
    expect(images).toHaveLength(1);
    expect(images[0].media_type).toBe('image/png');
    expect(images[0].data.length).toBeGreaterThan(0);
    expect(images[0].preview).toMatch(/^data:image\/png;base64,/);
  });

  it('ignores non-image items', async () => {
    const textBlob = new Blob(['hello'], { type: 'text/plain' });
    const event = makeClipboardEvent([{ type: 'text/plain', blob: textBlob }]);
    const { images } = await extractImagesFromClipboard(event);
    expect(images).toHaveLength(0);
  });

  it('handles multiple images', async () => {
    const event = makeClipboardEvent([
      { type: 'image/png', blob: makePngBlob() },
      { type: 'image/jpeg', blob: new Blob([new Uint8Array(50)], { type: 'image/jpeg' }) },
    ]);
    const { images } = await extractImagesFromClipboard(event);
    expect(images).toHaveLength(2);
  });

  it('limits to MAX_IMAGES', async () => {
    const items = Array.from({ length: MAX_IMAGES + 3 }, () => ({
      type: 'image/png',
      blob: makePngBlob(),
    }));
    const event = makeClipboardEvent(items);
    const { images } = await extractImagesFromClipboard(event);
    expect(images).toHaveLength(MAX_IMAGES);
  });

  it('skips images over MAX_SIZE_BYTES', async () => {
    const bigBlob = makePngBlob(MAX_SIZE_BYTES + 1);
    const smallBlob = makePngBlob(100);
    const event = makeClipboardEvent([
      { type: 'image/png', blob: bigBlob },
      { type: 'image/png', blob: smallBlob },
    ]);
    const { images } = await extractImagesFromClipboard(event);
    expect(images).toHaveLength(1);
    // Only the small one should be included
  });

  // Bug fix: unsupported media types should be filtered out and reported
  it('filters out unsupported image types and reports them', async () => {
    const event = makeClipboardEvent([
      { type: 'image/bmp', blob: new Blob([new Uint8Array(50)], { type: 'image/bmp' }) },
      { type: 'image/svg+xml', blob: new Blob(['<svg></svg>'], { type: 'image/svg+xml' }) },
      { type: 'image/tiff', blob: new Blob([new Uint8Array(50)], { type: 'image/tiff' }) },
      { type: 'image/png', blob: makePngBlob() }, // This one should be included
    ]);
    const { images, skippedTypes } = await extractImagesFromClipboard(event);
    expect(images).toHaveLength(1);
    expect(images[0].media_type).toBe('image/png');
    expect(skippedTypes).toEqual(['BMP', 'SVG+XML', 'TIFF']);
  });

  it('accepts all supported types: png, jpeg, gif, webp', async () => {
    const event = makeClipboardEvent([
      { type: 'image/png', blob: new Blob([new Uint8Array(50)], { type: 'image/png' }) },
      { type: 'image/jpeg', blob: new Blob([new Uint8Array(50)], { type: 'image/jpeg' }) },
      { type: 'image/gif', blob: new Blob([new Uint8Array(50)], { type: 'image/gif' }) },
      { type: 'image/webp', blob: new Blob([new Uint8Array(50)], { type: 'image/webp' }) },
    ]);
    const { images, skippedTypes } = await extractImagesFromClipboard(event);
    expect(images).toHaveLength(4);
    expect(images.map(r => r.media_type)).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
    expect(skippedTypes).toEqual([]);
  });
});
