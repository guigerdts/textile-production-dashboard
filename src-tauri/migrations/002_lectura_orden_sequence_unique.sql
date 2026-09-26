-- Ticket 10.5: UNIQUE(orden_id, sequence) final barrier
-- Decision (documented in 10-1): do NOT edit 001 — sqlx-core checksum
-- validation fails startup with VersionMismatch for edited applied migrations,
-- and SQLite has no ALTER TABLE ADD CONSTRAINT. A unique index is the exact
-- equivalent guarantee: at most one lecture per (orden_id, sequence).

CREATE UNIQUE INDEX IF NOT EXISTS idx_lectura_orden_sequence
    ON lectura_golpe(orden_id, sequence);