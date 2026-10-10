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

## Free SQLite DO and private R2 direct uploads

The HTTP flow reserves server-owned identities with `POST /v1/uploads {pack_id?}`, binds the final 0.2 archive using `POST /v1/uploads/:id/authorize {length,sha256}`, then seals and validates with `POST /v1/uploads/:id/complete {}`. Writes require the existing session, Origin, CSRF and a UUID `Idempotency-Key`; each phase retains its own key for recovery. GET returns upload state and `row_version`. First authorization/completion mutations require that version in `If-Match: "version"`; stale versions return 412. Expired reservations start a fresh operation when the same file is selected again. Browser PUT goes directly to the private R2 bucket; the ordinary Worker never receives archive bodies. New release snapshots preserve expression identities, fixed semantics and original media. Local 0.1 limits remain unchanged.

Private `FreeRuntime` SQLite DO serializes heavy work with at most eight queued requests. Password hashing preserves Better Auth 1.7.5 scrypt N16384/r16/p1/dkLen64, NFKC and the 32-character hexadecimal salt string; verification uses constant-time comparison. Passwords are transient; current D1 session/disabled-account checks remain authoritative. Conservative application daily caps are 2000 password computations, 128 validations, 128 reservations and 256 signatures. Each owner may have three unfinished uploads; the application permits at most 100 unreclaimed uploads and 1 GiB reserved storage. These limits do not establish the account's remaining free allowance and cannot cap every adversarial replay of a presigned S3 URL.

Market limits: 10 MiB archive, 16 MiB expansion, 512 KiB manifest, 256 ZIP entries; only the manifest and SHA-addressed blobs. Each image is limited to 1 MiB, 1024 pixels per edge, 60 frames, ten seconds and eight million cumulative decoded pixels. ZIP validation checks central/local headers, descriptors, paths, overlapping entries, actual output size and CRC. Import-free Rust WASM fully decodes PNG/JPEG/GIF/WebP; the wrapper additionally checks complete GIF framing. WASM linear memory is capped at 64 MiB and decoder allocations at 24 MiB; neither figure is measured whole-isolate memory. The platform's default DO CPU limit is 30 seconds per request. Runtime or I/O interruption retains recoverable state and never accepts uploader self-certification.

Server-only `sealed/` objects use conditional writes and verified SHA-256. Review/publication must reference those immutable bytes and their manifest digest, never staging. The 15-minute cleanup schedule expires rows using SQL CAS before deleting; valid references prevent expiry. Signatures expire at the earlier of five minutes or the upload deadline; authorization is refused with less than one second remaining, preventing replay after cleanup. Operation records are retained for at least seven days (currently indefinitely). Cleanup retries safely after partial failure.

Install root dependencies and run `npm ci`, `npm test`, `npm run typecheck`, `npm run build` here. The Wrangler configuration uses SQLite migrations, enables no Paid/Containers resources, and defaults uploads to `UPLOAD_ENABLED=false`. Enable only after confirming the actual free plan, shared usage, bucket-scoped S3 credentials, private bucket and exact-origin CORS. Configure `R2_ACCOUNT_ID` and `R2_BUCKET`; store `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` as secrets. Never log passwords, secrets or signed URLs. The sample CORS configuration targets the current acceptance site; replace its exact Origin when deployment changes, never use `*`.

Production acceptance must separately establish existing-account compatibility, DO telemetry, actual S3 length/type/tamper/expiry/race/cleanup behavior, boundary packages and browser uploads. Local workerd/R2 fixtures prove neither S3 signing nor browser CORS, account tier or whole-isolate memory. Missing credentials or an unavailable validator cannot be reported as completed uploads. Remove temporary acceptance objects while preserving formal resources.
