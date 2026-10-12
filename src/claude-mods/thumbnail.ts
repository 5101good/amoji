import sharp from "sharp";
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Native Markdown shares a 100k text budget across one Pane. Gallery AVIF
// keeps 152 pixels (76 CSS px at 2x) without shrinking to tiny thumbnails.
// Single-image detail/message views retain 192 pixels with a larger budget.
type Profile = "gallery" | "detail";
const profileOf = (profile: Profile) => profile === "gallery"
  ? { edge: 152, maxBytes: 3350, format: "avif" as const, cache: "152-avif-v1", qualities: [65, 55, 45, 35, 25, 15] }
  : { edge: 192, maxBytes: 35000, format: "webp" as const, cache: "192-q88-v1", qualities: [88, 76, 64] };
function dataUrl(bytes: Uint8Array, format: string): string {
  return `data:image/${format};base64,${Buffer.from(bytes).toString("base64")}`;
}
async function encode(bytes: Uint8Array, profile: Profile): Promise<Buffer> {
  const spec = profileOf(profile);
  for (const quality of spec.qualities) {
    const resized = sharp(bytes, { limitInputPixels: 2048 * 2048 })
      .rotate()
      .resize(spec.edge, spec.edge, { fit: "inside", withoutEnlargement: true });
    const encoded = await (spec.format === "avif"
      ? resized.avif({ quality, effort: 4, chromaSubsampling: "4:4:4" })
      : resized.webp({ quality, alphaQuality: 100, effort: 3 })).toBuffer();
    if (encoded.length <= spec.maxBytes) return encoded;
  }
  throw new Error("PREVIEW_UNAVAILABLE");
}
export async function thumbnailImage(bytes: Uint8Array, profile: Profile = "detail"): Promise<string> {
  return dataUrl(await encode(bytes, profile), profileOf(profile).format);
}

/** Only derived pixels are cached; source digest and encoder version fix identity. */
export async function cachedThumbnailImage(
  digest: string,
  readSource: () => Promise<Uint8Array>,
  directory?: string,
  profile: Profile = "detail",
  bundledDirectory?: string,
): Promise<string> {
  const spec = profileOf(profile);
  if (!/^[a-f0-9]{64}$/.test(digest)) return thumbnailImage(await readSource(), profile);
  const filename = `${spec.cache}-${digest}.${spec.format}`;
  for (const source of [bundledDirectory, directory]) {
    if (!source) continue;
    try {
      const cached = await readFile(join(source, filename));
      if (cached.length <= spec.maxBytes) {
        const meta = await sharp(cached).metadata();
        if (meta.format === (spec.format === "avif" ? "heif" : "webp") && meta.width! <= spec.edge && meta.height! <= spec.edge)
          return dataUrl(cached, spec.format);
      }
    } catch { /* Missing or corrupt derived pixels fall back to the next source. */ }
  }
  if (!directory) return thumbnailImage(await readSource(), profile);
  const path = join(directory, filename);
  const pixels = await encode(await readSource(), profile);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(temporary, pixels, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } catch { /* A read-only cache must not prevent displaying a valid source. */ }
  finally { await unlink(temporary).catch(() => {}); }
  return dataUrl(pixels, spec.format);
}
