import { randomUUID, createHash } from "node:crypto";
import { zipSync } from "fflate";
import sharp from "sharp";
export const hash = (b) => createHash("sha256").update(b).digest("hex");
export async function archive(upload, options = {}) {
  const image =
    options.image ??
    (await sharp({
      create: { width: 2, height: 2, channels: 4, background: "#4080FF" },
    })
      .png()
      .toBuffer());
  const blob = {
    sha256: hash(image),
    mime: options.mime ?? "image/png",
    bytes: image.length,
    width: options.width ?? 2,
    height: options.height ?? 2,
  };
  const expression = {
    kind: "amoji.expression",
    amoji: "0.1",
    asset_id: randomUUID(),
    revision_id: randomUUID(),
    realizes: "core:ack",
    intensity: 2,
    original_locale: "zh-CN",
    name: { "zh-CN": "理解" },
    semantics: { "zh-CN": { meaning: "我理解了", fallback: "理解" } },
    visual: { primary: blob, animated: false, text_locale: null },
    rights: { license: "CC0-1.0" },
    created_at: new Date().toISOString(),
  };
  const manifest = {
    kind: "amoji.pack",
    amoji: "0.1",
    pack_id: upload.pack_id,
    release_id: upload.release_id,
    version: upload.version,
    original_locale: "zh-CN",
    locales: ["zh-CN"],
    name: { "zh-CN": "测试包" },
    description: { "zh-CN": "用于测试的表情包" },
    expressions: [expression],
    rights: { license: "CC0-1.0" },
  };
  const extra = {};
  if (options.animated) {
    const poster = await sharp({
      create: {
        width: blob.width,
        height: blob.height,
        channels: 4,
        background: "#4080FF",
      },
    })
      .png()
      .toBuffer();
    const posterBlob = {
      sha256: hash(poster),
      mime: "image/png",
      bytes: poster.length,
      width: blob.width,
      height: blob.height,
    };
    expression.visual = {
      primary: blob,
      animated: true,
      duration_ms: options.duration ?? 20,
      poster: posterBlob,
      text_locale: null,
    };
    extra["blobs/" + posterBlob.sha256] = poster;
  }
  options.mutate?.(manifest);
  const files = {
    "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
    ["blobs/" + blob.sha256]: image,
    ...extra,
    ...options.extra,
  };
  return {
    bytes: zipSync(files, { level: options.compression ?? 0 }),
    manifest,
    image,
  };
}
/** Legal unknown PNG ancillary chunks make exact byte boundaries compressible in transport. */
export async function byteBoundaryArchive(upload, kind, extra = 0) {
  const { crc32 } = await import("node:zlib");
  const seed = await archive(upload);
  const count = kind === "archive" ? 10 : 16;
  const sizes = Array(count).fill(1024 * 1024);
  const expressions = Array.from({ length: count }, () => ({
    ...structuredClone(seed.manifest.expressions[0]),
    asset_id: randomUUID(),
    revision_id: randomUUID(),
  }));
  const manifest = { ...seed.manifest, expressions };
  const render = () => {
    const files = {};
    expressions.forEach((expression, index) => {
      const data = Buffer.alloc(sizes[index] - seed.image.length - 12);
      data[0] = index;
      const typeAndData = Buffer.concat([Buffer.from("aaAa"), data]);
      const length = Buffer.alloc(4),
        crc = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      crc.writeUInt32BE(crc32(typeAndData));
      const image = Buffer.concat([
        seed.image.subarray(0, -12),
        length,
        typeAndData,
        crc,
        seed.image.subarray(-12),
      ]);
      expression.visual.primary = {
        ...expression.visual.primary,
        sha256: hash(image),
        bytes: image.length,
      };
      files["blobs/" + hash(image)] = image;
    });
    files["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest));
    const bytes = zipSync(files, { level: kind === "archive" ? 0 : 6 });
    return {
      bytes,
      expanded: Object.values(files).reduce((sum, b) => sum + b.length, 0),
    };
  };
  const target = (kind === "archive" ? 10 : 16) * 1024 * 1024 + extra;
  let result = render();
  for (let i = 0; i < 3; i++) {
    const actual = kind === "archive" ? result.bytes.length : result.expanded;
    if (actual === target) return result;
    sizes[count - 1] += target - actual;
    result = render();
  }
  throw Error("Boundary fixture did not converge");
}
