/**
 * base64url helpers, shared by password hashing and session tokens.
 *
 * base64url rather than plain base64 because these values travel in cookies and
 * database text columns, where `+` and `/` are awkward.
 */

/**
 * `Uint8Array<ArrayBuffer>` rather than plain `Uint8Array`: since TypeScript 5.7
 * the latter widens to `ArrayBufferLike`, which admits `SharedArrayBuffer` and so
 * isn't assignable to WebCrypto's `BufferSource`.
 */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** SHA-256, base64url encoded. Used to store session tokens as digests. */
export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(digest));
}

/** Cryptographically random bytes, base64url encoded. */
export function randomBase64Url(byteLength: number): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}
