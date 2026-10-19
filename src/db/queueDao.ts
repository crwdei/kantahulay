import { getDatabaseAsync } from './database';
import { QueueItem } from './types';

export class QueueDao {
  static async reserve(songCode: string, makeActive: boolean = false): Promise<QueueItem> {
    if (!/^\d{6}$/.test(songCode)) {
      throw new Error(`Invalid song code: ${songCode}. Must be exactly 6 digits.`);
    }

    const db = await getDatabaseAsync();
    const now = Date.now();
    const status = makeActive ? 'active' : 'pending';

    const song = await db.getFirstAsync<{ title: string; artist: string }>(
      `SELECT title, artist FROM songs WHERE code = ? LIMIT 1;`,
      [songCode]
    );

    let insertId = 0;
    await db.withTransactionAsync(async () => {
      if (makeActive) {
        await db.runAsync(`DELETE FROM queue WHERE status = 'active';`);
      }
      const res = await db.runAsync(
        `INSERT INTO queue (song_code, reserved_at, status, key_offset) VALUES (?, ?, ?, 0);`,
        [songCode, now, status]
      );
      insertId = res.lastInsertRowId;
    });

    return {
      reservation_id: insertId,
      song_code: songCode,
      reserved_at: now,
      status,
      key_offset: 0,
      title: song?.title,
      artist: song?.artist,
    };
  }

  static async getActive(): Promise<QueueItem | null> {
    const db = await getDatabaseAsync();
    const row = await db.getFirstAsync<QueueItem>(
      `SELECT q.reservation_id, q.song_code, q.reserved_at, q.status, q.key_offset,
              s.title, s.artist
       FROM queue q
       LEFT JOIN songs s ON s.code = q.song_code
       WHERE q.status = 'active'
       LIMIT 1;`
    );
    return row || null;
  }

  static async getPending(): Promise<QueueItem[]> {
    const db = await getDatabaseAsync();
    return await db.getAllAsync<QueueItem>(
      `SELECT q.reservation_id, q.song_code, q.reserved_at, q.status, q.key_offset,
              s.title, s.artist
       FROM queue q
       LEFT JOIN songs s ON s.code = q.song_code
       WHERE q.status = 'pending'
       ORDER BY q.reservation_id ASC;`
    );
  }

  static async advanceToNext(removeActiveId?: number): Promise<QueueItem | null> {
    const db = await getDatabaseAsync();
    let nextActive: QueueItem | null = null;

    await db.withTransactionAsync(async () => {
      if (removeActiveId !== undefined) {
        await db.runAsync(`DELETE FROM queue WHERE reservation_id = ? AND status = 'active';`, [
          removeActiveId,
        ]);
      } else {
        await db.runAsync(`DELETE FROM queue WHERE status = 'active';`);
      }

      const nextPending = await db.getFirstAsync<QueueItem>(
        `SELECT reservation_id, song_code, reserved_at, status, key_offset
         FROM queue
         WHERE status = 'pending'
         ORDER BY reservation_id ASC
         LIMIT 1;`
      );

      if (!nextPending) {
        nextActive = null;
        return;
      }

      await db.runAsync(
        `UPDATE queue SET status = 'active', key_offset = 0 WHERE reservation_id = ?;`,
        [nextPending.reservation_id]
      );

      nextActive = await this.getActive();
    });

    return nextActive;
  }

  static async stopQueue(removeActive: boolean = true): Promise<boolean> {
    const db = await getDatabaseAsync();
    let hasRemaining = false;

    await db.withTransactionAsync(async () => {
      if (removeActive) {
        await db.runAsync(`DELETE FROM queue WHERE status = 'active';`);
      }
      const pendingCountRow = await db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM queue WHERE status = 'pending';`
      );
      hasRemaining = (pendingCountRow?.count || 0) > 0;
    });

    return hasRemaining;
  }

  static async setKeyOffset(reservationId: number, semitones: number): Promise<void> {
    const clamped = Math.max(-6, Math.min(6, semitones));
    const db = await getDatabaseAsync();
    await db.runAsync(`UPDATE queue SET key_offset = ? WHERE reservation_id = ?;`, [
      clamped,
      reservationId,
    ]);
  }

  static async removePending(reservationId: number): Promise<QueueItem | null> {
    const db = await getDatabaseAsync();
    let removedItem: QueueItem | null = null;

    await db.withTransactionAsync(async () => {
      const item = await db.getFirstAsync<QueueItem>(
        `SELECT q.reservation_id, q.song_code, q.reserved_at, q.status, q.key_offset,
                s.title, s.artist
         FROM queue q
         LEFT JOIN songs s ON s.code = q.song_code
         WHERE q.reservation_id = ? AND q.status = 'pending';`,
        [reservationId]
      );
      if (!item) {
        removedItem = null;
        return;
      }

      await db.runAsync(`DELETE FROM queue WHERE reservation_id = ?;`, [reservationId]);
      removedItem = item;
    });

    return removedItem;
  }

  static async restorePending(item: QueueItem): Promise<void> {
    const db = await getDatabaseAsync();
    await db.runAsync(
      `INSERT INTO queue (reservation_id, song_code, reserved_at, status, key_offset)
       VALUES (?, ?, ?, 'pending', ?);`,
      [item.reservation_id, item.song_code, item.reserved_at, item.key_offset]
    );
  }

  static async clearAll(): Promise<void> {
    const db = await getDatabaseAsync();
    await db.runAsync(`DELETE FROM queue;`);
  }

  static async swapPendingOrder(idA: number, idB: number): Promise<boolean> {
    const db = await getDatabaseAsync();
    let swapped = false;
    await db.withTransactionAsync(async () => {
      const itemA = await db.getFirstAsync<QueueItem>(
        `SELECT reservation_id, song_code, reserved_at, status, key_offset FROM queue WHERE reservation_id = ? AND status = 'pending';`,
        [idA]
      );
      const itemB = await db.getFirstAsync<QueueItem>(
        `SELECT reservation_id, song_code, reserved_at, status, key_offset FROM queue WHERE reservation_id = ? AND status = 'pending';`,
        [idB]
      );
      if (!itemA || !itemB) {
        swapped = false;
        return;
      }
      // Swap song_code, reserved_at, and key_offset between the two reservation IDs
      await db.runAsync(
        `UPDATE queue SET song_code = ?, reserved_at = ?, key_offset = ? WHERE reservation_id = ?;`,
        [itemB.song_code, itemB.reserved_at, itemB.key_offset, idA]
      );
      await db.runAsync(
        `UPDATE queue SET song_code = ?, reserved_at = ?, key_offset = ? WHERE reservation_id = ?;`,
        [itemA.song_code, itemA.reserved_at, itemA.key_offset, idB]
      );
      swapped = true;
    });
    return swapped;
  }
}
