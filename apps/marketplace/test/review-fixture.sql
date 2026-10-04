CREATE TABLE fixture_submission(id TEXT PRIMARY KEY,state TEXT NOT NULL DEFAULT 'pending',version INTEGER NOT NULL DEFAULT 0, operation TEXT);
CREATE TABLE fixture_operation(key TEXT PRIMARY KEY, payload TEXT NOT NULL, success INTEGER NOT NULL CHECK(success=1));
CREATE TABLE fixture_audit(key TEXT PRIMARY KEY REFERENCES fixture_operation(key), submission TEXT NOT NULL, action TEXT NOT NULL);
INSERT INTO fixture_submission(id) VALUES ('rollback'),('stale'),('retry'),('race');
