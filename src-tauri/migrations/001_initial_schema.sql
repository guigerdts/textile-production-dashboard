-- Ticket 10.1: Phase 1 schema
-- Tables: jornada, orden, lectura_golpe

-- Jornada del turno: one record per production day
CREATE TABLE IF NOT EXISTS jornada (
    fecha_operativa TEXT PRIMARY KEY,
    inicio TEXT NOT NULL,
    fin TEXT NOT NULL
);

-- Orden de produccion: one record per production order
CREATE TABLE IF NOT EXISTS orden (
    id TEXT PRIMARY KEY,
    numero_orden TEXT NOT NULL,
    fecha_operativa TEXT NOT NULL,
    referencia_tela TEXT NOT NULL,
    disenio TEXT NOT NULL,
    unidades_solicitadas INTEGER NOT NULL,
    unidades_producidas INTEGER NOT NULL DEFAULT 0,
    unidades_primera INTEGER NOT NULL DEFAULT 0,
    unidades_segunda INTEGER NOT NULL DEFAULT 0,
    estado TEXT NOT NULL DEFAULT 'available',
    operario TEXT,
    machine_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Lectura de golpe: each print cycle reading
CREATE TABLE IF NOT EXISTS lectura_golpe (
    id TEXT PRIMARY KEY,
    orden_id TEXT NOT NULL,
    valor INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    sequence INTEGER,
    status TEXT NOT NULL DEFAULT 'persisted',
    FOREIGN KEY (orden_id) REFERENCES orden(id)
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_orden_fecha ON orden(fecha_operativa);
CREATE INDEX IF NOT EXISTS idx_lectura_orden ON lectura_golpe(orden_id);
CREATE INDEX IF NOT EXISTS idx_lectura_status ON lectura_golpe(status);
