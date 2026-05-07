export interface PastedImage {
  media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  data: string;       // base64 (no data: prefix)
  preview: string;    // data:URL for <img> src
}

/** Image reference stored in notebook (path only, no embedded data) */
export interface ImageRef {
  path: string;       // relative path in workspace, e.g. ".images/1234567890-abc123.png"
  preview: string;    // data:URL for UI display (not persisted)
}

export interface ExtractResult {
  images: PastedImage[];
  skippedTypes: string[];  // unsupported types that were skipped
}

// Supported media types (must match server-side PromptImageSchema enum)
export const SUPPORTED_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

export const MAX_IMAGES = 5;
export const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export async function extractImagesFromClipboard(
  e: React.ClipboardEvent,
): Promise<ExtractResult> {
  const items = Array.from(e.clipboardData.items);
  const allImageItems = items.filter((item) => item.type.startsWith('image/'));
  const skippedTypes = allImageItems
    .filter((item) => !SUPPORTED_MEDIA_TYPES.has(item.type))
    .map((item) => item.type.replace('image/', '').toUpperCase());
  const supportedItems = allImageItems
    .filter((item) => SUPPORTED_MEDIA_TYPES.has(item.type))
    .slice(0, MAX_IMAGES);

  const images: PastedImage[] = [];
  for (const item of supportedItems) {
    const blob = item.getAsFile();
    if (!blob || blob.size > MAX_SIZE_BYTES) continue;
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    // Use blob.type as fallback - item.type can become empty after getAsFile() in some browsers
    const mediaType = (item.type || blob.type) as PastedImage['media_type'];
    images.push({
      media_type: mediaType,
      data: base64,
      preview: `data:${mediaType};base64,${base64}`,
    });
  }
  return { images, skippedTypes: [...new Set(skippedTypes)] };
}

/**
 * Upload a pasted image to the server and return an ImageRef.
 */
export async function uploadPromptImage(
  sessionId: string,
  image: PastedImage,
): Promise<ImageRef> {
  const res = await fetch(`/api/notebooks/${sessionId}/files/prompt-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ media_type: image.media_type, data: image.data }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Upload failed (${res.status})`);
  }

  const { path } = (await res.json()) as { path: string };
  return { path, preview: image.preview };
}
