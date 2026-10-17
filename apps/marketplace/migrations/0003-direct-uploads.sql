-- Separate from the retired multipart quarantine schema. No historical objects are adopted.
CREATE TABLE market_upload_pack(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES market_account(id));
CREATE TABLE market_direct_upload(
 id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES market_account(id),operation TEXT NOT NULL,request_hash TEXT NOT NULL,
 pack_id TEXT NOT NULL REFERENCES market_upload_pack(id),release_id TEXT NOT NULL UNIQUE,version INTEGER NOT NULL,
 length INTEGER CHECK(length BETWEEN 1 AND 10485760),sha256 TEXT,object_key TEXT NOT NULL UNIQUE,sealed_key TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','uploaded','validating','valid','invalid','expired')),
 created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,authorize_key TEXT,complete_key TEXT,validation_error TEXT,manifest_sha256 TEXT,
 cleaned INTEGER NOT NULL DEFAULT 0,UNIQUE(owner,operation),UNIQUE(pack_id,version)
);
CREATE INDEX market_direct_upload_expiry ON market_direct_upload(state,expires_at);
CREATE TABLE market_direct_upload_reference(upload_id TEXT NOT NULL REFERENCES market_direct_upload(id),reference_id TEXT NOT NULL,PRIMARY KEY(upload_id,reference_id));
CREATE TRIGGER market_direct_upload_reference_valid BEFORE INSERT ON market_direct_upload_reference
WHEN NOT EXISTS(SELECT 1 FROM market_direct_upload WHERE id=NEW.upload_id AND state='valid')
BEGIN SELECT RAISE(ABORT,'UPLOAD_NOT_VALID'); END;
CREATE TRIGGER market_direct_upload_keep_referenced BEFORE UPDATE OF state ON market_direct_upload
WHEN NEW.state='expired' AND EXISTS(SELECT 1 FROM market_direct_upload_reference WHERE upload_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'UPLOAD_REFERENCED'); END;
CREATE TABLE market_runtime_budget(day INTEGER NOT NULL,kind TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(day,kind));
