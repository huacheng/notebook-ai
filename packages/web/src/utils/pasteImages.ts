export interface PastedImage {
  media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  data: string;       // base64 (no data: prefix)
  preview: string;    // data:URL for <img> src
}

export const MAX_IMAGES = 5;
export const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export async function extractImagesFromClipboard(
  e: React.ClipboardEvent,
): Promise<PastedImage[]> {
  const items = Array.from(e.clipboardData.items);
  const imageItems = items
    .filter((item) => item.type.startsWith('image/'))
    .slice(0, MAX_IMAGES);

  const results: PastedImage[] = [];
  for (const item of imageItems) {
    const blob = item.getAsFile();
    if (!blob || blob.size > MAX_SIZE_BYTES) continue;
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const mediaType = item.type as PastedImage['media_type'];
    results.push({
      media_type: mediaType,
      data: base64,
      preview: `data:${mediaType};base64,${base64}`,
    });
  }
  return results;
}
