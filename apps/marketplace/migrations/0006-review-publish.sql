CREATE TABLE market_public_release (
 release_id TEXT PRIMARY KEY REFERENCES market_submission(release_id), pack_id TEXT NOT NULL, submission_id TEXT NOT NULL UNIQUE REFERENCES market_submission(id),
 manifest TEXT NOT NULL, archive_sha256 TEXT NOT NULL, manifest_sha256 TEXT NOT NULL, author TEXT NOT NULL,
 name TEXT NOT NULL, search_text TEXT NOT NULL, scenarios TEXT NOT NULL, locales TEXT NOT NULL, styles TEXT NOT NULL, has_actions INTEGER NOT NULL,
 published_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'published' CHECK(state IN ('published','unpublished','safety_removed'))
);
CREATE TABLE market_public_pack (pack_id TEXT PRIMARY KEY REFERENCES market_upload_pack(id), release_id TEXT NOT NULL REFERENCES market_public_release(release_id), updated_at INTEGER NOT NULL);
CREATE INDEX market_public_order ON market_public_pack(updated_at,pack_id);
CREATE TABLE market_review_audit (id TEXT PRIMARY KEY, actor TEXT NOT NULL REFERENCES market_account(id), submission_id TEXT NOT NULL REFERENCES market_submission(id), release_id TEXT NOT NULL, archive_sha256 TEXT NOT NULL, previous_state TEXT NOT NULL, next_state TEXT NOT NULL, reason TEXT NOT NULL, request_id TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TRIGGER market_review_audit_no_update BEFORE UPDATE ON market_review_audit BEGIN SELECT RAISE(ABORT,'AUDIT_APPEND_ONLY'); END;
CREATE TRIGGER market_review_audit_no_delete BEFORE DELETE ON market_review_audit BEGIN SELECT RAISE(ABORT,'AUDIT_APPEND_ONLY'); END;
CREATE TABLE market_role_bootstrap (id TEXT PRIMARY KEY CHECK(id='initial'), account_id TEXT NOT NULL REFERENCES market_account(id), operator TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TRIGGER market_role_bootstrap_guard BEFORE INSERT ON market_role_bootstrap WHEN EXISTS(SELECT 1 FROM market_account WHERE role IN ('admin','reviewer')) BEGIN SELECT RAISE(ABORT,'ALREADY_INITIALIZED'); END;
CREATE TRIGGER market_role_bootstrap_account_guard BEFORE INSERT ON market_role_bootstrap WHEN NOT EXISTS(SELECT 1 FROM market_account WHERE id=NEW.account_id AND disabled=0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_UNAVAILABLE'); END;
CREATE TRIGGER market_role_bootstrap_apply AFTER INSERT ON market_role_bootstrap BEGIN UPDATE market_account SET role='admin' WHERE id=NEW.account_id; END;
CREATE TRIGGER market_role_bootstrap_no_update BEFORE UPDATE ON market_role_bootstrap BEGIN SELECT RAISE(ABORT,'AUDIT_APPEND_ONLY'); END;
CREATE TRIGGER market_role_bootstrap_no_delete BEFORE DELETE ON market_role_bootstrap BEGIN SELECT RAISE(ABORT,'AUDIT_APPEND_ONLY'); END;
