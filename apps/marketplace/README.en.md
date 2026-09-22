# Amoji marketplace accounts

[中文](README.md)

Cloudflare Workers / Static Assets + D1 with embedded Better Auth. This package provides the initial account UI/API; later modules supply the full marketplace.

## Local development

Use Node.js 24 or later:

```sh
npm ci
node -e 'require("fs").writeFileSync(".dev.vars", "BETTER_AUTH_SECRET="+require("crypto").randomBytes(32).toString("hex")+"\n", {mode:0o600})'
npm run build
npx wrangler d1 migrations apply amoji-marketplace --local
npm run dev
```

Open `http://localhost:8787`. Never enable `LOCAL_TEST` in production. No confirmation or recovery emails are sent; email is not proof of ownership.

## Verification

`npm run typecheck && npm test && npm run build` exercises real local workerd D1 bindings: secure cookies, login/logout/disable, request budgets, shared rate limits and an isolated review transaction fixture. `test/transaction-probe.ts` is excluded from the production bundle and must never be publicly deployed.

Local tests do not establish cloud free-tier CPU, memory or latency feasibility. Passwords use Better Auth's default scrypt without weakened parameters.

## Deployment

Set your provisioned D1 database ID and production origin, set a random secret with `wrangler secret put BETTER_AUTH_SECRET --env production`, and apply migrations to the explicitly selected database before `npm run deploy`. Placeholder IDs intentionally prevent accidental deployment. Production does not inherit the local-test switch. Stop on insufficient permissions or quotas; never activate paid upgrades automatically. Do not enable read replicas for auth data.

Only `/v1/auth/csrf`, `register`, `login`, `logout` and `/v1/me` are exposed. No script-readable session tokens or administrator signup endpoints. Cookies expire after at most 12 hours without refresh. Five-minute CSRF tokens accompany an exact Origin check.

Atomic D1 limits: 5 registrations per IP / 15 minutes, 20 logins per IP / 15 minutes, 10 attempts per email and operation / 15 minutes. HMAC protects identifiers; scheduled cleanup removes expired counters. Production trusts only edge-provided `CF-Connecting-IP` and rejects auth writes without edge context. Bodies are limited to 8 KiB.
