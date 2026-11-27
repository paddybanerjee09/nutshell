import { crc32 } from "node:zlib";
import sharp from "sharp";

export const maxRasterUploadBytes = 8 * 1024 * 1024;
export const maxRasterOutputBytes = 8 * 1024 * 1024;
export const maxRasterEdge = 4096;
export const maxRasterPixels = 12_000_000;

const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const maximumChunks = 4096;
const dimensionsError = "Image dimensions may not exceed 4096 pixels per side or 12 megapixels.";

export type RasterMimeType = "image/png" | "image/jpeg" | "image/webp";
export type SanitizedRaster = { mimeType: RasterMimeType; bytes: Buffer; width: number; height: number };

export class InvalidRasterError extends Error {}

export function isRasterMimeType(value: string): value is RasterMimeType {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp";
}

function singlePng(bytes: Buffer): Buffer | undefined {
  if (!bytes.subarray(0, 8).equals(pngSignature) || bytes.length < 33
    || bytes.readUInt32BE(8) !== 13 || bytes.toString("latin1", 12, 16) !== "IHDR") return;
  let offset = 8;
  let keptFrom = 0;
  const sections: Buffer[] = [];
  for (let chunk = 0; chunk < maximumChunks && offset + 12 <= bytes.length; chunk++) {
    const start = offset;
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    offset += 12 + length;
    if (offset > bytes.length || type === "acTL" || type === "fcTL" || type === "fdAT") return;
    if (crc32(bytes.subarray(start + 4, offset - 4)) !== bytes.readUInt32BE(offset - 4)) return;
    if (type === "IHDR" && start === 8 && !withinDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20))) {
      throw new InvalidRasterError(dimensionsError);
    }
    // Remove metadata chunks that can expand independently of the pixel budget.
    if (type === "iCCP" || type === "zTXt" || type === "iTXt") {
      sections.push(bytes.subarray(keptFrom, start));
      keptFrom = offset;
    }
    if (type === "IEND") {
      if (length !== 0 || offset !== bytes.length) return;
      return sections.length ? Buffer.concat([...sections, bytes.subarray(keptFrom)]) : bytes;
    }
  }
}

function singleJpeg(bytes: Buffer): boolean {
  if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return false;
  let offset = 2;
  let decodingScan = false;
  let hasScan = false;
  let segments = 0;
  while (offset < bytes.length) {
    if (decodingScan) offset = bytes.indexOf(0xFF, offset);
    if (offset < 0 || bytes[offset] !== 0xFF) return false;
    while (bytes[offset] === 0xFF) offset++;
    const marker = bytes[offset++];
    const restart = marker !== undefined && marker >= 0xD0 && marker <= 0xD7;
    if (decodingScan && (marker === 0x00 || restart)) continue;
    if (marker === 0xD9) return hasScan && offset === bytes.length;
    if (++segments > maximumChunks || offset + 2 > bytes.length || restart
      || marker === undefined || marker === 0x00 || marker === 0x01 || marker === 0xD8) return false;

    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    // MPO carries several pictures in a JPEG container under an APP2 MPF segment.
    if (marker === 0xE2 && length >= 6 && bytes.toString("latin1", offset + 2, offset + 6) === "MPF\0") return false;
    hasScan ||= marker === 0xDA;
    decodingScan = marker === 0xDA || (decodingScan && marker === 0xDC);
    offset += length;
  }
  return false;
}

function singleWebp(bytes: Buffer): boolean {
  if (bytes.length < 20 || bytes.toString("latin1", 0, 4) !== "RIFF"
    || bytes.toString("latin1", 8, 12) !== "WEBP" || bytes.readUInt32LE(4) !== bytes.length - 8) return false;
  let offset = 12;
  let hasFrame = false;
  let hasExtendedHeader = false;
  for (let chunk = 0; chunk < maximumChunks && offset + 8 <= bytes.length; chunk++) {
    const type = bytes.toString("latin1", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const next = offset + 8 + length + (length % 2);
    if (next > bytes.length || type === "ANIM" || type === "ANMF") return false;
    if (type === "VP8X") {
      if (offset !== 12 || length !== 10 || ((bytes[offset + 8] ?? 0) & 0x02) !== 0) return false;
      hasExtendedHeader = true;
    } else if (type === "VP8 " || type === "VP8L") {
      if (hasFrame || (offset !== 12 && !hasExtendedHeader)) return false;
      hasFrame = true;
    } else if (offset === 12) {
      return false;
    }
    if (next === bytes.length) return hasFrame;
    offset = next;
  }
  return false;
}

const formats = {
  "image/png": { format: "png", prepare: singlePng, options: {} },
  "image/jpeg": { format: "jpeg", prepare: (bytes: Buffer) => singleJpeg(bytes) ? bytes : undefined, options: { quality: 90 } },
  "image/webp": { format: "webp", prepare: (bytes: Buffer) => singleWebp(bytes) ? bytes : undefined, options: { lossless: true } },
} as const;

function withinDimensions(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
    && width <= maxRasterEdge && height <= maxRasterEdge && width * height <= maxRasterPixels;
}

export async function sanitizeRaster(input: Uint8Array, declaredMime: string): Promise<SanitizedRaster> {
  if (!isRasterMimeType(declaredMime)) throw new InvalidRasterError("Use PNG, JPEG, or WebP.");
  if (input.byteLength === 0 || input.byteLength > maxRasterUploadBytes) {
    throw new InvalidRasterError("Upload an image no larger than 8 MiB.");
  }
  const { format, prepare, options } = formats[declaredMime];
  const bytes = prepare(Buffer.from(input));
  if (!bytes) throw new InvalidRasterError("Use one complete PNG, JPEG, or WebP image matching its declared file type.");

  try {
    const image = sharp(bytes, { failOn: "warning", limitInputPixels: maxRasterPixels, limitInputChannels: 4, pages: 1, ignoreIcc: true });
    const metadata = await image.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) !== 1) throw new InvalidRasterError("Upload a single-frame image.");
    if (!withinDimensions(metadata.width, metadata.height)) {
      throw new InvalidRasterError(dimensionsError);
    }
    const output = await image.autoOrient().toFormat(format, options).timeout({ seconds: 15 }).toBuffer({ resolveWithObject: true });
    if (output.data.byteLength > maxRasterOutputBytes) throw new InvalidRasterError("The clean image exceeds the 8 MiB storage limit.");
    return { mimeType: declaredMime, bytes: output.data, width: output.info.width, height: output.info.height };
  } catch (error) {
    if (error instanceof InvalidRasterError) throw error;
    throw new InvalidRasterError("The image could not be decoded. Upload a complete, valid raster file.");
  }
}
