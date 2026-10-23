# Amoji marketplace accounts

[中文](README.md)

Cloudflare Workers / Static Assets + D1 with embedded Better Auth. This package provides account, trusted upload and creator submission UI/API; separate modules supply public discovery and moderation.

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

## Web navigation and browser checks

- **Discover** `/`: real image covers, keyword search and combined filters. Filters remain in the URL for sharing and browser Back. The server renders public summaries before JavaScript; anonymous browsing does not load the creator archive tools.
- **Pack details** `/packs/:pack/releases/:release`: enlarge images, read the act each expression realizes and its fixed meaning in every language, inspect optional effects and their bindings, download an exact release and copy its dsh pack ID. Installation never enables an effect.
- **Creator studio** `/?view=studio`: choose content → details per language and licenses → optional effects → preview and submit. Drafts stay on the current device, interrupted uploads can be recovered, and a reviewer publishes submitted content.
- **Review** `/?view=review` is limited to reviewers and administrators. **Account & publications** `/?view=account` groups content, reports, roles and account deletion. Device pairing has a separate confirmation page.

The interface defaults to Chinese and remembers an optional English selection. Interface language never translates or rewrites creators' fixed semantics. Layouts support phones and tablets, keyboard focus, modal Escape and focus return, and reduced motion. The hero artwork was generated with the repository's CC0 expressions as a reference; see [brand artwork provenance and license](web/art/README.md). Example expressions come from the official Classic pack, and the brand image is `assets/brand/amoji-logo.png`. Images use optimized WebP assets without external font or image services.

The interactive homepage exhibit places an expression beside its fixed meaning. Choosing an example only changes the local preview; it never sends a message or calls a model. Example text is copied verbatim from the repository’s Chinese and English built-in definitions, selecting the corresponding independent example for each interface language. The account page separates identity, publications, reports, roles and deletion controls.

Browser regression checks (install locked dependencies at the repository root and in this directory first):

```sh
npm run build
npx playwright install chromium
npm run test:ui
# Alternatively, use an existing Microsoft Edge installation:
PLAYWRIGHT_CHANNEL=msedge npm run test:ui
```

Tests start isolated servers bound to the local machine. Port `4173` uses state fixtures for empty/error states, languages, roles, focus and responsive layouts. Port `4174` runs real local workerd, D1 and R2 through upload, trusted validation, submission, approval and public download; only the S3 network transfer is emulated. Browser tests also run axe accessibility rules. Screenshots go to `.cache/design` and failed traces to `.cache/browser-results`; neither is committed. Test entry points are excluded from the production bundle. These checks do not replace cloud S3, free-tier, performance or real dsh acceptance.

Public covers use a separate `/cover` endpoint. Each runtime caches only verified image bytes (8 MiB / 64 entries, at most 1 MiB each) and checks publication state on every hit. Hits do not reread archives or spend `sealed_reads`; cold reads, eviction and restarts still use the existing allowance and heavy-job queue. No cloud objects are added. Browser responses remain `no-store`, so removals take effect immediately.

## Deployment

Set your provisioned D1 database ID and production origin, set a random secret with `wrangler secret put BETTER_AUTH_SECRET --env production`, and apply migrations to the explicitly selected database before `npm run deploy`. The production ID is explicit; verify it before any remote command. Production does not inherit the local-test switch. Stop on insufficient permissions or quotas; never activate paid upgrades automatically. Do not enable read replicas for auth data.

Authentication exposes only `/v1/auth/csrf`, `register`, `login`, `logout` and `/v1/me`. No script-readable session tokens or administrator signup endpoints. Cookies expire after at most 12 hours without refresh. Five-minute CSRF tokens accompany an exact Origin check.

Atomic D1 limits: 5 registrations per IP / 15 minutes, 20 logins per IP / 15 minutes, 10 attempts per email and operation / 15 minutes. HMAC protects identifiers; scheduled cleanup removes expired counters. Production trusts only edge-provided `CF-Connecting-IP` and rejects auth writes without edge context. Bodies are limited to 8 KiB.

## Free SQLite DO and private R2 direct uploads

The HTTP flow reserves server-owned identities with `POST /v1/uploads {pack_id?}`, binds the final Amoji 0.1 archive using `POST /v1/uploads/:id/authorize {length,sha256}`, then seals and validates with `POST /v1/uploads/:id/complete {}`. Writes require the existing session, Origin, CSRF and a UUID `Idempotency-Key`; each phase retains its own key for recovery. GET returns upload state and `row_version`. First authorization/completion mutations require that version in `If-Match: "version"`; stale versions return 412. Expired reservations start a fresh operation when the same file is selected again. Browser PUT goes directly to the private R2 bucket; the ordinary Worker never receives archive bodies. New release snapshots preserve expression identities, fixed semantics and original media. Local 0.1 limits remain unchanged.

Private `FreeRuntime` SQLite DO executes the complete authentication and upload control API, serializing requests with at most eight queued requests. The ordinary Worker only forwards API requests and serves assets. Ingress overwrites the trusted edge-IP marker; clients cannot forge it. CSRF, sessions, signatures and validation execute inside the DO, with inline nested compute rather than recursive RPC. Password hashing preserves Better Auth 1.7.5 scrypt N16384/r16/p1/dkLen64, NFKC and the 32-character hexadecimal salt string; verification uses constant-time comparison. Passwords are transient; current D1 session/disabled-account checks remain authoritative. Conservative application daily caps are 2000 password computations, 128 validations, 128 reservations and 256 signatures. Each owner may have three unfinished uploads; the application permits at most 100 unreclaimed uploads and 1 GiB reserved storage. These limits do not establish the account's remaining free allowance and cannot cap every adversarial replay of a presigned S3 URL.

Market limits: 10 MiB archive, 16 MiB expansion, 512 KiB manifest, 256 ZIP entries; only the manifest and SHA-addressed blobs. Each image is limited to 1 MiB, 1024 pixels per edge, 60 frames, ten seconds and eight million cumulative decoded pixels. ZIP validation checks central/local headers, descriptors, paths, overlapping entries, actual output size and CRC. Import-free Rust WASM fully decodes PNG/JPEG/GIF/WebP; the wrapper additionally checks complete GIF framing. WASM linear memory is capped at 64 MiB and decoder allocations at 24 MiB; neither figure is measured whole-isolate memory. The platform's default DO CPU limit is 30 seconds per request. Runtime or I/O interruption retains recoverable state and never accepts uploader self-certification.

Server-only `sealed/` objects use conditional writes and verified SHA-256. Review/publication must reference those immutable bytes and their manifest digest, never staging. The 15-minute cleanup schedule expires rows using SQL CAS before deleting; valid references prevent expiry. Signatures expire at the earlier of five minutes or the upload deadline; authorization is refused with less than one second remaining, preventing replay after cleanup. Operation records are retained for at least seven days (currently indefinitely). Cleanup retries safely after partial failure.

Install root dependencies and run `npm ci`, `npm test`, `npm run typecheck`, `npm run build` here. The Wrangler configuration uses SQLite migrations, enables no Paid/Containers resources, and defaults uploads to `UPLOAD_ENABLED=false`. Enable only after confirming the actual free plan, shared usage, bucket-scoped S3 credentials, private bucket and exact-origin CORS. Configure `R2_ACCOUNT_ID` and `R2_BUCKET`; store `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` as secrets. Never log passwords, secrets or signed URLs. The sample CORS configuration targets the current acceptance site; replace its exact Origin when deployment changes, never use `*`. Also update the exact R2 account endpoint in `web/_headers` CSP connect-src when deploying to another account.

Production acceptance must separately establish existing-account compatibility, DO telemetry, actual S3 length/type/tamper/expiry/race/cleanup behavior, boundary packages and browser uploads. Local workerd/R2 fixtures prove neither S3 signing nor browser CORS, account tier or whole-isolate memory. Missing credentials or an unavailable validator cannot be reported as completed uploads. Remove temporary acceptance objects while preserving formal resources.

## Creator submissions

After signing in, choose one pack and review its details in each language, individual licenses and optional effects on this device before uploading to R2. The default language is Chinese, with English available. Preview every image/text, act, original language and translation provenance, complete effect/config and source; expand the full manifest for exact metadata. Only a trusted valid upload plus explicit distribution-rights confirmation can enter pending review. Publication belongs to the separate review workflow.

IndexedDB retains selected files, edits and operation IDs under an account-specific key. It stores no password, session or signed upload URL. Reconciliation checks operation/upload status first; expired uploads require returning to editing and uploading again. Only selected content is uploaded, without reading dsh conversations or the entire library. Editing expressions or effects creates new identities with provenance; unchanged content keeps exact revisions. Existing local AI suggestions and model selection remain unchanged.

Supported submission licenses are `CC0-1.0`, `CC-BY-4.0` and `CC-BY-SA-4.0`. Every item requires creator attribution; derivative packs require provenance. Unknown or redistribution-incompatible licenses are refused, never silently converted to CC0. Declarations and moderation do not replace authorization from actual rightsholders.

- `GET /v1/uploads/:id/preview` and `/media/:sha256`: current owner only, trusted sealed bytes with digest verification; media uses correct MIME, no-store and nosniff.
- `POST /v1/submissions {upload_id,rights_confirmed:true}`: requires the upload's `If-Match`; atomically stores immutable content, retention references and operation results.
- `GET /v1/me/submissions` and `/:id`: own statuses/reasons; default 20, maximum 50, with opaque continuation cursors.
- `POST /v1/submissions/:id/withdraw {}`: owner-only pending transition using the submission's `If-Match`.
- `GET /v1/operations/:operation`: own submission/withdrawal reconciliation. UUIDs are retained for at least seven days (currently indefinitely). Replays add no queue entries; changed payloads return 409 and stale versions 412.

Each account may have ten pending submissions and ten new submissions per UTC day; withdrawal does not restore the daily quota. Submission and upload control routes each allow 30 writes per 15 minutes. D1 triggers recheck trusted upload state, account disablement, ownership and quotas inside the transaction; identity conflicts roll back the entire submission. Withdrawal retains immutable snapshots. Revisions reserve a new release and increasing version. Apply migration 0005 before deploying the Worker and assets.

Private sealed-object reads (preview, media and submission snapshots) share D1 admission counters: 1024 per account/day and 4096 per application/day. Exhaustion returns 429 before R2 GET. These auditable application limits do not establish the account’s actual remaining allowance.

## Review and public discovery

Apply the additive `0006-review-publish.sql` migration in order. The deployer initializes the first reviewer through private D1 administration: verify the registered immutable `market_account.id`, run `node scripts/bootstrap-reviewer.mjs ACCOUNT_UUID OPERATOR REASON`, then execute its parameterized output privately. The one-time record permanently retains operator, reason, account and time and atomically grants admin (including review). Initialization is refused when any admin/reviewer exists. There is no public role escalation route; later operational role management is a separate feature.

Only admins/reviewers see the review workspace, and self-review is refused. Inspect digest-verified media, semantics, licenses, effects and field differences from the previous public release; enter a reason to approve or request changes. Decisions require `If-Match` and a UUID operation key. The D1 batch rechecks role, owner, valid digest, pending state and row version, then atomically writes state, public pointer, audit and idempotent outcome. Zero-row CAS produces no dependent writes; external errors hide SQL. Reconcile uncertain outcomes and safely replay the original operation, retained for at least seven days.

The anonymous catalog supports keywords in any language, act, semantic language and presence of effects. Migration `0010-amoji-0.1.sql` replaces the catalog columns with acts and effects. `GET /v1/packs` returns 20 by default, at most 50, ordered by update time and stable pack ID with cursors. `/packs/:pack/releases/:release` shares complete exact content, licenses, effects with their bindings, and host support. Search the pack ID in the dsh marketplace. Pending updates leave the old public release visible; approved versions remain independently downloadable. Archives return SHA-256, length and ETag. Every media/archive request checks publication, references and actual byte integrity; R2 never exposes permanent public URLs. Public reads also consume the shared sealed-object read allowance. Removed releases return 410 and pending direct links return 404.

`test/reviews.test.mjs` exercises real local workerd D1/R2 bindings for four actors, revision loops, CAS/rollback/idempotency, private separation and digest identity. Cloud browser, actual S3 and cloud D1 fault evidence require separate live execution; local tests cannot establish them.

All public reads share a trusted edge-IP limit of 120 per minute, with 429 and Retry-After. Static Assets single-page-application fallback supports direct shared-detail links.

Device authorization adds migration `0007-device-authorizations.sql`; apply it before updating the Worker. Signed-in browser users explicitly approve dsh pairing, without receiving device access or refresh tokens. Host creation and redemption reject browser Origin/Cookie headers; review routes reject device tokens. Only SHA-256 credential digests are stored. Pairing lasts five minutes, access fifteen minutes, and rotating refresh thirty days; refresh reuse revokes the family. Web logout revokes all owned devices and unclaimed approvals. The existing private D1, SQLite DO and direct R2 upload pipeline are reused.

## Publishing initial content

[Seven official packs](../../assets/official-packs/README.en.md) provide Amoji 0.1 archives. Submit each from an independent, retained creator account and have another reviewer decide; deleting the creator unpublishes the content. Repository builds do not establish cloud publication. Effects are guidance, not enforcement; disabling stops future attachment while preserving history. Record anonymous acquisition, native dsh installation/sending, action events and complete model turns separately after deployment.

## Production and recovery

The formal origin is `https://amoji.ai-web.ai`; production selects the existing `amoji-auth-v0` Worker/D1. Verify actual resources before deploying and preserve existing secrets/migration records. Read-only catalog metadata has a separate 64-reader bound and does not consume the eight heavy-job queue slots; per-IP limits remain enforced. A separate backup DO and private R2 use scheduled official D1 exports with a dedicated account-wide D1 Write token, explicitly approved by the operator; live testing showed D1 Read cannot export. See [operations](../../docs/marketplace-operations.en.md) for permission scope, upload cutoff, health, backup/restore, cost and rollback procedures.
