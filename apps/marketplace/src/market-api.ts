import { reviewRoute } from "./reviews";
import { catalogRoute } from "./catalog";
import { createAuth } from "./auth";
import { submissionRoute } from "./submissions";
import { uploadRoute } from "./uploads";
import type { Env } from "./worker";
const encoder = new TextEncoder();
function json(data: object, status = 200, extra?: HeadersInit) {
  const h = new Headers(extra);
  h.set("content-type", "application/json");
  h.set("cache-control", "no-store");
  h.set("x-content-type-options", "nosniff");
  return new Response(
    JSON.stringify({ ...data, request_id: crypto.randomUUID() }),
    { status, headers: h },
  );
}
function error(code: string, status: number) {
  return json(
    {
      error: {
        code,
        message: code,
        retryable: status === 429 || status >= 500,
      },
    },
    status,
    status === 429 ? { "retry-after": "900" } : undefined,
  );
}
async function mac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [
    ...new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
async function csrf(request: Request, env: Env, stamp: string) {
  return mac(
    env.BETTER_AUTH_SECRET,
    `csrf:${stamp}:${request.headers.get("cookie") ?? ""}`,
  );
}
async function validCsrf(
  request: Request,
  env: Env,
  stamp: string,
  signature: string,
) {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.BETTER_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = Uint8Array.from(signature.match(/../g)!, (x) =>
    parseInt(x, 16),
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    bytes,
    encoder.encode(`csrf:${stamp}:${request.headers.get("cookie") ?? ""}`),
  );
}
async function limitedBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("BODY");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("BODY");
  let length = 0;
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 8192) {
      await reader.cancel();
      throw new Error("SIZE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function limit(env: Env, key: string, max: number, window = 900000) {
  const bucket = Math.floor(Date.now() / window);
  const result = await env.DB.prepare(
    "INSERT INTO auth_rate_limit (key,bucket,count) VALUES (?, ?, 1) ON CONFLICT(key,bucket) DO UPDATE SET count=count+1 RETURNING count",
  )
    .bind(key, bucket)
    .first<{ count: number }>();
  return !!result && result.count <= max;
}
async function account(env: Env, user: { id: string; name: string }) {
  await env.DB.prepare(
    "INSERT INTO market_account(id,auth_user_id,display_name,role,disabled) VALUES (?,?,?,'creator',0) ON CONFLICT(auth_user_id) DO NOTHING",
  )
    .bind(crypto.randomUUID(), user.id, user.name)
    .run();
  return env.DB.prepare(
    "SELECT id,display_name,role,disabled FROM market_account WHERE auth_user_id=?",
  )
    .bind(user.id)
    .first<{
      id: string;
      display_name: string;
      role: string;
      disabled: number;
    }>();
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!path.startsWith("/v1/"))
      return env.ASSETS
        ? env.ASSETS.fetch(request)
        : new Response("Not found", {
            status: 404,
            headers: { "content-type": "text/plain" },
          });
    try {
      if (url.origin !== env.APP_ORIGIN) return error("ORIGIN", 403);
      if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)
        return error("CONFIGURATION", 503);
      if (path === "/v1/packs" || path.startsWith("/v1/packs/")) {
        const ip = request.headers.get("x-amoji-edge-ip");
        if (!ip) return error("UNTRUSTED_PROXY", 403);
        if (
          !(await limit(
            env,
            `public:${await mac(env.BETTER_AUTH_SECRET, ip)}`,
            120,
            60000,
          ))
        )
          return error("RATE_LIMITED", 429);
        return catalogRoute(request, env);
      }
      if (path === "/v1/auth/csrf" && request.method === "GET") {
        const stamp = `${Date.now()}.${crypto.randomUUID()}`;
        return json({ csrf: `${stamp}.${await csrf(request, env, stamp)}` });
      }
      if (path === "/v1/me" && request.method === "GET") {
        const session = await createAuth(env).api.getSession({
          headers: request.headers,
          query: { disableCookieCache: true, disableRefresh: true },
        });
        if (!session) return error("UNAUTHENTICATED", 401);
        const domain = await account(env, session.user);
        if (!domain || domain.disabled) return error("ACCOUNT_DISABLED", 403);
        return json({
          account: {
            id: domain.id,
            name: domain.display_name,
            role: domain.role,
            email: session.user.email,
            emailVerified: session.user.emailVerified,
          },
          expires_at: session.session.expiresAt,
        });
      }
      if (
        path.startsWith("/v1/review/") ||
        path === "/v1/uploads" ||
        path.startsWith("/v1/uploads/") ||
        path.startsWith("/v1/submissions") ||
        path.startsWith("/v1/me/submissions") ||
        path.startsWith("/v1/operations/")
      ) {
        const creatorRoute =
          !/^\/v1\/uploads(?:\/[0-9a-f-]{36}(?:\/(authorize|complete))?)?$/.test(
            path,
          );
        if (!["GET", "POST"].includes(request.method))
          return error("NOT_FOUND", 404);
        const session = await createAuth(env).api.getSession({
          headers: request.headers,
          query: { disableCookieCache: true, disableRefresh: true },
        });
        if (!session) return error("UNAUTHENTICATED", 401);
        const domain = await account(env, session.user);
        if (!domain || domain.disabled) return error("ACCOUNT_DISABLED", 403);
        if (request.method === "POST") {
          if (
            request.headers.get("origin") !== env.APP_ORIGIN ||
            request.headers.get("sec-fetch-site") === "cross-site"
          )
            return error("ORIGIN", 403);
          const parts = (request.headers.get("x-csrf-token") ?? "").split("."),
            stamp = parts.slice(0, 2).join("."),
            issued = Number(parts[0]);
          if (
            parts.length !== 3 ||
            !Number.isFinite(issued) ||
            issued > Date.now() ||
            Date.now() - issued > 300000 ||
            !(await validCsrf(request, env, stamp, parts[2] ?? ""))
          )
            return error("CSRF", 403);
          if (
            !(await limit(
              env,
              `${creatorRoute ? "submission" : "upload"}:${domain.id}`,
              30,
            ))
          )
            return error("RATE_LIMITED", 429);
        }
        if (path.startsWith("/v1/review/"))
          return reviewRoute(request, env, domain.id);
        return creatorRoute
          ? submissionRoute(request, env, domain.id)
          : uploadRoute(request, env, domain.id);
      }
      if (
        request.method !== "POST" ||
        !["/v1/auth/register", "/v1/auth/login", "/v1/auth/logout"].includes(
          path,
        )
      )
        return error("NOT_FOUND", 404);
      if (
        request.headers.get("origin") !== env.APP_ORIGIN ||
        request.headers.get("sec-fetch-site") === "cross-site"
      )
        return error("ORIGIN", 403);
      const token = request.headers.get("x-csrf-token") ?? "";
      const parts = token.split(".");
      const stamp = parts.slice(0, 2).join(".");
      const issued = Number(parts[0]);
      if (
        parts.length !== 3 ||
        !Number.isFinite(issued) ||
        issued > Date.now() ||
        Date.now() - issued > 300000 ||
        !(await validCsrf(request, env, stamp, parts[2] ?? ""))
      )
        return error("CSRF", 403);
      // This marker is overwritten by the sole public ingress before private DO dispatch.
      const ip = request.headers.get("x-amoji-edge-ip");
      if (!ip) return error("UNTRUSTED_PROXY", 403);
      const bucketKey = await mac(env.BETTER_AUTH_SECRET, `ip:${ip}`);
      if (
        !(await limit(
          env,
          `${path}:${bucketKey}`,
          path.endsWith("register") ? 5 : 20,
        ))
      )
        return json(
          {
            error: {
              code: "RATE_LIMITED",
              message: "RATE_LIMITED",
              retryable: true,
            },
          },
          429,
          { "retry-after": "900" },
        );
      let body;
      try {
        body = await limitedBody(request);
      } catch (e) {
        return error(
          e instanceof Error && e.message === "SIZE"
            ? "BODY_TOO_LARGE"
            : "INVALID_BODY",
          e instanceof Error && e.message === "SIZE" ? 413 : 400,
        );
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        return error("INVALID_BODY", 400);
      const allowed = path.endsWith("logout")
        ? []
        : path.endsWith("register")
          ? ["name", "email", "password"]
          : ["email", "password"];
      if (Object.keys(body).some((k) => !allowed.includes(k)))
        return error("INVALID_BODY", 400);
      let createdUserId: string | undefined;
      const auth = createAuth(env, (id) => {
        createdUserId = id;
      });
      let response: Response;
      if (path.endsWith("logout"))
        response = await auth.api.signOut({
          headers: request.headers,
          asResponse: true,
        });
      else {
        if (
          typeof body.email !== "string" ||
          body.email.length > 254 ||
          typeof body.password !== "string" ||
          body.password.length < 12 ||
          body.password.length > 128 ||
          (path.endsWith("register") &&
            (typeof body.name !== "string" ||
              !body.name.trim() ||
              body.name.length > 80))
        )
          return error("INVALID_BODY", 400);
        if (
          !(await limit(
            env,
            `${path}:email:${await mac(env.BETTER_AUTH_SECRET, body.email.toLowerCase().trim())}`,
            10,
          ))
        )
          return error("RATE_LIMITED", 429);
        if (path.endsWith("register")) {
          try {
            response = await auth.api.signUpEmail({
              body: {
                email: body.email,
                password: body.password,
                name: body.name,
              },
              headers: request.headers,
              asResponse: true,
            });
          } finally {
            // D1's Better Auth adapter cannot span these writes in a transaction.
            // Compensate only the identity created by this request, never an
            // existing/competing identity or one with a committed credential.
            if (createdUserId) {
              await env.DB.prepare(
                "DELETE FROM auth_user WHERE id=? AND NOT EXISTS (SELECT 1 FROM auth_account WHERE userId=auth_user.id)",
              )
                .bind(createdUserId)
                .run();
            }
          }
        } else {
          response = await auth.api.signInEmail({
            body: { email: body.email, password: body.password },
            headers: request.headers,
            asResponse: true,
          });
        }
      }
      // The library response contains a token: expose cookies only, never that body.
      const headers = new Headers();
      for (const cookie of response.headers.getSetCookie())
        headers.append("set-cookie", cookie);
      if (!response.ok)
        return json(
          {
            error: {
              code: path.endsWith("login")
                ? "INVALID_CREDENTIALS"
                : "AUTH_FAILED",
              message: "AUTH_FAILED",
              retryable: false,
            },
          },
          response.status,
          headers,
        );
      if (!path.endsWith("logout")) {
        const result = (await response.json()) as {
          user?: { id: string; name: string };
        };
        if (!result.user) return error("AUTH_FAILED", 503);
        const domain = await account(env, result.user);
        if (!domain || domain.disabled) {
          return error("ACCOUNT_DISABLED", 403);
        }
      }
      return json({ ok: true }, 200, headers);
    } catch {
      return error("UNAVAILABLE", 503);
    }
  },
};
