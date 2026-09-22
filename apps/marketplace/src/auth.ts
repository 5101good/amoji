import { betterAuth } from "better-auth";
export function authOptions(env: {
  DB: D1Database;
  APP_ORIGIN: string;
  BETTER_AUTH_SECRET: string;
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
export function createAuth(env: Parameters<typeof authOptions>[0]) {
  return betterAuth(authOptions(env));
}
