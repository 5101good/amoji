-- Amoji 0.1 packs (RFC §9): releases are indexed by the acts they realize and
-- by the pack locales, collaboration effects replace actions, and visual styles
-- are no longer protocol data. Rows published before this migration used the
-- retired schema and are not readable by 0.1 clients. There were none at launch.
ALTER TABLE market_public_release RENAME COLUMN scenarios TO acts;
ALTER TABLE market_public_release RENAME COLUMN has_actions TO has_effects;
ALTER TABLE market_public_release DROP COLUMN styles;
