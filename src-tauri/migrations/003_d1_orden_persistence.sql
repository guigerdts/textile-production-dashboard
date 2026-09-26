-- Ticket 10-9: D-1 orden persistence columns
-- Adds the four persistable D-1 columns to orden (aplica_segunda,
-- porcentaje_2da, tipo_pintura, finalizada_en). Existing rows receive only
-- their literal defaults (0 / 0 / 'reactiva' / NULL); no backfill, no derived
-- values, no new indexes or constraints. Up-only, matching the existing
-- migration mechanism: no Down migrations, and applied migrations must never
-- be edited (sqlx checksum validation fails startup with VersionMismatch).

ALTER TABLE orden ADD COLUMN aplica_segunda INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orden ADD COLUMN porcentaje_2da REAL NOT NULL DEFAULT 0;
ALTER TABLE orden ADD COLUMN tipo_pintura TEXT NOT NULL DEFAULT 'reactiva';
ALTER TABLE orden ADD COLUMN finalizada_en TEXT;