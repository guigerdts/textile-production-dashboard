-- Ticket 10 (Phase 2): operational events schema
-- Tables: parada, actividad_planificada, dano, inspeccion_tela, mantenimiento
-- Five tables, 59 columns, 5 foreign keys, 11 indexes. No schema-level
-- validation constraints and no implicit column values: every business rule
-- stays in src/domain/**, following 001/002/003. No derived value is stored
-- (durations, tiempo productivo, projected 2da, conAnomalia, estado de tela,
-- machine state) — all of them are recomputed on read.
-- Up-only, matching the existing migration mechanism: no Down migrations, and
-- applied migrations must never be edited (sqlx checksum validation fails
-- startup with VersionMismatch).

-- Parada de la maquina: one record per stop. orden_id is nullable because a
-- stop is registrable on an empty day; campos_especificos holds the per-cause
-- fields as a single JSON TEXT column; fin NULL = parada abierta (ParadaAbierta
-- is a type alias, never a stored discriminator).
CREATE TABLE IF NOT EXISTS parada (
    id TEXT PRIMARY KEY,
    machine_id TEXT NOT NULL,
    orden_id TEXT,
    operario TEXT NOT NULL,
    causa_id TEXT NOT NULL,
    campos_especificos TEXT NOT NULL,
    observaciones TEXT,
    inicio TEXT NOT NULL,
    fin TEXT,
    FOREIGN KEY (orden_id) REFERENCES orden(id)
);

-- Actividad planificada: tiempo no productivo planificado. No orden_id by
-- design (ADR 0005): registrable on a day with no production order.
CREATE TABLE IF NOT EXISTS actividad_planificada (
    id TEXT PRIMARY KEY,
    machine_id TEXT NOT NULL,
    tipo TEXT NOT NULL,
    inicio TEXT NOT NULL,
    fin TEXT,
    que_se_limpio TEXT,
    observaciones TEXT,
    operario TEXT NOT NULL
);

-- Dano: an independent event, NOT a parada. causo_parada and posible_segunda are
-- two independent 0/1 INTEGERs (1 = true, 0 = false, like orden.aplica_segunda
-- in 003); no schema constraint ties either of them to parada_id or
-- unidades_sospechadas, because that coupling is a domain rule.
CREATE TABLE IF NOT EXISTS dano (
    id TEXT PRIMARY KEY,
    machine_id TEXT NOT NULL,
    orden_id TEXT,
    operario TEXT NOT NULL,
    tipo TEXT NOT NULL,
    componente TEXT NOT NULL,
    inicio TEXT NOT NULL,
    fin TEXT,
    solucion_aplicada TEXT,
    causo_parada INTEGER NOT NULL,
    parada_id TEXT,
    posible_segunda INTEGER NOT NULL,
    unidades_sospechadas INTEGER,
    observaciones TEXT,
    FOREIGN KEY (orden_id) REFERENCES orden(id),
    FOREIGN KEY (parada_id) REFERENCES parada(id)
);

-- Inspeccion de tela: always an event of an orden, so orden_id is NOT NULL. The
-- five catalog items (absorcion, tundido, manchas, dimensiones, estado_general)
-- are flat NOT NULL columns because the domain always validates exactly 5 items
-- with an explicit state; conAnomalia and estado de tela are derived on every
-- read and therefore have no column. The six resolution columns cover the whole
-- ResolucionInspeccion union (devolucion + autorizacion_gerencia).
CREATE TABLE IF NOT EXISTS inspeccion_tela (
    id TEXT PRIMARY KEY,
    orden_id TEXT NOT NULL,
    operario TEXT NOT NULL,
    lote TEXT,
    absorcion TEXT NOT NULL,
    tundido TEXT NOT NULL,
    manchas TEXT NOT NULL,
    dimensiones TEXT NOT NULL,
    estado_general TEXT NOT NULL,
    otra_anomalia TEXT,
    timestamp TEXT NOT NULL,
    observaciones TEXT,
    resolucion TEXT,
    motivo_devolucion TEXT,
    autorizado_por TEXT,
    registrada_por TEXT,
    resolucion_timestamp TEXT,
    autorizacion_observaciones TEXT,
    FOREIGN KEY (orden_id) REFERENCES orden(id)
);

-- Mantenimiento: machine-level documentary event, never tied to an orden and
-- never per paint chemistry (ADR 0006). No duracion column: the duration is
-- always derived and never deducts productive time (ADR 0007). dano_id is
-- optional (reactive only) and never a precondition for the write.
CREATE TABLE IF NOT EXISTS mantenimiento (
    id TEXT PRIMARY KEY,
    machine_id TEXT NOT NULL,
    tipo TEXT NOT NULL,
    operario TEXT NOT NULL,
    motivo TEXT NOT NULL,
    inicio TEXT NOT NULL,
    fin TEXT,
    que_se_reviso_reparo TEXT,
    dano_id TEXT,
    observaciones TEXT,
    FOREIGN KEY (dano_id) REFERENCES dano(id)
);

-- Indexes for efficient lookups: one per query the repositories actually issue,
-- none speculative.
-- Machine events, chronological (listarPorMaquina).
CREATE INDEX IF NOT EXISTS idx_parada_maquina_inicio ON parada(machine_id, inicio);
CREATE INDEX IF NOT EXISTS idx_actividad_maquina_inicio ON actividad_planificada(machine_id, inicio);
CREATE INDEX IF NOT EXISTS idx_dano_maquina_inicio ON dano(machine_id, inicio);
CREATE INDEX IF NOT EXISTS idx_mantenimiento_maquina_inicio ON mantenimiento(machine_id, inicio);

-- Open records (fin IS NULL) for the get*Abierta queries.
CREATE INDEX IF NOT EXISTS idx_parada_abierta ON parada(machine_id, orden_id) WHERE fin IS NULL;
CREATE INDEX IF NOT EXISTS idx_actividad_abierta ON actividad_planificada(machine_id, tipo) WHERE fin IS NULL;
CREATE INDEX IF NOT EXISTS idx_dano_abierta ON dano(machine_id) WHERE fin IS NULL;
CREATE INDEX IF NOT EXISTS idx_mantenimiento_abierta ON mantenimiento(machine_id) WHERE fin IS NULL;

-- Per-order reads (listarPorOrden; for dano it is also the 2da projection input).
CREATE INDEX IF NOT EXISTS idx_parada_orden ON parada(orden_id);
CREATE INDEX IF NOT EXISTS idx_dano_orden ON dano(orden_id);
CREATE INDEX IF NOT EXISTS idx_inspeccion_orden ON inspeccion_tela(orden_id, timestamp);
