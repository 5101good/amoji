export { FreeRuntime } from "./free-runtime";
export type Env = Omit<
  CloudflareBindings,
  "APP_ORIGIN" | "LOCAL_TEST" | "ASSETS"
> & {
  APP_ORIGIN: string;
  BETTER_AUTH_SECRET: string;
  LOCAL_TEST?: string;
  ASSETS?: Fetcher;
  UPLOADS?: R2Bucket;
  FREE_RUNTIME?: DurableObjectNamespace;
  UPLOAD_ENABLED?: string;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
};
/** Public Worker performs no authentication, signature or archive computation. */
export default {
  async scheduled(_event: ScheduledController, env: Env) {
    if (!env.FREE_RUNTIME) throw Error("RUNTIME_UNAVAILABLE");
    const response = await env.FREE_RUNTIME.getByName("free-runtime-v1").fetch(
      "https://runtime/cleanup",
      { method: "POST" },
    );
    if (!response.ok) throw Error("CLEANUP_RETRY");
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/v1/"))
      return env.ASSETS
        ? env.ASSETS.fetch(request)
        : new Response("Not found", { status: 404 });
    if (!env.FREE_RUNTIME)
      return Response.json(
        { error: { code: "RUNTIME_UNAVAILABLE", retryable: true } },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    const headers = new Headers(request.headers);
    // Never trust a client-supplied forwarding marker, even on local requests.
    headers.delete("x-amoji-edge-ip");
    const ip = request.cf
      ? request.headers.get("cf-connecting-ip")
      : env.LOCAL_TEST === "true" && url.hostname === "localhost"
        ? "127.0.0.1"
        : null;
    if (ip) headers.set("x-amoji-edge-ip", ip);
    return env.FREE_RUNTIME.getByName("free-runtime-v1").fetch(
      new Request(request, { headers }),
    );
  },
};
