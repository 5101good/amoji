// Isolated workerd + D1/R2 browser acceptance server. No cloud credentials or data.
// Only the S3 transport is emulated; archive validation and publication run in workerd.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fixture } from "./submission-fixture.mjs";

const publicRoot = resolve(import.meta.dirname, "../dist/public");
async function assets(request) {
  const path = new URL(request.url).pathname;
  const file = resolve(
    publicRoot,
    path === "/" || !extname(path) ? "index.html" : "." + path,
  );
  if (!file.startsWith(publicRoot + "/"))
    return new Response("", { status: 404 });
  try {
    return new Response(await readFile(file), {
      headers: {
        "content-type":
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".webp": "image/webp",
          }[extname(file)] ?? "application/octet-stream",
      },
    });
  } catch {
    return new Response("", { status: 404 });
  }
}
const cleanup = [];
const f = await fixture(
  { after: (fn) => cleanup.push(fn) },
  { ASSETS: assets },
);
await f.register("reviewer@example.test");
await f.db
  .prepare(
    "UPDATE market_account SET role='reviewer' WHERE auth_user_id=(SELECT id FROM auth_user WHERE email='reviewer@example.test')",
  )
  .run();
const uploads = new Map();
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (url.pathname === "/__test/r2" && req.method === "PUT") {
      const key = uploads.get(url.searchParams.get("upload"));
      if (!key) {
        res.writeHead(404);
        return res.end();
      }
      await f.bucket.put(key, body, {
        httpMetadata: { contentType: "application/zip" },
      });
      res.writeHead(200);
      return res.end();
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (typeof value === "string") headers.set(key, value);
    if (headers.has("origin")) headers.set("origin", "http://localhost");
    headers.delete("host");
    headers.delete("content-length");
    let response = await f.mf.dispatchFetch(url.href, {
      method: req.method,
      headers,
      ...(body.length ? { body } : {}),
    });
    if (url.pathname.endsWith("/authorize") && response.ok) {
      const value = await response.json();
      const key = new URL(value.authorization.url).pathname
        .split("/")
        .slice(2)
        .join("/");
      const id = crypto.randomUUID();
      uploads.set(id, key);
      value.authorization.url = "http://localhost:4174/__test/r2?upload=" + id;
      response = new Response(JSON.stringify(value), response);
    }
    for (const [key, value] of response.headers)
      if (key !== "set-cookie") res.setHeader(key, value);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader("set-cookie", cookies);
    res.writeHead(response.status);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.writeHead(500);
    res.end("Local runtime fixture error: " + error.message);
  }
});
server.listen(4174, "127.0.0.1", () =>
  console.log("Amoji isolated runtime: http://localhost:4174"),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server.close();
  await Promise.all(cleanup.map((fn) => fn()));
}
process.on("SIGTERM", () => {
  void close();
});
process.on("SIGINT", () => {
  void close();
});
