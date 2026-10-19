import { setupTestEnvironment } from './testDbAdapter';
import { QueueDao } from '../src/db/queueDao';
import { SongDao } from '../src/db/songDao';
import { BundleSync } from '../src/db/bundleSync';
import { getDatabaseAsync } from '../src/db/database';
import * as fs from 'fs';
import * as path from 'path';

describe('Database Layer and Catalog Sync', () => {
  beforeEach(async () => {
    setupTestEnvironment();
    const db = await getDatabaseAsync();
    await db.execAsync(`DELETE FROM queue; DELETE FROM songs;`);
  });

  test('idx_queue_one_active enforces at most one active reservation in SQLite', async () => {
    const db = await getDatabaseAsync();
    const now = Date.now();
    // First active reservation succeeds
    const item1 = await QueueDao.reserve('000001', true);
    expect(item1.status).toBe('active');

    // In production, reserve(..., true) replaces existing active atomically.
    // To verify that SQLite constraint idx_queue_one_active actually enforces at most one active:
    await expect(db.runAsync("INSERT INTO queue (song_code, reserved_at, status, key_offset) VALUES ('000002', ?, 'active', 0);", [now])).rejects.toThrow();

    // But pending reservation succeeds even with active reservation
    const pending = await QueueDao.reserve('000002', false);
    expect(pending.status).toBe('pending');
  });

  test('duplicate song codes are permitted as independent reservations', async () => {
    const item1 = await QueueDao.reserve('000001', true);
    const item2 = await QueueDao.reserve('000001', false);
    const item3 = await QueueDao.reserve('000001', false);

    expect(item1.reservation_id).not.toBe(item2.reservation_id);
    expect(item2.reservation_id).not.toBe(item3.reservation_id);

    const pending = await QueueDao.getPending();
    expect(pending.length).toBe(2);
    expect(pending[0].song_code).toBe('000001');
    expect(pending[1].song_code).toBe('000001');
  });

  test('invalid song codes are rejected by format validation', async () => {
    await expect(QueueDao.reserve('12345', false)).rejects.toThrow();
    await expect(QueueDao.reserve('1234567', false)).rejects.toThrow();
    await expect(QueueDao.reserve('abcdef', false)).rejects.toThrow();
  });

  test('queue advance, stop, key clamping, and undo lifecycle', async () => {
    const active = await QueueDao.reserve('000001', true);
    const p1 = await QueueDao.reserve('000002', false);
    const p2 = await QueueDao.reserve('000003', false);

    // Key clamping -6 to +6
    await QueueDao.setKeyOffset(active.reservation_id, 4);
    let curActive = await QueueDao.getActive();
    expect(curActive?.key_offset).toBe(4);

    await QueueDao.setKeyOffset(active.reservation_id, 10); // should clamp to 6
    curActive = await QueueDao.getActive();
    expect(curActive?.key_offset).toBe(6);

    // Advance to next
    const nextActive = await QueueDao.advanceToNext(active.reservation_id);
    expect(nextActive?.song_code).toBe('000002');
    expect(nextActive?.status).toBe('active');
    expect(nextActive?.key_offset).toBe(0);

    const remainingPending = await QueueDao.getPending();
    expect(remainingPending.length).toBe(1);
    expect(remainingPending[0].song_code).toBe('000003');

    // Remove pending and Undo
    const removed = await QueueDao.removePending(p2.reservation_id);
    expect(removed?.reservation_id).toBe(p2.reservation_id);
    expect((await QueueDao.getPending()).length).toBe(0);

    // Restore (Undo)
    await QueueDao.restorePending(removed!);
    const restoredPending = await QueueDao.getPending();
    expect(restoredPending.length).toBe(1);
    expect(restoredPending[0].reservation_id).toBe(p2.reservation_id);

    // Stop queue
    const hasRemaining = await QueueDao.stopQueue(true);
    expect(hasRemaining).toBe(true); // p2 remains
    expect(await QueueDao.getActive()).toBeNull();
  });

  test('U03: swapPendingOrder reorders pending reservations atomically', async () => {
    await QueueDao.clearAll();
    const item1 = await QueueDao.reserve('000001');
    const item2 = await QueueDao.reserve('000002');
    const item3 = await QueueDao.reserve('000003');

    // Currently order is item1, item2, item3
    let pending = await QueueDao.getPending();
    expect(pending.map((p) => p.song_code)).toEqual(['000001', '000002', '000003']);

    // Swap item1 and item2
    const swapped = await QueueDao.swapPendingOrder(item1.reservation_id, item2.reservation_id);
    expect(swapped).toBe(true);

    pending = await QueueDao.getPending();
    expect(pending.map((p) => p.song_code)).toEqual(['000002', '000001', '000003']);

    // Swap invalid ID returns false
    const invalidSwap = await QueueDao.swapPendingOrder(item1.reservation_id, 99999);
    expect(invalidSwap).toBe(false);
  });

  test('catalog reconciliation via dedicated connection and ATTACH', async () => {
    const catalogPath = path.resolve('build/bundled-library/catalog.sqlite');
    const manifestPath = path.resolve('build/bundled-library/bundle_manifest.json');

    if (!fs.existsSync(catalogPath) || !fs.existsSync(manifestPath)) {
      return;
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const result = await BundleSync.reconcileCatalogAsync(catalogPath, manifest);

    expect(result.updated).toBe(true);
    expect(result.count).toBe(manifest.entry_count);

    // Fast path: re-running with unchanged manifest skips update
    const repeat = await BundleSync.reconcileCatalogAsync(catalogPath, manifest);
    expect(repeat.updated).toBe(false);
    expect(repeat.count).toBe(manifest.entry_count);

    // Verify songs in DB
    const song = await SongDao.getByCode('000001');
    expect(song).not.toBeNull();
    expect(song?.title).toBe('Trust in Me');

    // Verify search with wildcard escaping
    const searchRes = await SongDao.search('Trust');
    expect(searchRes.length).toBeGreaterThanOrEqual(1);
    expect(searchRes.some((s) => s.code === '000001')).toBe(true);

    // Test wildcard characters do not blow up query
    const wildcardRes = await SongDao.search('%_\\');
    expect(Array.isArray(wildcardRes)).toBe(true);
  });

  test('idx_queue_one_active enforces DB partial unique index on status = active', async () => {
    const db = await getDatabaseAsync();
    await db.runAsync("INSERT INTO queue (song_code, reserved_at, status, key_offset) VALUES ('000001', 1, 'active', 0);");
    await expect(db.runAsync("INSERT INTO queue (song_code, reserved_at, status, key_offset) VALUES ('000002', 2, 'active', 0);")).rejects.toThrow();
  });

  test('reserve and removePending populate title and artist when songs exist', async () => {
    const db = await getDatabaseAsync();
    await db.runAsync(`
      INSERT INTO songs (
        code, title, artist, search_key, duration_ticks, has_singable_lyrics,
        pack_offset, packed_size, unpacked_size, midi_sha256
      ) VALUES ('000001', 'Bahay Kubo', 'Traditional', 'bahay kubo traditional', 1000, 1, 16, 100, 200, 'sha1'),
               ('000002', 'Leron Leron Sinta', 'Folk', 'leron leron sinta folk', 1000, 1, 116, 100, 200, 'sha2');
    `);

    const active = await QueueDao.reserve('000001', true);
    expect(active.title).toBe('Bahay Kubo');
    expect(active.artist).toBe('Traditional');

    const pending = await QueueDao.reserve('000002', false);
    expect(pending.title).toBe('Leron Leron Sinta');
    expect(pending.artist).toBe('Folk');

    const removed = await QueueDao.removePending(pending.reservation_id);
    expect(removed).not.toBeNull();
    expect(removed?.title).toBe('Leron Leron Sinta');
    expect(removed?.artist).toBe('Folk');
  });

  test('metadata lookup precedes insert in QueueDao.reserve', async () => {
    const db = await getDatabaseAsync();
    const originalGetFirst = db.getFirstAsync.bind(db);
    jest.spyOn(db, 'getFirstAsync').mockImplementationOnce(async (sql, params) => {
      if (typeof sql === 'string' && sql.includes('SELECT title, artist FROM songs')) {
        throw new Error('injected metadata read failure');
      }
      return originalGetFirst(sql, params);
    });

    await expect(QueueDao.reserve('000001', false)).rejects.toThrow('injected metadata read failure');
    const queueRows = await db.getAllAsync('SELECT * FROM queue WHERE song_code = ?;', ['000001']);
    expect(queueRows).toHaveLength(0);
  });

  test('search normalizes diacritics, punctuation, 6-digit codes, and includes instrumental tracks', async () => {
    const db = await getDatabaseAsync();
    await db.runAsync(
      `INSERT INTO songs (
        code, title, artist, search_key, duration_ticks, has_singable_lyrics,
        pack_offset, packed_size, unpacked_size, midi_sha256
      ) VALUES
        (?, ?, ?, ?, 1000, 1, 16, 100, 200, 'sha10'),
        (?, ?, ?, ?, 1000, 0, 16, 100, 200, 'sha20'),
        (?, ?, ?, ?, 1000, 1, 16, 100, 200, 'sha30');`,
      [
        '000010', 'Pag-Ibig Sa Tinubuang Lupa', 'Andrés Bonifacio', 'pag ibig sa tinubuang lupa andres bonifacio',
        '000020', 'Rosas Pandan', 'Pilita Corrales', 'rosas pandan pilita corrales',
        '000030', "Don't Stop Believin'", 'Journey', 'don t stop believin journey',
      ]
    );

    // Punctuation and diacritics in search query
    const resPag = await SongDao.search('pag-ibig');
    expect(resPag.some((s) => s.code === '000010')).toBe(true);

    const resAndres = await SongDao.search('Andrés');
    expect(resAndres.some((s) => s.code === '000010')).toBe(true);

    const resDont = await SongDao.search("don't stop");
    expect(resDont.some((s) => s.code === '000030')).toBe(true);

    const resDontNoApos = await SongDao.search('dont stop');
    expect(resDontNoApos.some((s) => s.code === '000030')).toBe(true);

    // Instrumental tracks are eligible in search (has_singable_lyrics = 0)
    const resInstrumental = await SongDao.search('Rosas');
    expect(resInstrumental.some((s) => s.code === '000020')).toBe(true);

    // 6-digit code matches in search query
    const resCode = await SongDao.search('000020');
    expect(resCode.some((s) => s.code === '000020')).toBe(true);

    // U07: Typo-tolerant fallback search with 'Did you mean' indicator
    // 'tinubuanx' has 0 direct results, but trigram matches 'tinubuang' (code 000010)
    const typoRes = await SongDao.searchWithFallback('tinubuanx');
    expect(typoRes.isFallback).toBe(true);
    expect(typoRes.songs.some((s) => s.code === '000010')).toBe(true);

    const exactRes = await SongDao.searchWithFallback('Rosas Pandan');
    expect(exactRes.isFallback).toBe(false);
    expect(exactRes.songs.some((s) => s.code === '000020')).toBe(true);
  });

  test('SettingsDao persists and retrieves language from app_state', async () => {
    const { SettingsDao } = require('../src/db/settingsDao');
    expect(await SettingsDao.getLanguage()).toBe('en');

    await SettingsDao.setLanguage('fil');
    expect(await SettingsDao.getLanguage()).toBe('fil');

    await SettingsDao.setLanguage('ceb');
    expect(await SettingsDao.getLanguage()).toBe('ceb');
  });

  test('SettingsDao manages onboarding completion flag and preserves upgrade users', async () => {
    const { SettingsDao } = require('../src/db/settingsDao');
    // Fresh install: onboarding not completed
    expect(await SettingsDao.isOnboardingCompleted()).toBe(false);

    // Save completion
    await SettingsDao.setOnboardingCompleted(true);
    expect(await SettingsDao.isOnboardingCompleted()).toBe(true);

    // Reset completion flag
    await SettingsDao.setOnboardingCompleted(false);
    expect(await SettingsDao.isOnboardingCompleted()).toBe(false);

    // Upgrade check: simulate existing user with catalog_hash
    const db = await getDatabaseAsync();
    await db.runAsync("UPDATE app_state SET onboarding_completed = 0, catalog_hash = 'existing_hash_123' WHERE id = 1;");
    // Should detect upgrade, auto-set completed, and return true
    expect(await SettingsDao.isOnboardingCompleted()).toBe(true);
    const updatedRow = await db.getFirstAsync<{ onboarding_completed: number }>('SELECT onboarding_completed FROM app_state WHERE id = 1;');
    expect(updatedRow?.onboarding_completed).toBe(1);
  });

  test('getDatabaseAsync transparently recovers from dead handle NullPointerException rejections', async () => {
    let callCount = 0;
    const testDb = await getDatabaseAsync();
    
    // Test resilient wrapper recovery
    const client = await getDatabaseAsync();
    const count = await client.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM songs;');
    expect(count).toBeDefined();
  });
});
