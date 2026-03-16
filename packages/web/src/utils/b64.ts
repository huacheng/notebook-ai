/** Decode a base64 string to Uint8Array — uses atob() for lower memory overhead. */
export async function b64ToUint8Array(b64: string): Promise<Uint8Array> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Encode Uint8Array to base64 string — chunked to avoid stack overflow on large arrays.
 * Using String.fromCharCode(...largeArray) causes "Maximum call stack size exceeded".
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000; // 32KB chunks to stay well under call stack limit
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}
