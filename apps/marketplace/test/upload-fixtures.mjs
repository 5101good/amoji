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
    schema_version: "0.1",
    asset_id: randomUUID(),
    revision_id: randomUUID(),
    name: "理解",
    created_at: new Date().toISOString(),
    semantics: { locale: "zh-CN", meaning: "我理解了", fallback: "理解" },
    visual: { primary: blob, animated: false },
    rights: { license: "CC0-1.0" },
  };
  const manifest = {
    kind: "amoji.pack",
    schema_version: "0.2",
    pack_id: upload.pack_id,
    release_id: upload.release_id,
    version: upload.version,
    name: "测试包",
    created_at: new Date().toISOString(),
    scenario: ["协作"],
    expressions: [expression],
    defaults: [
      { asset_id: expression.asset_id, revision_id: expression.revision_id },
    ],
    actions: [],
    bindings: [],
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
