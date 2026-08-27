/**
 * Strips metadata segments from a JPEG.
 *
 * A photo of her drawing (or any camera image) can carry EXIF with GPS
 * coordinates, a device serial, and a timestamp. None of that may ever reach
 * the public site, so cover art is rewritten through here on the way into
 * docs/ — keeping only the image data itself.
 */
const DROP = new Set([
  0xe1, // APP1  — EXIF, XMP
  0xe2, // APP2  — ICC/FlashPix
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec,
  0xed, // APP13 — IPTC, Photoshop
  0xee, 0xef,
  0xfe, // COM   — comments
]);

export function stripJpegMetadata(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return buffer; // not a JPEG

  const out = [buffer.subarray(0, 2)];
  let i = 2;

  while (i < buffer.length - 1) {
    if (buffer[i] !== 0xff) break;
    const marker = buffer[i + 1];

    // Start of scan: the rest is entropy-coded image data, copy it verbatim.
    if (marker === 0xda) {
      out.push(buffer.subarray(i));
      break;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      out.push(buffer.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const length = buffer.readUInt16BE(i + 2);
    if (!DROP.has(marker)) out.push(buffer.subarray(i, i + 2 + length));
    i += 2 + length;
  }
  return Buffer.concat(out);
}

/** True if the JPEG still carries a metadata segment we care about. */
export function hasJpegMetadata(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return false;
  let i = 2;
  while (i < buffer.length - 1) {
    if (buffer[i] !== 0xff) return false;
    const marker = buffer[i + 1];
    if (marker === 0xda) return false;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
    if (DROP.has(marker)) return true;
    i += 2 + buffer.readUInt16BE(i + 2);
  }
  return false;
}
