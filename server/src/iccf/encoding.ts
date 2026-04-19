import iconv from 'iconv-lite'

/** URL-encode a JS string as Big5 bytes (for iccf form submission). */
export function encodeBig5URIComponent(input: string): string {
  const buf = iconv.encode(input, 'big5')
  let out = ''
  for (const byte of buf) {
    if (
      (byte >= 0x30 && byte <= 0x39) ||
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      byte === 0x2d || byte === 0x2e || byte === 0x5f || byte === 0x7e
    ) {
      out += String.fromCharCode(byte)
    } else {
      out += '%' + byte.toString(16).toUpperCase().padStart(2, '0')
    }
  }
  return out
}

/** Build an x-www-form-urlencoded body with Big5-encoded values. */
export function buildBig5FormBody(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeBig5URIComponent(k)}=${encodeBig5URIComponent(v)}`)
    .join('&')
}

/** Decode a Big5 Buffer from iccf response into a UTF-8 string. */
export function decodeBig5(buffer: Buffer | ArrayBuffer | Uint8Array): string {
  const buf = Buffer.isBuffer(buffer)
    ? buffer
    : Buffer.from(buffer as ArrayBuffer)
  return iconv.decode(buf, 'big5')
}
