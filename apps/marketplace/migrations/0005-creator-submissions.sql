CREATE TABLE market_submission (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES market_account(id), upload_id TEXT NOT NULL UNIQUE REFERENCES market_direct_upload(id),
 pack_id TEXT NOT NULL, release_id TEXT NOT NULL UNIQUE, version INTEGER NOT NULL,
 archive_sha256 TEXT NOT NULL, manifest_sha256 TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','published','changes_requested','withdrawn')),
 row_version INTEGER NOT NULL DEFAULT 1, reason TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_operation TEXT NOT NULL,
 UNIQUE(pack_id,version)
);
CREATE INDEX market_submission_owner ON market_submission(owner,created_at,id);
CREATE INDEX market_submission_queue ON market_submission(state,created_at,id);
CREATE TABLE market_submission_operation (
 owner TEXT NOT NULL REFERENCES market_account(id), operation TEXT NOT NULL, route TEXT NOT NULL, request_hash TEXT NOT NULL,
 status INTEGER NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(owner,operation)
);
CREATE TRIGGER market_submission_immutable BEFORE UPDATE OF owner,upload_id,pack_id,release_id,version,archive_sha256,manifest_sha256,created_at ON market_submission
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SUBMISSION'); END;
CREATE TRIGGER market_submission_insert_guard BEFORE INSERT ON market_submission
WHEN NOT EXISTS(SELECT 1 FROM market_direct_upload u JOIN market_account a ON a.id=u.owner WHERE u.id=NEW.upload_id AND u.owner=NEW.owner AND a.disabled=0 AND u.state='valid' AND u.expires_at>NEW.created_at AND u.pack_id=NEW.pack_id AND u.release_id=NEW.release_id AND u.version=NEW.version AND u.sha256=NEW.archive_sha256 AND u.manifest_sha256=NEW.manifest_sha256)
BEGIN SELECT RAISE(ABORT,'UPLOAD_NOT_VALID'); END;
CREATE TRIGGER market_submission_quota_guard BEFORE INSERT ON market_submission
WHEN (SELECT count(*) FROM market_submission WHERE owner=NEW.owner AND state='pending')>=10 OR (SELECT count(*) FROM market_submission WHERE owner=NEW.owner AND created_at>=NEW.created_at-(NEW.created_at%86400000))>=10
BEGIN SELECT RAISE(ABORT,'SUBMISSION_QUOTA'); END;
CREATE TABLE market_content_identity(kind TEXT NOT NULL,id TEXT NOT NULL,revision TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(kind,id,revision));
CREATE TRIGGER market_content_identity_immutable BEFORE UPDATE OF digest ON market_content_identity
WHEN OLD.digest != NEW.digest BEGIN SELECT RAISE(ABORT,'CONTENT_IDENTITY_CONFLICT'); END;
