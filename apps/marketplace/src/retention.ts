import type { UploadEnv } from "./upload-shared";
/** Runs in the same serialized Durable Object as publication and upload sealing. */
export async function cleanupLifecycle(env: UploadEnv, now = Date.now()) {
  const day = 86400000;
  // Release upload references only for never-public, retired private submissions.
  // Exact published releases and any independent reference always retain their objects.
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM market_direct_upload_reference WHERE reference_id IN (SELECT id FROM market_submission s WHERE s.state IN ('withdrawn','changes_requested') AND (s.updated_at<? OR EXISTS(SELECT 1 FROM market_account a WHERE a.id=s.owner AND a.deleted_at<=?)) AND NOT EXISTS(SELECT 1 FROM market_public_release r WHERE r.submission_id=s.id))",
    ).bind(now - 90 * day, now - 30 * day),
    env.DB.prepare(
      "UPDATE market_submission SET reason=NULL WHERE state IN ('withdrawn','changes_requested') AND (updated_at<? OR EXISTS(SELECT 1 FROM market_account a WHERE a.id=market_submission.owner AND a.deleted_at<=?)) AND NOT EXISTS(SELECT 1 FROM market_public_release r WHERE r.submission_id=market_submission.id)",
    ).bind(now - 90 * day, now - 30 * day),
    env.DB.prepare(
      "DELETE FROM market_lifecycle_operation WHERE created_at<?",
    ).bind(now - 30 * day),
    env.DB.prepare(
      "DELETE FROM market_submission_operation WHERE created_at<?",
    ).bind(now - 30 * day),
    env.DB.prepare("DELETE FROM market_report WHERE updated_at<?").bind(
      now - 180 * day,
    ),
    env.DB.prepare(
      "INSERT INTO market_retention_clock VALUES('cleanup',?) ON CONFLICT(id) DO UPDATE SET audit_before=excluded.audit_before",
    ).bind(now - 180 * day),
    env.DB.prepare(
      "DELETE FROM market_lifecycle_audit WHERE created_at<?",
    ).bind(now - 180 * day),
    env.DB.prepare(
      "DELETE FROM market_review_audit WHERE created_at<? AND NOT EXISTS(SELECT 1 FROM market_public_release WHERE release_id=market_review_audit.release_id AND state='published')",
    ).bind(now - 180 * day),
    env.DB.prepare(
      "DELETE FROM auth_account WHERE userId IN (SELECT auth_user_id FROM market_account WHERE deleted_at<=?)",
    ).bind(now - 30 * day),
    env.DB.prepare(
      "UPDATE auth_user SET name='Deleted account',email='deleted-'||id||'@invalid.invalid',image=NULL,emailVerified=0 WHERE id IN (SELECT auth_user_id FROM market_account WHERE deleted_at<=?)",
    ).bind(now - 30 * day),
    env.DB.prepare(
      "UPDATE market_account SET display_name='Deleted account' WHERE deleted_at<=?",
    ).bind(now - 30 * day),
    env.DB.prepare(
      "DELETE FROM market_device_refresh WHERE family IN (SELECT f.id FROM market_device_family f JOIN market_account a ON a.id=f.owner WHERE a.deleted_at<=?)",
    ).bind(now - 30 * day),
    env.DB.prepare(
      "DELETE FROM market_device_family WHERE owner IN (SELECT id FROM market_account WHERE deleted_at<=?)",
    ).bind(now - 30 * day),
    env.DB.prepare(
      "DELETE FROM market_device_authorization WHERE expires_at<?",
    ).bind(now - 30 * day),
    env.DB.prepare("DELETE FROM auth_verification WHERE expiresAt<?").bind(
      now - 30 * day,
    ),
    env.DB.prepare("DELETE FROM auth_session WHERE expiresAt<?").bind(
      now - 30 * day,
    ),
  ]);
}
