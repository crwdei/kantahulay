import { getDatabaseAsync } from './database';
import { Song } from './types';

export function normalizeSearchQuery(query: string): string {
  return query
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const COMMON_CONTRACTIONS: Record<string, string> = {
  cant: 'can t',
  dont: 'don t',
  wont: 'won t',
  whats: 'what s',
  thats: 'that s',
  isnt: 'isn t',
  arent: 'aren t',
  didnt: 'didn t',
  wasnt: 'wasn t',
  werent: 'weren t',
  hasnt: 'hasn t',
  havent: 'haven t',
  hadnt: 'hadn t',
};

export class SongDao {
  static async getByCode(code: string): Promise<Song | null> {
    const db = await getDatabaseAsync();
    const row = await db.getFirstAsync<Song>(
      `SELECT code, title, artist, search_key, duration_ticks, has_singable_lyrics,
              pack_offset, packed_size, unpacked_size, midi_sha256
       FROM songs
       WHERE code = ?
       LIMIT 1;`,
      [code]
    );
    return row || null;
  }

  static async search(query: string, limit: number = 50, offset: number = 0): Promise<Song[]> {
    const db = await getDatabaseAsync();
    const rawTrimmed = query.trim();
    if (!rawTrimmed) {
      return this.browse(limit, offset);
    }

    const isNumeric = /^\d{1,6}$/.test(rawTrimmed);
    const clean = rawTrimmed
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    const stripped = clean.replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const spaced = clean.replace(/['’]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

    const patterns = new Set<string>();
    if (stripped) patterns.add(stripped);
    if (spaced) patterns.add(spaced);
    // Expand only known complete contraction words, never normal words like hell/shell.
    const legacySpaced = stripped.split(' ').map((word) => COMMON_CONTRACTIONS[word] ?? word).join(' ');
    if (legacySpaced) patterns.add(legacySpaced);

    const escapeLike = (s: string) =>
      s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

    if (isNumeric) {
      const paddedCode = rawTrimmed.padStart(6, '0');
      const likeClause = Array.from(patterns)
        .map(() => `search_key LIKE ? ESCAPE '\\'`)
        .join(' OR ');
      const likeParams = Array.from(patterns).map((p) => `%${escapeLike(p)}%`);

      return await db.getAllAsync<Song>(
        `SELECT code, title, artist, search_key, duration_ticks, has_singable_lyrics,
                pack_offset, packed_size, unpacked_size, midi_sha256
         FROM songs
         WHERE code = ? OR code = ? OR code LIKE ? OR code LIKE ? ${likeClause ? `OR (${likeClause})` : ''}
         ORDER BY (code = ?) DESC, (code = ?) DESC, (code LIKE ?) DESC, code ASC, title COLLATE NOCASE
         LIMIT ? OFFSET ?;`,
        [
          rawTrimmed,
          paddedCode,
          `${rawTrimmed}%`,
          `${paddedCode}%`,
          ...likeParams,
          rawTrimmed,
          paddedCode,
          `${rawTrimmed}%`,
          limit,
          offset,
        ]
      );
    }

    const likeClause = Array.from(patterns)
      .map(() => `search_key LIKE ? ESCAPE '\\'`)
      .join(' OR ');
    const likeParams = Array.from(patterns).map((p) => `%${escapeLike(p)}%`);

    if (!likeClause) {
      return this.browse(limit, offset);
    }

    return await db.getAllAsync<Song>(
      `SELECT code, title, artist, search_key, duration_ticks, has_singable_lyrics,
              pack_offset, packed_size, unpacked_size, midi_sha256
       FROM songs
       WHERE ${likeClause}
       ORDER BY title COLLATE NOCASE, code
       LIMIT ? OFFSET ?;`,
      [...likeParams, limit, offset]
    );
  }

  static async searchWithFallback(
    query: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{ songs: Song[]; isFallback: boolean }> {
    const rawTrimmed = query.trim();
    if (!rawTrimmed) {
      const browseSongs = await this.browse(limit, offset);
      return { songs: browseSongs, isFallback: false };
    }

    // 1. Direct search
    const directResults = await this.search(query, limit, offset);
    if (directResults.length > 0 || offset > 0) {
      return { songs: directResults, isFallback: false };
    }

    // 2. If 0 results on initial search (offset 0), try typo-tolerant trigram/prefix fallback
    const isNumeric = /^\d{1,6}$/.test(rawTrimmed);
    if (isNumeric) {
      return { songs: [], isFallback: false };
    }

    const clean = rawTrimmed
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

    const words = clean.split(' ').filter(Boolean);
    const trigrams = new Set<string>();
    for (const w of words) {
      if (w.length <= 3) {
        trigrams.add(w);
      } else {
        for (let i = 0; i <= w.length - 3; i++) {
          trigrams.add(w.slice(i, i + 3));
        }
      }
    }

    const selected = Array.from(trigrams).slice(0, 4);
    if (selected.length === 0) {
      return { songs: [], isFallback: false };
    }

    const escapeLike = (s: string) =>
      s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

    const clauses = selected.map(() => `search_key LIKE ?`).join(' OR ');
    const params = selected.map((tg) => `%${escapeLike(tg)}%`);

    const db = await getDatabaseAsync();
    const fallbackMatches = await db.getAllAsync<Song>(
      `SELECT code, title, artist, search_key, duration_ticks, has_singable_lyrics,
              pack_offset, packed_size, unpacked_size, midi_sha256
       FROM songs
       WHERE ${clauses}
       LIMIT 100;`,
      params
    );

    if (!fallbackMatches || fallbackMatches.length === 0) {
      return { songs: [], isFallback: false };
    }

    // Score by trigram matches
    const scored = fallbackMatches.map((song) => {
      const sk = song.search_key || '';
      let score = 0;
      for (const tg of trigrams) {
        if (sk.includes(tg)) score++;
      }
      return { song, score };
    });

    scored.sort((a, b) => b.score - a.score || a.song.title.localeCompare(b.song.title));
    const finalSongs = scored.slice(0, limit).map((s) => s.song);

    return { songs: finalSongs, isFallback: true };
  }

  static async browse(limit: number = 50, offset: number = 0): Promise<Song[]> {
    const db = await getDatabaseAsync();
    return await db.getAllAsync<Song>(
      `SELECT code, title, artist, search_key, duration_ticks, has_singable_lyrics,
              pack_offset, packed_size, unpacked_size, midi_sha256
       FROM songs
       ORDER BY title COLLATE NOCASE, code
       LIMIT ? OFFSET ?;`,
      [limit, offset]
    );
  }

  static async count(): Promise<number> {
    const db = await getDatabaseAsync();
    const row = await db.getFirstAsync<{ count: number }>(`SELECT COUNT(*) as count FROM songs;`);
    return row?.count || 0;
  }
}
