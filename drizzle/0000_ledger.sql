CREATE TABLE ledger_states (
  owner_id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE ledger_history (
  owner_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, revision)
);
--> statement-breakpoint
CREATE TRIGGER preserve_ledger BEFORE UPDATE ON ledger_states
BEGIN
  INSERT INTO ledger_history (owner_id, revision, payload, updated_at)
  VALUES (OLD.owner_id, OLD.revision, OLD.payload, OLD.updated_at);
END;
