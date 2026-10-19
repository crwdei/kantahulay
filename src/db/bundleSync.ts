import { openDedicatedConnectionAsync, initSchemaAsync } from './database';

export interface BundleManifest {
  pack_format_version: number;
  catalog_version: number;
  pack_sha256: string;
  catalog_sha256: string;
  entry_count: number;
  pack_bytes: number;
  build_id: string;
  rights_review_id: string;
}

export class BundleSync {
  static async reconcileCatalogAsync(
    tempCatalogPath: string,
    manifest: BundleManifest
  ): Promise<{ updated: boolean; count: number }> {
    const conn = await openDedicatedConnectionAsync();
    await initSchemaAsync(conn);

    try {
      // 1. Check if hash matches current app_state
      const state = await conn.getFirstAsync<{ catalog_hash: string | null }>(
        `SELECT catalog_hash FROM app_state WHERE id = 1;`
      );

      if (state && state.catalog_hash === manifest.catalog_sha256) {
        // Fast path: already synced
        const countRow = await conn.getFirstAsync<{ count: number }>(
          `SELECT COUNT(*) as count FROM songs;`
        );
        return { updated: false, count: countRow?.count || 0 };
      }

      // 2. Perform reconciliation on this dedicated connection
      // Standard SQLite ATTACH requires forward slashes or escaped path
      const normalizedPath = tempCatalogPath.replace(/\\/g, '/');

      await conn.execAsync(`ATTACH DATABASE '${normalizedPath}' AS stg;`);

      try {
        await conn.execAsync(`BEGIN IMMEDIATE;`);

        await conn.execAsync(`
          INSERT INTO songs
            (code, title, artist, search_key, duration_ticks, has_singable_lyrics,
             pack_offset, packed_size, unpacked_size, midi_sha256)
          SELECT code, title, artist, search_key, duration_ticks, has_singable_lyrics,
                 pack_offset, packed_size, unpacked_size, midi_sha256
          FROM stg.songs WHERE true
          ON CONFLICT(code) DO UPDATE SET
            title = excluded.title,
            artist = excluded.artist,
            search_key = excluded.search_key,
            duration_ticks = excluded.duration_ticks,
            has_singable_lyrics = excluded.has_singable_lyrics,
            pack_offset = excluded.pack_offset,
            packed_size = excluded.packed_size,
            unpacked_size = excluded.unpacked_size,
            midi_sha256 = excluded.midi_sha256;
        `);

        await conn.execAsync(`
          DELETE FROM songs
          WHERE NOT EXISTS (SELECT 1 FROM stg.songs AS s WHERE s.code = songs.code);
        `);

        const now = Date.now();
        await conn.runAsync(
          `UPDATE app_state
           SET catalog_hash = ?,
               pack_format_version = ?,
               last_successful_bundle_check = ?
           WHERE id = 1;`,
          [manifest.catalog_sha256, manifest.pack_format_version, now]
        );

        await conn.execAsync(`COMMIT;`);
      } catch (txErr) {
        try {
          await conn.execAsync(`ROLLBACK;`);
        } catch {}
        throw txErr;
      } finally {
        try {
          await conn.execAsync(`DETACH DATABASE stg;`);
        } catch {}
      }

      const countRow = await conn.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM songs;`
      );
      return { updated: true, count: countRow?.count || 0 };
    } finally {
      await conn.closeAsync();
    }
  }
}
