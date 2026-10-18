import { MARKET_LIMITS, type UploadEnv, type Upload } from "./upload-shared";
const encode = (v: string) =>
  encodeURIComponent(v).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
const bytes = new TextEncoder();
async function hmac(key: Uint8Array, value: string) {
  const k = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", k, bytes.encode(value)),
  );
}
const hex = (v: Uint8Array) =>
  Array.from(v)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
/** Signed length/type are verified against R2 at deployment. Completion also verifies stored bytes. */
export async function authorizePut(env: UploadEnv, row: Upload) {
  if (
    !/^[a-f0-9]{32}$/.test(env.R2_ACCOUNT_ID ?? "") ||
    !env.R2_BUCKET ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY
  )
    throw Error("SIGNING_UNAVAILABLE");
  const now = new Date(),
    stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, ""),
    day = stamp.slice(0, 8),
    scope = `${day}/auto/s3/aws4_request`,
    host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  // A late retry must expire before cleanup can remove its reservation.
  const seconds = Math.min(
    MARKET_LIMITS.signatureSeconds,
    Math.floor((row.expires_at - now.getTime()) / 1000),
  );
  if (seconds < 1) throw Error("UPLOAD_EXPIRED");
  const path =
    "/" + [env.R2_BUCKET, ...row.object_key.split("/")].map(encode).join("/");
  const params: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${env.R2_ACCESS_KEY_ID}/${scope}`,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(seconds),
    "X-Amz-SignedHeaders": "content-length;content-type;host",
  };
  const query = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encode(k)}=${encode(v)}`)
    .join("&");
  const canonical = `PUT\n${path}\n${query}\ncontent-length:${row.length}\ncontent-type:application/zip\nhost:${host}\n\ncontent-length;content-type;host\nUNSIGNED-PAYLOAD`;
  const hash = hex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes.encode(canonical)),
    ),
  );
  let key = await hmac(bytes.encode("AWS4" + env.R2_SECRET_ACCESS_KEY), day);
  for (const v of ["auto", "s3", "aws4_request"]) key = await hmac(key, v);
  const signature = hex(
    await hmac(key, `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${hash}`),
  );
  return {
    method: "PUT",
    url: `https://${host}${path}?${query}&X-Amz-Signature=${signature}`,
    headers: { "content-type": "application/zip" },
    length: row.length,
    expires_at: now.getTime() + seconds * 1000,
  };
}
