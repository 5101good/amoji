import { betterAuth } from "better-auth";
export function authOptions(env: {
  DB: D1Database;
  APP_ORIGIN: string;
  BETTER_AUTH_SECRET: string;
  FREE_RUNTIME?: DurableObjectNamespace;
}) {
  return {
    database: env.DB,
    baseURL: env.APP_ORIGIN,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_ORIGIN],
    logger: { disabled: true },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      password: {
        hash: (password: string) =>
          passwordOperation(env, { mode: "hash", password }) as Promise<string>,
        verify: ({ hash, password }: { hash: string; password: string }) =>
          passwordOperation(env, {
            mode: "verify",
            hash,
            password,
          }) as Promise<boolean>,
      },
    },
    emailVerification: { sendOnSignUp: false, sendOnSignIn: false },
    user: { modelName: "auth_user" },
    account: { modelName: "auth_account", accountLinking: { enabled: false } },
    session: {
      modelName: "auth_session",
      expiresIn: 43200,
      updateAge: 43200,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    verification: { modelName: "auth_verification" },
    rateLimit: { enabled: false }, // Atomic D1 limits wrap all exposed entry points, before hashing.
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      useSecureCookies: true,
      cookiePrefix: "amoji",
      defaultCookieAttributes: {
        httpOnly: true,
        secure: true,
        sameSite: "lax" as const,
      },
      cookies: {
        session_token: {
          name: "__Host-amoji.session_token",
          attributes: { path: "/" },
        },
      },
    },
  };
}
export function createAuth(
  env: Parameters<typeof authOptions>[0],
  onUserPrepared?: (id: string) => void,
) {
  return betterAuth({
    ...authOptions(env),
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            // Allocate a request-owned ID before any write; after hooks are
            // deferred by Better Auth and may never run on credential failure.
            const id = crypto.randomUUID();
            onUserPrepared?.(id);
            return { data: { id } };
          },
        },
      },
    },
  });
}

async function passwordOperation(
  env: { FREE_RUNTIME?: DurableObjectNamespace },
  data: object,
): Promise<string | boolean> {
  if (!env.FREE_RUNTIME) throw Error("PASSWORD_RUNTIME_UNAVAILABLE");
  const response = await env.FREE_RUNTIME.getByName("free-runtime-v1").fetch(
    "https://runtime/password",
    { method: "POST", body: JSON.stringify(data) },
  );
  if (!response.ok) throw Error("PASSWORD_RUNTIME_UNAVAILABLE");
  return ((await response.json()) as { value: string | boolean }).value;
}
