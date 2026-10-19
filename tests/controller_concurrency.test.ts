import { setupTestEnvironment } from './testDbAdapter';
import { PlaybackController } from '../src/engine/PlaybackController';
import { AudioModuleInterface } from '../modules/kantahulay-audio';
import { LibraryModuleInterface } from '../modules/kantahulay-library';
import { getDatabaseAsync } from '../src/db/database';
import { QueueDao } from '../src/db/queueDao';

describe('PlaybackController Concurrency & State Machine Hardening', () => {
  let mockAudio: AudioModuleInterface;
  let mockLibrary: LibraryModuleInterface;

  beforeEach(async () => {
    setupTestEnvironment();
    const db = await getDatabaseAsync();
    await db.execAsync(`DELETE FROM queue; DELETE FROM songs;`);

    // Insert test songs
    for (let i = 1; i <= 10; ++i) {
      const code = i.toString().padStart(6, '0');
      await db.runAsync(`
        INSERT INTO songs (
          code, title, artist, search_key, duration_ticks, has_singable_lyrics,
          pack_offset, packed_size, unpacked_size, midi_sha256
        ) VALUES ('${code}', 'Song ${i}', 'Artist ${i}', 'song ${i}', 1000, 1, 16, 100, 200, 'sha${i}');
      `);
    }

    mockAudio = {
      initialize: jest.fn().mockReturnValue(true),
      loadSoundFont: jest.fn().mockReturnValue(true),
      ensureSoundFontLoaded: jest.fn().mockResolvedValue(true),
      prepareSong: jest.fn().mockImplementation(async () => {
        // Small delay to simulate real I/O
        await new Promise((r) => setTimeout(r, 10));
        return true;
      }),
      play: jest.fn(),
      pause: jest.fn(),
      stop: jest.fn(),
      setKeyOffset: jest.fn(),
      getPlaybackState: jest.fn().mockReturnValue(0),
      getCurrentTimeMs: jest.fn().mockReturnValue(0),
      getTotalTimeMs: jest.fn().mockReturnValue(120000),
      getLyrics: jest.fn().mockResolvedValue([]),
      isSongEnded: jest.fn().mockReturnValue(false),
      reset: jest.fn(),
    };

    mockLibrary = {
      openPackFd: jest.fn().mockReturnValue({ fd: 10, startOffset: 0, length: 1000 }),
      closePackFd: jest.fn().mockReturnValue(true),
      readManifest: jest.fn().mockReturnValue(null),
      copyCatalogToTemp: jest.fn().mockResolvedValue(true),
      extractCatalogToCache: jest.fn().mockResolvedValue(null),
    };
  });

  test('rapid concurrent reserve calls do not throw SQLite UNIQUE constraint error', async () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    
    // Fire 5 reserve calls concurrently without awaiting each
    const promises = [
      controller.reserve('000001'),
      controller.reserve('000002'),
      controller.reserve('000003'),
      controller.reserve('000004'),
      controller.reserve('000005'),
    ];

    // All must resolve without throwing constraint violation
    await Promise.all(promises);

    expect(controller.getState()).toBe('PLAYING');
    expect(controller.getActiveSong()?.code).toBe('000001');
    const pending = controller.getPendingQueue();
    expect(pending.length).toBe(4);
  });

  test('rapid playNow interrupts preceding load without zombie state transition', async () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);

    const songChanges: string[] = [];
    controller.addListener({
      onActiveSongChange: (song) => {
        if (song) songChanges.push(song.code);
      },
    });

    // Start loading song 1, then immediately interrupt with song 2
    const p1 = controller.playNow('000001');
    const p2 = controller.playNow('000002');

    await Promise.all([p1, p2]);

    expect(controller.getState()).toBe('PLAYING');
    expect(controller.getActiveSong()?.code).toBe('000002');
    // Final active song should be 000002, not 000001
    expect(songChanges[songChanges.length - 1]).toBe('000002');
  });

  test('rapid next() calls advance sequentially without corrupted queue state', async () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    await controller.reserve('000001');
    await controller.reserve('000002');
    await controller.reserve('000003');

    // Rapid double next tap
    const n1 = controller.next();
    const n2 = controller.next();

    await Promise.all([n1, n2]);

    expect(controller.getState()).toBe('PLAYING');
    expect(controller.getActiveSong()?.code).toBe('000003');
    expect(controller.getPendingQueue().length).toBe(0);
  });

  test('B07: concurrent song-end and reserve calls maintain atomic queue transition without duplicates', async () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    await controller.reserve('000001');
    expect(controller.getState()).toBe('PLAYING');

    // Concurrently trigger song end AND rapid reservations
    const endPromise = controller.handleSongEnded();
    const resPromise1 = controller.reserve('000002');
    const resPromise2 = controller.reserve('000003');

    await Promise.all([endPromise, resPromise1, resPromise2]);

    const db = await getDatabaseAsync();
    const activeItems = await db.getAllAsync<{ song_code: string }>("SELECT * FROM queue WHERE status = 'active';");
    expect(activeItems.length).toBeLessThanOrEqual(1);

    const activeInDao = await QueueDao.getActive();
    if (activeItems.length === 1) {
      expect(activeInDao?.song_code).toBe(activeItems[0].song_code);
    }
  });

  test('U03: movePending reorders through serialized command lane without racing with song end', async () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    await controller.reserve('000001'); // becomes active
    await controller.reserve('000002'); // pending 1
    await controller.reserve('000003'); // pending 2

    expect(controller.getPendingQueue().map((p) => p.song_code)).toEqual(['000002', '000003']);

    // Reorder pending 2 up while song end is triggered concurrently
    const movePromise = controller.movePending(controller.getPendingQueue()[1].reservation_id, 'up');
    const endPromise = controller.handleSongEnded();

    await Promise.all([movePromise, endPromise]);

    // Active song must now be 000003 because it was moved up to index 0 before or during transition
    const currentActive = controller.getActiveReservation();
    expect(currentActive?.song_code).toBe('000003');
  });

  test('50 consecutive song transitions do not leak listeners or retain unbounded state', async () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    const listener = {
      onStateChange: jest.fn(),
      onActiveSongChange: jest.fn(),
      onQueueChange: jest.fn(),
    };
    const unsubscribe = controller.addListener(listener);

    for (let i = 0; i < 50; ++i) {
      await controller.reserve('000001');
      await controller.stop();
    }

    unsubscribe();
    listener.onStateChange.mockClear();

    // Trigger state change after unsubscribe
    await controller.reserve('000001');
    expect(listener.onStateChange).not.toHaveBeenCalled();
    await controller.stop();
  });
});
