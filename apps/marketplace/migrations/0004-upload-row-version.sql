ALTER TABLE market_direct_upload ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version>0);
