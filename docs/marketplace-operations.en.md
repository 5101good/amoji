# Marketplace operations and recovery

[中文](marketplace-operations.md)

The public origin is https://amoji.ai-web.ai. The operator owns human review, report handling and recovery drills. The service targets global users; regional reachability depends on measured networks. Authentication sends neither verification nor password-recovery emails. Browsing is anonymous; submission requires an account and reviewers cannot approve their own work. Public service availability and plugin distribution are separate evidence, without implying a host marketplace listing.

## Deployment and rollback

Use Node.js 24, locked dependencies and the production environment in `apps/marketplace/wrangler.jsonc`. Deploy additive D1 migrations, then API/assets, then clients. Never rerun applied DDL or recreate/rename the existing `free-runtime-v1` SQLite DO migration. Bind only `amoji.ai-web.ai`; preserve the root domain and unrelated services. R2 CORS permits only the formal origin. Uploads default to disabled until account usage, credentials and acceptance are checked.

Preserve existing `BETTER_AUTH_SECRET`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` when deploying. Add `D1_BACKUP_API_TOKEN` with only D1 Read on the selected account; this platform permission is account-wide, not database-scoped. R2 writes use the private binding. Keep secrets out of source, artifacts and logs. Verify a successful backup after rotation.

Record Worker version/deployment, D1 migrations, routes and client digest. Roll back to the previous Worker version and recheck catalog, login and upload Origin. Keep additive compatible schema. Local DB5 downgrades require stopping every host/shared writer, exporting new data and restoring the consistent pre-upgrade backup. Never open DB5 using an old binary or edit user_version.

## Quotas and diagnostics

Do not enable Workers Paid, Containers or automatic upgrades. Daily check actual Workers/D1/R2/SQLite DO shared usage, failures and storage. Application limits do not prove remaining account allowance. Stop new uploads before investigating exhaustion.

Daily application limits include 128 reservations/validations, 256 signatures, 2000 password computations, at most 100 unreclaimed uploads and 1 GiB reserved storage. Public reads allow 120/minute/IP; reports allow 5/hour. Signed-URL replay may consume additional R2 operations, so these limits are not an absolute billing cap. Set `UPLOAD_ENABLED=false` near account thresholds and verify rejection while published reads/reporting remain available. Retain error codes/request IDs, never cookies, credentials, full headers, SQL or model inputs.

`GET /v1/health` exposes backup state and the latest successful snapshot time; missing, failed or older-than-24-hour snapshots return 503. Monitor non-200 responses. The timestamp conservatively uses export start rather than delayed completion. API `Server-Timing: amoji;dur=…` includes Worker/DO service work, excluding the client network.

## Private backup and actual recovery

The existing 15-minute cron advances official D1 exports in a separate backup DO. Start a new snapshot every 12 hours to leave retry margin. Bookmarks stay in private R2; downloads allow only the observed Cloudflare export hostname and reject redirects. SQL is capped at 32 MiB; over-limit backups fail without replacing the previous good snapshot. SHA-256-addressed SQL and state live under `backups/`, retained for 30 days independently of business cleanup. Publish the success pointer only after the complete SQL object is durable. Reevaluate capacity before exceeding the bound; never truncate.

Backups contain authentication/private content and are restricted to authorized operators, without public download. Published sealed objects retain immutable digest-bound references. Recovery must verify objects as well as SQL. Backup residues after account deletion expire within 30 days. Same-platform storage is not provider-independent disaster recovery.

For a drill: privately retrieve the exact successful SQL/status into a 0700 directory with 0600 files; run `node apps/marketplace/scripts/verify-backup.mjs SQL_FILE STATUS_JSON NEW_PRIVATE_DIRECTORY` to verify digest, SQLite integrity/foreign keys and exact release/pointer state. This is offline verification only. Create isolated D1/R2/Worker resources, import the same SQL into the empty database, copy required sealed objects and verify each digest. Confirm exact review/removal state and anonymously retrieve approved content while denying private/removed releases. Record snapshot/start/completion times and prove RPO ≤24h/RTO ≤4h. Clean up only drill resources, retaining redacted evidence and formal backups. Time Travel and scripts alone do not establish a successful restore.

## Performance

`apps/marketplace/scripts/catalog-load-fixture.mjs PRIVATE_OUTPUT.sql` generates 10000 synthetic packs for an **isolated performance database only**. Never pollute the production catalog. Apply the same migrations and Worker build with real D1 and record the count. `measure-catalog.mjs HTTPS_ORIGIN NETWORK_LABEL PRIVATE_OUTPUT.json` runs 100 reads with 20 concurrent clients, requiring server metadata p95 ≤500ms and first-page p95 ≤2s on a declared regional network. HTTP timing does not establish browser rendering; verify the actual page separately.

Human user/creator studies require informed participants and remain explicitly unverified until actually performed.
