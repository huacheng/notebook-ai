/** Decode a base64 string to Uint8Array — uses atob() for lower memory overhead. */
export async function b64ToUint8Array(b64: string): Promise<Uint8Array> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
