-- CHANGE 1 (operational-event-operative-date): explicit operative day on machine events
-- Adds one column to each of the four machine-event tables that were not
-- already day-bound through their orden: parada, actividad_planificada, dano and
-- mantenimiento. inspeccion_tela is deliberately untouched: an inspection is
-- always an event of an orden and reaches its day through it.
--
-- fecha_operativa is the ONLY determinant of which shift an event belongs to.
-- It is NOT derived from inicio: inicio stays a real UTC instant, and an event
-- registered on the night of the 11th keeps the 11th even if it closes on the
-- 12th. Overlap semantics do not exist: an event belongs to exactly one day.
--
-- NOT NULL without DEFAULT, and no backfill: SQLite can only satisfy this
-- ALTER on an empty table, so applying it to a database that already holds
-- machine events fails loudly instead of inventing an operative day. That is
-- the intended behavior for this change — the app has never written one, so
-- there is no correct value to backfill, and a guessed date would be
-- irreversible once persisted. Such a database must be rebuilt from a fresh
-- schema, which the app does automatically when its store is empty.
--
-- Physical column order: ALTER TABLE appends, so fecha_operativa becomes the
-- last column of each table regardless of where it is read.
--
-- Up-only, matching the existing migration mechanism: no Down migrations, and
-- applied migrations must never be edited (sqlx checksum validation fails
-- startup with VersionMismatch).

ALTER TABLE parada ADD COLUMN fecha_operativa TEXT NOT NULL;
ALTER TABLE actividad_planificada ADD COLUMN fecha_operativa TEXT NOT NULL;
ALTER TABLE dano ADD COLUMN fecha_operativa TEXT NOT NULL;
ALTER TABLE mantenimiento ADD COLUMN fecha_operativa TEXT NOT NULL;

-- Indexes for the day-scoped reads this change unblocks: one per query the
-- repositories issue when listing the machine events of one operative day,
-- none speculative. The existing idx_*_maquina_inicio indexes stay: full
-- machine history ordered by instant is still a real query.
CREATE INDEX IF NOT EXISTS idx_parada_maquina_fecha ON parada(machine_id, fecha_operativa);
CREATE INDEX IF NOT EXISTS idx_actividad_maquina_fecha ON actividad_planificada(machine_id, fecha_operativa);
CREATE INDEX IF NOT EXISTS idx_dano_maquina_fecha ON dano(machine_id, fecha_operativa);
CREATE INDEX IF NOT EXISTS idx_mantenimiento_maquina_fecha ON mantenimiento(machine_id, fecha_operativa);