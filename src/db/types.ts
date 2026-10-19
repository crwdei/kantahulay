export interface Song {
  code: string;
  title: string;
  artist: string;
  search_key: string;
  duration_ticks: number;
  has_singable_lyrics: number;
  pack_offset: number;
  packed_size: number;
  unpacked_size: number;
  midi_sha256: string;
}

export interface QueueItem {
  reservation_id: number;
  song_code: string;
  reserved_at: number;
  status: 'pending' | 'active';
  key_offset: number;
  title?: string;
  artist?: string;
}

export interface AppState {
  id: number;
  selected_language: string;
  selected_theme: string;
  selected_scenery: string;
  catalog_hash: string | null;
  pack_format_version: number | null;
  last_successful_bundle_check: number | null;
}
