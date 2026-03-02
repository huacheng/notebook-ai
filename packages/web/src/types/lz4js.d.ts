declare module 'lz4js' {
  /**
   * Compress data using LZ4 block compression
   * @param input - Input data as Uint8Array
   * @returns Compressed data as Uint8Array
   */
  export function compress(input: Uint8Array): Uint8Array;

  /**
   * Decompress LZ4-compressed data
   * @param input - Compressed data as Uint8Array
   * @returns Decompressed data as Uint8Array
   */
  export function decompress(input: Uint8Array): Uint8Array;
}
