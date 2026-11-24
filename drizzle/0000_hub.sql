CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  stance TEXT NOT NULL DEFAULT '',
  appearance_json TEXT NOT NULL DEFAULT '{}',
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_turn_order INTEGER NOT NULL DEFAULT 0,
  next_turn_at INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  UNIQUE(room_id, agent_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS participants_room ON participants(room_id, id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL UNIQUE REFERENCES rooms(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  turn_order INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  claim_id TEXT NOT NULL UNIQUE,
  agent_name TEXT NOT NULL,
  appearance_json TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS messages_room ON messages(room_id, created_at, id);
