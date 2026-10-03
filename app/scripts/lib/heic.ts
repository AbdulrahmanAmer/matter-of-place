import convert from "heic-convert";

/** sharp's prebuilt libvips does not decode HEIC (HEVC is patent-encumbered), so an iPhone upload converts here first. */
export async function heicToJpeg(buffer: Uint8Array): Promise<Buffer> {
  return Buffer.from(await convert({ buffer, format: "JPEG", quality: 0.92 }));
}
