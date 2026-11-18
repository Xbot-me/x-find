/** Reads pixel dimensions from image bytes (PNG, JPEG, GIF, WebP, SVG) without decoding. Returns null if unknown. */
export function imageSize(data: Uint8Array): { width: number; height: number; type: string } | null {
  const b = data;
  const u16be = (i: number) => (b[i]! << 8) | b[i + 1]!;
  const u16le = (i: number) => b[i]! | (b[i + 1]! << 8);
  const u24le = (i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
  const u32be = (i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
  const ascii = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));

  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === 'PNG')
    return { width: u32be(16), height: u32be(20), type: 'png' };
  if (b.length >= 10 && ascii(0, 3) === 'GIF') return { width: u16le(6), height: u16le(8), type: 'gif' };
  if (b.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff, type: 'webp' };
    if (chunk === 'VP8L') {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, type: 'webp' };
    }
    if (chunk === 'VP8X') return { width: u24le(24) + 1, height: u24le(27) + 1, type: 'webp' };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      const len = u16be(i + 2);
      // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: u16be(i + 7), height: u16be(i + 5), type: 'jpeg' };
      }
      i += 2 + len;
    }
    return null;
  }
  const head = new TextDecoder().decode(b.slice(0, 4096));
  const svg = /<svg\b[^>]*>/i.exec(head);
  if (svg) {
    const tag = svg[0];
    const num = (name: string) => {
      const m = new RegExp(`\\s${name}\\s*=\\s*["']?\\s*([0-9.]+)(px)?\\s*["']?`, 'i').exec(tag);
      return m ? Number(m[1]) : null;
    };
    let width = num('width');
    let height = num('height');
    const vb = /viewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i.exec(tag);
    if ((width === null || height === null) && vb) {
      width ??= Number(vb[1]);
      height ??= Number(vb[2]);
    }
    if (width !== null && height !== null) return { width, height, type: 'svg' };
    return { width: Infinity, height: Infinity, type: 'svg' };
  }
  return null;
}
