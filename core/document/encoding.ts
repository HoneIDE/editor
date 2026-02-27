/**
 * File encoding detection (UTF-8, UTF-16 LE/BE, ISO-8859-1) and conversion.
 *
 * Detection strategy:
 * 1. Check for BOM (byte order mark)
 * 2. Heuristic analysis of first 8KB
 * 3. Default to UTF-8
 */

export type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'iso-8859-1';

export interface EncodingDetectionResult {
  encoding: Encoding;
  hasBOM: boolean;
}

/**
 * Detect encoding from raw file bytes.
 */
export function detectEncoding(bytes: Uint8Array): EncodingDetectionResult {
  // Check for BOM
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return { encoding: 'utf-8', hasBOM: true };
  }
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return { encoding: 'utf-16le', hasBOM: true };
  }
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return { encoding: 'utf-16be', hasBOM: true };
  }

  // Heuristic: scan first 8KB
  const scanLength = Math.min(bytes.length, 8192);

  // Check for null bytes (suggests UTF-16)
  let nullBytes = 0;
  let evenNulls = 0;
  let oddNulls = 0;
  for (let i = 0; i < scanLength; i++) {
    if (bytes[i] === 0) {
      nullBytes++;
      if (i % 2 === 0) evenNulls++;
      else oddNulls++;
    }
  }

  if (nullBytes > scanLength * 0.1) {
    // High null byte ratio suggests UTF-16
    if (oddNulls > evenNulls * 2) {
      return { encoding: 'utf-16le', hasBOM: false };
    }
    if (evenNulls > oddNulls * 2) {
      return { encoding: 'utf-16be', hasBOM: false };
    }
  }

  // Validate UTF-8 sequences
  if (isValidUtf8(bytes, scanLength)) {
    return { encoding: 'utf-8', hasBOM: false };
  }

  // Fallback to ISO-8859-1
  return { encoding: 'iso-8859-1', hasBOM: false };
}

function isValidUtf8(bytes: Uint8Array, length: number): boolean {
  let i = 0;
  while (i < length) {
    const byte = bytes[i];
    if (byte < 0x80) {
      i++;
    } else if ((byte & 0xE0) === 0xC0) {
      if (i + 1 >= length) break;
      if ((bytes[i + 1] & 0xC0) !== 0x80) return false;
      i += 2;
    } else if ((byte & 0xF0) === 0xE0) {
      if (i + 2 >= length) break;
      if ((bytes[i + 1] & 0xC0) !== 0x80 || (bytes[i + 2] & 0xC0) !== 0x80) return false;
      i += 3;
    } else if ((byte & 0xF8) === 0xF0) {
      if (i + 3 >= length) break;
      if ((bytes[i + 1] & 0xC0) !== 0x80 || (bytes[i + 2] & 0xC0) !== 0x80 || (bytes[i + 3] & 0xC0) !== 0x80) return false;
      i += 4;
    } else {
      return false;
    }
  }
  return true;
}

/**
 * Decode bytes to string using the specified encoding.
 */
export function decodeBytes(bytes: Uint8Array, encoding: Encoding, hasBOM: boolean): string {
  let data = bytes;
  // Strip BOM if present
  if (hasBOM) {
    if (encoding === 'utf-8') data = bytes.subarray(3);
    else data = bytes.subarray(2);
  }

  switch (encoding) {
    case 'utf-8':
      return new TextDecoder('utf-8').decode(data);
    case 'utf-16le':
      return new TextDecoder('utf-16le').decode(data);
    case 'utf-16be':
      return new TextDecoder('utf-16be').decode(data);
    case 'iso-8859-1':
      return new TextDecoder('iso-8859-1').decode(data);
  }
}

/**
 * Encode a string to bytes using the specified encoding.
 */
export function encodeString(text: string, encoding: Encoding): Uint8Array {
  switch (encoding) {
    case 'utf-8':
      return new TextEncoder().encode(text);
    case 'utf-16le': {
      const buf = new ArrayBuffer(text.length * 2);
      const view = new DataView(buf);
      for (let i = 0; i < text.length; i++) {
        view.setUint16(i * 2, text.charCodeAt(i), true); // little-endian
      }
      return new Uint8Array(buf);
    }
    case 'utf-16be': {
      const buf = new ArrayBuffer(text.length * 2);
      const view = new DataView(buf);
      for (let i = 0; i < text.length; i++) {
        view.setUint16(i * 2, text.charCodeAt(i), false); // big-endian
      }
      return new Uint8Array(buf);
    }
    case 'iso-8859-1': {
      const result = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) {
        result[i] = text.charCodeAt(i) & 0xFF;
      }
      return result;
    }
  }
}

/**
 * Detect line ending style from text content.
 * Scans first 1000 lines and uses majority.
 */
export function detectLineEnding(text: string): '\n' | '\r\n' | '\r' {
  let crlfCount = 0;
  let lfCount = 0;
  let crCount = 0;
  let linesSeen = 0;

  for (let i = 0; i < text.length && linesSeen < 1000; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 13) { // \r
      if (i + 1 < text.length && text.charCodeAt(i + 1) === 10) {
        crlfCount++;
        i++; // skip \n
      } else {
        crCount++;
      }
      linesSeen++;
    } else if (ch === 10) { // \n
      lfCount++;
      linesSeen++;
    }
  }

  if (crlfCount > lfCount && crlfCount > crCount) return '\r\n';
  if (crCount > lfCount && crCount > crlfCount) return '\r';
  return '\n';
}
