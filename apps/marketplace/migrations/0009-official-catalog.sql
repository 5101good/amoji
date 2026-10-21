-- Only operators can designate official creators or pin a public collection.
CREATE TABLE market_official_creator (
 account_id TEXT PRIMARY KEY REFERENCES market_account(id),
 reason TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
ALTER TABLE market_public_pack ADD COLUMN priority INTEGER NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 3);
CREATE INDEX market_public_priority_order ON market_public_pack(priority,updated_at,pack_id);
