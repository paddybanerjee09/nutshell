import { crc32, deflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { InvalidRasterError, maxRasterUploadBytes, sanitizeRaster } from "./raster.ts";

function createImage() {
  return sharp({ create: { channels: 3, width: 24, height: 16, background: "#7f6df2" } });
}

function insertPngChunk(png: Buffer, type: string, payload: Buffer): Buffer {
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length);
  chunk.write(type, 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, chunk.length - 4)), chunk.length - 4);
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}

describe("private raster upload validation", () => {
  it("decodes and re-encodes PNG, JPEG and WebP without embedded metadata", async () => {
    const png = await createImage().png().toBuffer();
    const jpeg = await createImage().jpeg({ progressive: true }).withMetadata({ orientation: 6 }).toBuffer();
    const webp = await createImage().webp().toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();

    for (const [bytes, mimeType, format, width, height] of [
      [png, "image/png", "png", 24, 16],
      [jpeg, "image/jpeg", "jpeg", 16, 24],
      [webp, "image/webp", "webp", 24, 16],
    ] as const) {
      const output = await sanitizeRaster(bytes, mimeType);
      expect(output).toMatchObject({ mimeType, width, height });
      const metadata = await sharp(output.bytes).metadata();
      expect(metadata).toMatchObject({ format, width, height });
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
    }

    const tagged = insertPngChunk(png, "zTXt", Buffer.concat([Buffer.from("Comment\0\0"), deflateSync("Private text")]));
    const cleaned = await sanitizeRaster(tagged, "image/png");
    expect(cleaned.bytes).toEqual((await sanitizeRaster(png, "image/png")).bytes);
    tagged.writeUInt8(tagged.readUInt8(45) ^ 1, 45);
    await expect(sanitizeRaster(tagged, "image/png")).rejects.toBeInstanceOf(InvalidRasterError);
  });

  it("rejects unsupported, MIME-mismatched, truncated, and corrupt image inputs", async () => {
    const png = await createImage().png().toBuffer();
    const damaged = Buffer.from(png);
    const idat = damaged.indexOf("IDAT") + 4;
    damaged.writeUInt8(damaged.readUInt8(idat) ^ 0xFF, idat);
    for (const [bytes, mime] of [
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/svg+xml"],
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/png"],
      [png, "image/jpeg"], [png.subarray(0, png.length - 1), "image/png"], [damaged, "image/png"],
      [Buffer.concat([png, Buffer.from("extra bytes")]), "image/png"],
    ] as const) await expect(sanitizeRaster(bytes, mime)).rejects.toBeInstanceOf(InvalidRasterError);
  });

  it("rejects multiple image frames including APNG, animated WebP and concatenated JPEG", async () => {
    const png = await createImage().png().toBuffer();
    const control = Buffer.alloc(8);
    control.writeUInt32BE(2);
    const apng = insertPngChunk(png, "acTL", control);
    await expect(sanitizeRaster(apng, "image/png")).rejects.toBeInstanceOf(InvalidRasterError);

    const frames = Buffer.concat([Buffer.alloc(8 * 8 * 3, 24), Buffer.alloc(8 * 8 * 3, 240)]);
    const animated = await sharp(frames, { raw: { width: 8, height: 16, channels: 3, pageHeight: 8 } })
      .webp({ delay: [100, 100] }).toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    await expect(sanitizeRaster(animated, "image/webp")).rejects.toBeInstanceOf(InvalidRasterError);

    const jpeg = await createImage().jpeg().toBuffer();
    await expect(sanitizeRaster(Buffer.concat([jpeg, jpeg]), "image/jpeg")).rejects.toBeInstanceOf(InvalidRasterError);
  });

  it("enforces compressed input bytes, per-edge and total pixel limits", async () => {
    await expect(sanitizeRaster(Buffer.alloc(maxRasterUploadBytes + 1), "image/png")).rejects.toThrow("8 MiB");
    const png = await createImage().png().toBuffer();
    for (const [width, height] of [[4097, 1], [3500, 3500]] as const) {
      const oversized = Buffer.from(png);
      oversized.writeUInt32BE(width, 16);
      oversized.writeUInt32BE(height, 20);
      oversized.writeUInt32BE(crc32(oversized.subarray(12, 29)), 29);
      await expect(sanitizeRaster(oversized, "image/png")).rejects.toThrow("Image dimensions");
    }
  });
});
