import { scheduledMaintenance } from "./maintenance";
import { failure } from "./upload-shared";
export { FreeRuntime } from "./free-runtime";
export type Env = Omit<
  CloudflareBindings,
  "APP_ORIGIN" | "LOCAL_TEST" | "ASSETS"
> & {
  APP_ORIGIN: string;
  BACKUP_ACCOUNT_ID?: string;
  BACKUP_DATABASE_ID?: string;
  D1_BACKUP_API_TOKEN?: string;
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
    await scheduledMaintenance(env);
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/v1/"))
      return env.ASSETS
        ? env.ASSETS.fetch(request)
        : new Response("Not found", { status: 404 });
    if (!env.FREE_RUNTIME) return failure("RUNTIME_UNAVAILABLE", 503);
    const headers = new Headers(request.headers);
    // Never trust a client-supplied forwarding marker, even on local requests.
    headers.delete("x-amoji-edge-ip");
    const ip = request.cf
      ? request.headers.get("cf-connecting-ip")
      : env.LOCAL_TEST === "true" && url.hostname === "localhost"
        ? "127.0.0.1"
        : null;
    if (ip) headers.set("x-amoji-edge-ip", ip);
    try {
      const start = performance.now();
      const response = await env.FREE_RUNTIME.getByName("free-runtime-v1").fetch(
        new Request(request, { headers }),
      );
      const result = new Response(response.body, response);
      result.headers.set("server-timing", `amoji;dur=${(performance.now() - start).toFixed(2)}`);
      return result;
    } catch {
      return failure("RUNTIME_UNAVAILABLE", 503);
    }
  },
};
