import { inflateRawSync, crc32 } from "node:zlib";
import { createHash } from "node:crypto";
import decoderModule from "./decoder.wasm";
import { validate01, validate02 } from "amoji-schema";
import { MARKET_LIMITS as L } from "./upload-shared";
type Media = {
  sha256: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
};
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function ensure(ok: unknown, code: string): asserts ok {
  if (!ok) throw Error(code);
}
/** No paths are extracted. Central/local headers, CRC and actual expansion are all checked. */
export function unpack(bytes: Uint8Array) {
  ensure(bytes.length <= L.archive && bytes.length >= 22, "ARCHIVE_LIMIT");
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = b.length - 22;
  while (
    end >= Math.max(0, b.length - 65557) &&
    b.readUInt32LE(end) !== 0x06054b50
  )
    end--;
  ensure(
    end >= 0 && end + 22 + b.readUInt16LE(end + 20) === b.length,
    "ZIP_END",
  );
  const count = b.readUInt16LE(end + 10),
    size = b.readUInt32LE(end + 12),
    offset = b.readUInt32LE(end + 16);
  ensure(
    b.readUInt16LE(end + 4) === 0 &&
      b.readUInt16LE(end + 6) === 0 &&
      b.readUInt16LE(end + 8) === count &&
      count > 0 &&
      count <= L.entries &&
      offset + size === end,
    "ZIP_DIRECTORY",
  );
  const files = new Map<string, Uint8Array>();
  let p = offset,
    expanded = 0;
  const spans: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    ensure(p + 46 <= end && b.readUInt32LE(p) === 0x02014b50, "ZIP_DIRECTORY");
    const flags = b.readUInt16LE(p + 8),
      method = b.readUInt16LE(p + 10),
      crc = b.readUInt32LE(p + 16),
      compressed = b.readUInt32LE(p + 20),
      length = b.readUInt32LE(p + 24),
      nl = b.readUInt16LE(p + 28),
      extra = b.readUInt16LE(p + 30),
      comment = b.readUInt16LE(p + 32),
      attributes = b.readUInt32LE(p + 38),
      local = b.readUInt32LE(p + 42);
    ensure(
      p + 46 + nl + extra + comment <= end &&
        b.readUInt16LE(p + 34) === 0 &&
        (flags & ~0x808) === 0 &&
        [0, 8].includes(method),
      "ZIP_FLAGS",
    );
    const nameBytes = b.subarray(p + 46, p + 46 + nl),
      name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes),
      mode = (attributes >>> 16) & 0xf000;
    ensure(
      /^(manifest\.json|blobs\/[a-f0-9]{64})$/.test(name) &&
        !files.has(name) &&
        (mode === 0 || mode === 0x8000) &&
        (attributes & 0x10) === 0,
      "ZIP_PATH",
    );
    const max = name === "manifest.json" ? L.manifest : L.media;
    ensure(length <= max && expanded + length <= L.expanded, "EXPANDED_LIMIT");
    ensure(
      local + 30 <= offset &&
        b.readUInt32LE(local) === 0x04034b50 &&
        b.readUInt16LE(local + 6) === flags &&
        b.readUInt16LE(local + 8) === method,
      "ZIP_LOCAL",
    );
    const lnl = b.readUInt16LE(local + 26),
      lextra = b.readUInt16LE(local + 28),
      start = local + 30 + lnl + lextra,
      finish = start + compressed;
    ensure(
      finish <= offset &&
        lnl === nl &&
        b.subarray(local + 30, local + 30 + lnl).equals(nameBytes),
      "ZIP_LOCAL",
    );
    if (!(flags & 8))
      ensure(
        b.readUInt32LE(local + 14) === crc &&
          b.readUInt32LE(local + 18) === compressed &&
          b.readUInt32LE(local + 22) === length,
        "ZIP_LOCAL",
      );
    else {
      let d = finish;
      if (d + 4 <= offset && b.readUInt32LE(d) === 0x08074b50) d += 4;
      ensure(
        d + 12 <= offset &&
          b.readUInt32LE(d) === crc &&
          b.readUInt32LE(d + 4) === compressed &&
          b.readUInt32LE(d + 8) === length,
        "ZIP_DESCRIPTOR",
      );
    }
    let spanEnd = finish;
    if (flags & 8) spanEnd += b.readUInt32LE(finish) === 0x08074b50 ? 16 : 12;
    ensure(!spans.some(([a, z]) => local < z && spanEnd > a), "ZIP_OVERLAP");
    spans.push([local, spanEnd]);
    const input = b.subarray(start, finish);
    const value =
      method === 0 ? input : inflateRawSync(input, { maxOutputLength: max });
    ensure(value.length === length && crc32(value) === crc, "ZIP_INTEGRITY");
    expanded += value.length;
    files.set(name, value);
    p += 46 + nl + extra + comment;
  }
  ensure(p === end && files.has("manifest.json"), "ZIP_DIRECTORY");
  return files;
}
type Exports = {
  memory: WebAssembly.Memory;
  alloc: (n: number) => number;
  dealloc: (p: number, n: number) => void;
  validate: (p: number, n: number) => number;
  output: (n: number) => number;
};
/** The decoder stops at GIF trailer; reject hidden trailing payload and incomplete subblocks. */
function gifFraming(b: Uint8Array) {
  ensure(b.length >= 14, "MEDIA_INVALID");
  let p = 13;
  if (b[10] & 128) p += 3 * (1 << ((b[10] & 7) + 1));
  const blocks = () => {
    for (;;) {
      ensure(p < b.length, "MEDIA_INVALID");
      const n = b[p++];
      if (!n) break;
      ensure(p + n <= b.length, "MEDIA_INVALID");
      p += n;
    }
  };
  while (p < b.length) {
    const kind = b[p++];
    if (kind === 0x3b) {
      ensure(p === b.length, "MEDIA_INVALID");
      return;
    }
    if (kind === 0x21) {
      ensure(p < b.length, "MEDIA_INVALID");
      p++;
      blocks();
    } else if (kind === 0x2c) {
      ensure(p + 9 <= b.length, "MEDIA_INVALID");
      const flags = b[p + 8];
      p += 9;
      if (flags & 128) p += 3 * (1 << ((flags & 7) + 1));
      ensure(p < b.length, "MEDIA_INVALID");
      p++;
      blocks();
    } else throw Error("MEDIA_INVALID");
  }
  throw Error("MEDIA_INVALID");
}
function decode(bytes: Uint8Array, e: Exports) {
  ensure(bytes.length > 0 && bytes.length <= L.media, "MEDIA_LIMIT");
  if (bytes[0] === 0x47) gifFraming(bytes);
  const p = e.alloc(bytes.length);
  new Uint8Array(e.memory.buffer, p, bytes.length).set(bytes);
  try {
    ensure(e.validate(p, bytes.length) === 0, "MEDIA_INVALID");
    return {
      width: e.output(0),
      height: e.output(1),
      frames: e.output(2),
      duration: e.output(3),
      pixels: e.output(4),
      mime:
        bytes[0] === 0x47
          ? "image/gif"
          : bytes[0] === 0x52
            ? "image/webp"
            : bytes[0] === 0x89
              ? "image/png"
              : "image/jpeg",
      memory: e.memory.buffer.byteLength,
    };
  } finally {
    e.dealloc(p, bytes.length);
  }
}
export function validateArchive(
  bytes: Uint8Array,
  identity: { pack_id: string; release_id: string; version: number },
) {
  const files = unpack(bytes),
    raw = files.get("manifest.json")!,
    m = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  ensure(
    (m.schema_version === "0.2" ? validate02 : validate01)(m),
    "MANIFEST_SCHEMA",
  );
  // Market publications are new 0.2 snapshots; local 0.1 imports remain unchanged.
  ensure(
    m.schema_version === "0.2" &&
      m.pack_id === identity.pack_id &&
      m.release_id === identity.release_id &&
      m.version === identity.version,
    "RESERVATION_MISMATCH",
  );
  const decoder = new WebAssembly.Instance(decoderModule, {})
    .exports as unknown as Exports;
  const refs = new Set<string>(),
    assets = new Set<string>(),
    defaults = new Set<string>(),
    used = new Set(["manifest.json"]),
    actions = new Set<string>();
  let memory = 0;
  const key = (r: { asset_id: string; revision_id: string }) =>
    r.asset_id + ":" + r.revision_id;
  const actionKey = (r: { action_id: string; action_revision_id: string }) =>
    r.action_id + ":" + r.action_revision_id;
  const textBytes = (v: unknown) => Buffer.byteLength(String(v));
  for (const a of m.actions) {
    ensure(!actions.has(actionKey(a)), "ACTION_REFERENCE");
    actions.add(actionKey(a));
    ensure(
      textBytes(a.effect_summary) <= 4096 &&
        (a.kind !== "instruction" || textBytes(a.instruction) <= 2048),
      "ACTION_LIMIT",
    );
  }
  for (const t of [m.description, ...(m.examples ?? [])])
    if (t !== undefined) ensure(textBytes(t) <= 4096, "TEXT_LIMIT");
  const media = (b: Media, animated: boolean) => {
    const path = "blobs/" + b.sha256,
      value = files.get(path);
    ensure(value, "BLOB_MISSING");
    used.add(path);
    ensure(
      value.length === b.bytes && hash(value) === b.sha256,
      "BLOB_INTEGRITY",
    );
    const d = decode(value, decoder);
    ensure(
      d.mime === b.mime && d.width === b.width && d.height === b.height,
      "MEDIA_METADATA",
    );
    ensure(animated ? d.frames > 1 : d.frames === 1, "MEDIA_ANIMATION");
    memory = Math.max(memory, d.memory);
    return d;
  };
  for (const e of m.expressions) {
    ensure(!refs.has(key(e)), "EXPRESSION_REFERENCE");
    refs.add(key(e));
    assets.add(e.asset_id);
    ensure(
      Buffer.byteLength(
        JSON.stringify({ name: e.name, semantics: e.semantics }),
      ) <= 4096,
      "SEMANTICS_LIMIT",
    );
    const v = e.visual;
    ensure(
      v.animated
        ? !!v.poster &&
            Number.isSafeInteger(v.duration_ms) &&
            v.primary.sha256 !== v.poster.sha256
        : v.poster === undefined && v.duration_ms === undefined,
      "MEDIA_METADATA",
    );
    const d = media(v.primary, v.animated);
    if (v.animated) {
      ensure(
        ["image/gif", "image/webp"].includes(d.mime) &&
          d.duration === v.duration_ms,
        "MEDIA_DURATION",
      );
      media(v.poster, false);
    } else ensure(d.mime !== "image/gif", "MEDIA_FORMAT");
  }
  for (const r of m.defaults) {
    ensure(refs.has(key(r)) && !defaults.has(r.asset_id), "DEFAULT_REFERENCE");
    defaults.add(r.asset_id);
  }
  ensure(defaults.size === assets.size, "DEFAULT_REFERENCE");
  const bound = new Set<string>();
  for (const b of m.bindings) {
    ensure(
      refs.has(key(b.expression)) && !bound.has(key(b.expression)),
      "BINDING_REFERENCE",
    );
    bound.add(key(b.expression));
    for (const a of b.actions)
      ensure(actions.has(actionKey(a)), "BINDING_REFERENCE");
  }
  ensure(used.size === files.size, "UNREFERENCED_BLOB");
  return {
    manifest_sha256: hash(raw),
    wasm_linear_memory_bytes: memory,
    entries: files.size,
  };
}
