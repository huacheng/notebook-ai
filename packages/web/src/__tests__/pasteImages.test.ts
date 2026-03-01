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
    const result = await extractImagesFromClipboard(event);
    expect(result).toHaveLength(1);
    expect(result[0].media_type).toBe('image/png');
    expect(result[0].data.length).toBeGreaterThan(0);
    expect(result[0].preview).toMatch(/^data:image\/png;base64,/);
  });

  it('ignores non-image items', async () => {
    const textBlob = new Blob(['hello'], { type: 'text/plain' });
    const event = makeClipboardEvent([{ type: 'text/plain', blob: textBlob }]);
    const result = await extractImagesFromClipboard(event);
    expect(result).toHaveLength(0);
  });

  it('handles multiple images', async () => {
    const event = makeClipboardEvent([
      { type: 'image/png', blob: makePngBlob() },
      { type: 'image/jpeg', blob: new Blob([new Uint8Array(50)], { type: 'image/jpeg' }) },
    ]);
    const result = await extractImagesFromClipboard(event);
    expect(result).toHaveLength(2);
  });

  it('limits to MAX_IMAGES', async () => {
    const items = Array.from({ length: MAX_IMAGES + 3 }, () => ({
      type: 'image/png',
      blob: makePngBlob(),
    }));
    const event = makeClipboardEvent(items);
    const result = await extractImagesFromClipboard(event);
    expect(result).toHaveLength(MAX_IMAGES);
  });

  it('skips images over MAX_SIZE_BYTES', async () => {
    const bigBlob = makePngBlob(MAX_SIZE_BYTES + 1);
    const smallBlob = makePngBlob(100);
    const event = makeClipboardEvent([
      { type: 'image/png', blob: bigBlob },
      { type: 'image/png', blob: smallBlob },
    ]);
    const result = await extractImagesFromClipboard(event);
    expect(result).toHaveLength(1);
    // Only the small one should be included
  });
});
