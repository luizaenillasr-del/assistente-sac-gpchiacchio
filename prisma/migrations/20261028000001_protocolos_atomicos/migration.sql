CREATE TABLE IF NOT EXISTS protocol_counter (
  chave TEXT PRIMARY KEY,
  seq INTEGER NOT NULL CHECK (seq > 0)
);

CREATE TABLE IF NOT EXISTS protocol_reservation (
  idempotency_key TEXT PRIMARY KEY,
  chave TEXT NOT NULL,
  protocolo TEXT NOT NULL UNIQUE,
  seq INTEGER NOT NULL CHECK (seq > 0),
  status TEXT NOT NULL DEFAULT 'RESERVED'
    CHECK (status IN ('RESERVED', 'PERSISTED', 'PERSISTENCE_FAILED')),
  entity_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chave, seq)
);

CREATE INDEX IF NOT EXISTS protocol_reservation_status_idx
  ON protocol_reservation (status, updated_at);
