CREATE TABLE auth_user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL DEFAULT 0, image TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE TABLE auth_session (id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT, userId TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE);
CREATE INDEX auth_session_user ON auth_session(userId);
CREATE TABLE auth_account (id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL, userId TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE, accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt INTEGER, refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE INDEX auth_account_user ON auth_account(userId);
CREATE UNIQUE INDEX auth_account_identity ON auth_account(providerId,accountId);
CREATE TABLE auth_verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expiresAt INTEGER NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE INDEX auth_verification_identifier ON auth_verification(identifier);
CREATE TABLE market_account (id TEXT PRIMARY KEY, auth_user_id TEXT NOT NULL UNIQUE REFERENCES auth_user(id), display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'creator' CHECK(role IN ('creator','reviewer','moderator','admin')), disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)));
CREATE TABLE auth_rate_limit (key TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(key,bucket));

CREATE INDEX auth_rate_limit_bucket ON auth_rate_limit(bucket);
