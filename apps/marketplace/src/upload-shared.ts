export const MARKET_LIMITS = {
  archive: 10 * 1024 * 1024,
  expanded: 16 * 1024 * 1024,
  manifest: 512 * 1024,
  entries: 256,
  media: 1024 * 1024,
  storage: 1024 * 1024 * 1024,
  lifetime: 86400000,
  signatureSeconds: 300,
} as const;
export type Upload = {
  id: string;
  owner: string;
  operation: string;
  request_hash: string;
  pack_id: string;
  release_id: string;
  version: number;
  row_version: number;
  length: number | null;
  sha256: string | null;
  object_key: string;
  sealed_key: string;
  state: string;
  created_at: number;
  expires_at: number;
  authorize_key: string | null;
  complete_key: string | null;
  validation_error: string | null;
  manifest_sha256: string | null;
  cleaned: number;
};
export type UploadEnv = {
  DB: D1Database;
  UPLOADS?: R2Bucket;
  FREE_RUNTIME?: DurableObjectNamespace;
  UPLOAD_ENABLED?: string;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
};
export const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function reply(value: object, status = 200) {
  return Response.json(
    { ...value, request_id: crypto.randomUUID() },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...(status === 429 ? { "retry-after": "900" } : {}),
      },
    },
  );
}
export function failure(code: string, status: number) {
  return reply(
    {
      error: {
        code,
        message: code,
        retryable: status === 429 || status >= 500,
      },
    },
    status,
  );
}
export function view(u: Upload) {
  return {
    id: u.id,
    pack_id: u.pack_id,
    release_id: u.release_id,
    version: u.version,
    row_version: u.row_version,
    state: u.state,
    length: u.length,
    sha256: u.sha256,
    expires_at: u.expires_at,
    validation_error: u.validation_error,
    manifest_sha256: u.manifest_sha256,
  };
}
export async function readBytes(
  stream: ReadableStream<Uint8Array> | null,
  max: number,
) {
  const reader = stream?.getReader();
  if (!reader) return new Uint8Array();
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw Error("BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let p = 0;
  for (const c of chunks) {
    result.set(c, p);
    p += c.length;
  }
  return result;
}
export async function body(r: Request) {
  if (!r.headers.get("content-type")?.startsWith("application/json"))
    throw Error("INVALID_BODY");
  const v = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      await readBytes(r.body, 4096),
    ),
  );
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("INVALID_BODY");
  return v as Record<string, unknown>;
}
export async function digest(b: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(b))),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function budget(env: UploadEnv, kind: string, max: number) {
  const result = await env.DB.prepare(
    "INSERT INTO market_runtime_budget(day,kind,count) VALUES(?,?,1) ON CONFLICT(day,kind) DO UPDATE SET count=count+1 RETURNING count",
  )
    .bind(Math.floor(Date.now() / 86400000), kind)
    .first<{ count: number }>();
  return !!result && result.count <= max;
}
