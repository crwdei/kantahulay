export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS songs (
  code TEXT PRIMARY KEY NOT NULL CHECK(length(code) = 6 AND code NOT GLOB '*[^0-9]*'),
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  search_key TEXT NOT NULL,
  duration_ticks INTEGER NOT NULL DEFAULT 0,
  has_singable_lyrics INTEGER NOT NULL CHECK(has_singable_lyrics IN (0,1)),
  pack_offset INTEGER NOT NULL CHECK(pack_offset >= 16),
  packed_size INTEGER NOT NULL CHECK(packed_size > 0),
  unpacked_size INTEGER NOT NULL CHECK(unpacked_size > 0),
  midi_sha256 TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_songs_browse
  ON songs(title COLLATE NOCASE, code);

CREATE TABLE IF NOT EXISTS queue (
  reservation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_code TEXT NOT NULL CHECK(length(song_code) = 6 AND song_code NOT GLOB '*[^0-9]*'),
  reserved_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active')),
  key_offset INTEGER NOT NULL DEFAULT 0 CHECK(key_offset BETWEEN -6 AND 6)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_one_active
  ON queue(status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  selected_language TEXT NOT NULL DEFAULT 'en',
  selected_theme TEXT NOT NULL DEFAULT 'system',
  selected_scenery TEXT NOT NULL DEFAULT 'static',
  catalog_hash TEXT,
  pack_format_version INTEGER,
  last_successful_bundle_check INTEGER,
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  bluetooth_lyric_offset_ms INTEGER NOT NULL DEFAULT 0,
  vocal_effects_level INTEGER NOT NULL DEFAULT 1,
  music_volume REAL NOT NULL DEFAULT 1.0
);

INSERT INTO app_state (id) VALUES (1) ON CONFLICT(id) DO NOTHING;
`;
