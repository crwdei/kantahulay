import { setupTestEnvironment } from './testDbAdapter';
import { PlaybackController } from '../src/engine/PlaybackController';
import { LyricSynchronizer } from '../src/engine/LyricSynchronizer';
import { AudioModuleInterface } from '../modules/kantahulay-audio';
import { LibraryModuleInterface } from '../modules/kantahulay-library';
import { QueueDao } from '../src/db/queueDao';
import { SongDao } from '../src/db/songDao';
import { getDatabaseAsync } from '../src/db/database';

describe('Engine State Machine and Lyrics', () => {
  let mockAudio: AudioModuleInterface;
  let mockLibrary: LibraryModuleInterface;
  let prepareDelayMs = 0;
  let prepareShouldFail = false;

  beforeEach(async () => {
    setupTestEnvironment();
    const db = await getDatabaseAsync();
    await db.execAsync(`DELETE FROM queue; DELETE FROM songs;`);

    // Insert dummy test song into songs table
    await db.runAsync(`
      INSERT INTO songs (
        code, title, artist, search_key, duration_ticks, has_singable_lyrics,
        pack_offset, packed_size, unpacked_size, midi_sha256
      ) VALUES ('000001', 'Test Song 1', 'Artist 1', 'test song 1 artist 1', 1000, 1, 16, 100, 200, 'sha1'),
               ('000002', 'Test Song 2', 'Artist 2', 'test song 2 artist 2', 1000, 1, 116, 100, 200, 'sha2'),
               ('000003', 'Test Song 3', 'Artist 3', 'test song 3 artist 3', 1000, 1, 216, 100, 200, 'sha3');
    `);

    prepareDelayMs = 0;
    prepareShouldFail = false;

    mockAudio = {
      initialize: jest.fn().mockReturnValue(true),
      loadSoundFont: jest.fn().mockReturnValue(true),
      ensureSoundFontLoaded: jest.fn().mockResolvedValue(true),
      prepareSong: jest.fn().mockImplementation(async () => {
        if (prepareDelayMs > 0) {
          await new Promise((r) => setTimeout(r, prepareDelayMs));
        }
        return !prepareShouldFail;
      }),
      play: jest.fn(),
      pause: jest.fn(),
      stop: jest.fn(),
      setKeyOffset: jest.fn(),
      getPlaybackState: jest.fn().mockReturnValue(0),
      getCurrentTimeMs: jest.fn().mockReturnValue(0),
      getTotalTimeMs: jest.fn().mockReturnValue(120000),
      getLyrics: jest.fn().mockResolvedValue([
        { text: 'Ba-', timeMs: 1000, isLineBreak: false, isParagraphBreak: false },
        { text: 'hay ', timeMs: 1200, isLineBreak: false, isParagraphBreak: false },
        { text: 'ku-', timeMs: 1400, isLineBreak: false, isParagraphBreak: false },
        { text: 'bo, ', timeMs: 1600, isLineBreak: false, isParagraphBreak: false },
        { text: 'ka-', timeMs: 2500, isLineBreak: true, isParagraphBreak: false },
        { text: 'hit ', timeMs: 2700, isLineBreak: false, isParagraphBreak: false },
        { text: 'mun-', timeMs: 2900, isLineBreak: false, isParagraphBreak: false },
        { text: 'ti', timeMs: 3100, isLineBreak: false, isParagraphBreak: false },
      ]),
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

  test('LyricSynchronizer correctly alternates lines and computes highlight ratio', () => {
    const sync = new LyricSynchronizer();
    sync.loadLyrics([
      { text: 'Ba-', timeMs: 0, isLineBreak: true, isParagraphBreak: true },
      { text: 'hay ', timeMs: 500, isLineBreak: false, isParagraphBreak: false },
      { text: 'ku-', timeMs: 1000, isLineBreak: false, isParagraphBreak: false },
      { text: 'bo, ', timeMs: 1500, isLineBreak: false, isParagraphBreak: false },
      { text: 'ka-', timeMs: 2000, isLineBreak: true, isParagraphBreak: true },
      { text: 'hit ', timeMs: 2500, isLineBreak: false, isParagraphBreak: false },
      { text: 'mun-', timeMs: 3000, isLineBreak: false, isParagraphBreak: false },
      { text: 'ti', timeMs: 3500, isLineBreak: false, isParagraphBreak: false },
    ]);

    const lines = sync.getLines();
    expect(lines.length).toBe(2);
    expect(lines[0].text).toBe('BA-HAY KU-BO,');
    expect(lines[1].text).toBe('KA-HIT MUN-TI');

    // At 500ms -> active line is 1
    const w1 = sync.getDisplayWindow(500);
    expect(w1.line1Text).toBe('BA-HAY KU-BO,');
    expect(w1.line2Text).toBe('KA-HIT MUN-TI');
    expect(w1.activeLine).toBe(1);
    expect(w1.activeRatio).toBeGreaterThan(0);

    // At 2500ms -> active line is 2
    const w2 = sync.getDisplayWindow(2500);
    expect(w2.activeLine).toBe(2);
  });

  test('LyricSynchronizer groups short 1-2 word fragments into complete phrases', () => {
    const sync = new LyricSynchronizer();
    sync.loadLyrics([
      { text: 'A-', timeMs: 0, isLineBreak: false, isParagraphBreak: false },
      { text: 'raw ', timeMs: 200, isLineBreak: false, isParagraphBreak: false },
      { text: 'a-', timeMs: 400, isLineBreak: false, isParagraphBreak: false },
      { text: 'raw ', timeMs: 600, isLineBreak: false, isParagraphBreak: false },
      { text: 'i-', timeMs: 800, isLineBreak: false, isParagraphBreak: false },
      { text: 'kaw ', timeMs: 1000, isLineBreak: false, isParagraphBreak: false },
      { text: 'ang ', timeMs: 1200, isLineBreak: true, isParagraphBreak: false },
      { text: 'gus-', timeMs: 1400, isLineBreak: false, isParagraphBreak: false },
      { text: 'to ', timeMs: 1600, isLineBreak: false, isParagraphBreak: false },
      { text: 'kong ', timeMs: 1800, isLineBreak: false, isParagraphBreak: false },
      { text: 'ka-', timeMs: 2000, isLineBreak: true, isParagraphBreak: false }, // solitary 1-word fragment should merge
      { text: 'sa-', timeMs: 2200, isLineBreak: false, isParagraphBreak: false },
      { text: 'ma ', timeMs: 2400, isLineBreak: false, isParagraphBreak: false },
    ]);
    const lines = sync.getLines();
    expect(lines.length).toBe(2);
    expect(lines[0].text).toBe('A-RAW A-RAW I-KAW ANG GUS-TO KONG');
    expect(lines[1].text).toBe('KA-SA-MA');
  });

  test('LyricSynchronizer keeps words intact when parsed from same-tick trailing newlines', () => {
    const sync = new LyricSynchronizer();
    sync.loadLyrics([
      { text: 'Ang ', timeMs: 19875, isLineBreak: true, isParagraphBreak: false },
      { text: 'pa', timeMs: 20000, isLineBreak: false, isParagraphBreak: false },
      { text: 'wis ', timeMs: 20125, isLineBreak: false, isParagraphBreak: false },
      { text: "ko'y ", timeMs: 20250, isLineBreak: false, isParagraphBreak: false },
      { text: 'tu', timeMs: 20375, isLineBreak: true, isParagraphBreak: false },
      { text: 'ma', timeMs: 20500, isLineBreak: false, isParagraphBreak: false },
      { text: 'ta', timeMs: 20625, isLineBreak: false, isParagraphBreak: false },
      { text: 'gak', timeMs: 20750, isLineBreak: false, isParagraphBreak: false },
      { text: 'tak ', timeMs: 21000, isLineBreak: false, isParagraphBreak: false },
      { text: 'Sa ', timeMs: 21250, isLineBreak: true, isParagraphBreak: false },
      { text: 'bil', timeMs: 21375, isLineBreak: false, isParagraphBreak: false },
      { text: 'is ', timeMs: 21500, isLineBreak: false, isParagraphBreak: false },
      { text: 'may ', timeMs: 21750, isLineBreak: true, isParagraphBreak: false },
      { text: 'pu', timeMs: 21875, isLineBreak: false, isParagraphBreak: false },
      { text: 'ma', timeMs: 22000, isLineBreak: false, isParagraphBreak: false },
      { text: 'pa', timeMs: 22125, isLineBreak: false, isParagraphBreak: false },
      { text: 'lak', timeMs: 22250, isLineBreak: false, isParagraphBreak: false },
      { text: 'pak ', timeMs: 22500, isLineBreak: false, isParagraphBreak: false },
    ]);
    const lines = sync.getLines();
    const joined = lines.map((l) => l.text).join(' \n ');
    expect(joined).toContain('TUMATAGAKTAK');
    expect(joined).toContain('PUMAPALAKPAK');
    expect(joined).not.toContain('TUMATAGAK \n TAK');
    expect(joined).not.toContain('PUMAPALAK \n PAK');
  });

  test('first reserve in IDLE starts playback through LOADING to PLAYING', async () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    expect(controller.getState()).toBe('IDLE');

    await controller.reserve('000001');

    expect(mockAudio.prepareSong).toHaveBeenCalledTimes(1);
    expect(mockAudio.play).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toBe('PLAYING');
    expect(controller.getActiveSong()?.code).toBe('000001');
    expect(controller.getPendingQueue().length).toBe(0);
  });

  test('reserve during PLAYING appends silently to pending queue', async () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    await controller.reserve('000001');
    expect(controller.getState()).toBe('PLAYING');

    await controller.reserve('000002');
    expect(controller.getState()).toBe('PLAYING');
    expect(controller.getActiveSong()?.code).toBe('000001');

    const pending = controller.getPendingQueue();
    expect(pending.length).toBe(1);
    expect(pending[0].song_code).toBe('000002');
  });

  test('pause and resume transitions', async () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    await controller.reserve('000001');

    controller.pause();
    expect(controller.getState()).toBe('PAUSED');
    expect(mockAudio.pause).toHaveBeenCalled();

    await controller.play();
    expect(controller.getState()).toBe('PLAYING');
    expect(mockAudio.play).toHaveBeenCalledTimes(2);
  });

  test('stop with pending entries transitions to WAITING_FOR_PLAY', async () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    await controller.reserve('000001');
    await controller.reserve('000002');

    await controller.stop();
    expect(controller.getState()).toBe('WAITING_FOR_PLAY');
    expect(controller.getActiveSong()).toBeNull();
    expect(controller.getPendingQueue().length).toBe(1);
  });

  test('stop when empty transitions to IDLE', async () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    await controller.reserve('000001');

    await controller.stop();
    expect(controller.getState()).toBe('IDLE');
    expect(controller.getActiveSong()).toBeNull();
    expect(controller.getPendingQueue().length).toBe(0);
    expect(controller.getCurrentTimeMs()).toBe(0);
    expect(controller.getTotalTimeMs()).toBe(0);
    expect(controller.getKeyOffset()).toBe(0);
  });

  test('stop synchronizes activeSong and state notifications without intermediate desync', async () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    await controller.reserve('000001');

    const transitions: Array<{ state: string; hasActiveSong: boolean }> = [];
    controller.addListener({
      onActiveSongChange: (song) => {
        transitions.push({ state: controller.getState(), hasActiveSong: !!song });
      },
    });

    await controller.stop();
    const nullSongTransition = transitions.find((t) => !t.hasActiveSong);
    expect(nullSongTransition).toBeDefined();
    expect(nullSongTransition?.state).toBe('IDLE');
  });

  test('next advances queue to next pending song', async () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    await controller.reserve('000001');
    await controller.reserve('000002');

    await controller.next();
    expect(controller.getState()).toBe('PLAYING');
    expect(controller.getActiveSong()?.code).toBe('000002');
    expect(controller.getPendingQueue().length).toBe(0);
  });

  test('3 songs reserved: first plays, Next advances through each reserved song with hydrated title and artist', async () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    await controller.reserve('000001');
    await controller.reserve('000002');
    await controller.reserve('000003');

    expect(controller.getState()).toBe('PLAYING');
    expect(controller.getActiveSong()?.code).toBe('000001');
    expect(controller.getActiveReservation()?.title).toBe('Test Song 1');
    expect(controller.getActiveReservation()?.artist).toBe('Artist 1');
    expect(controller.getPendingQueue().length).toBe(2);
    expect(controller.getPendingQueue()[0].title).toBe('Test Song 2');
    expect(controller.getPendingQueue()[1].title).toBe('Test Song 3');

    // Press Next -> advances to song 2
    await controller.next();
    expect(controller.getState()).toBe('PLAYING');
    expect(controller.getActiveSong()?.code).toBe('000002');
    expect(controller.getActiveReservation()?.title).toBe('Test Song 2');
    expect(controller.getActiveReservation()?.artist).toBe('Artist 2');
    expect(controller.getPendingQueue().length).toBe(1);
    expect(controller.getPendingQueue()[0].song_code).toBe('000003');

    // Press Next -> advances to song 3
    await controller.next();
    expect(controller.getState()).toBe('PLAYING');
    expect(controller.getActiveSong()?.code).toBe('000003');
    expect(controller.getActiveReservation()?.title).toBe('Test Song 3');
    expect(controller.getActiveReservation()?.artist).toBe('Artist 3');
    expect(controller.getPendingQueue().length).toBe(0);

    // Press Next -> queue exhausted -> IDLE
    await controller.next();
    expect(controller.getState()).toBe('IDLE');
    expect(controller.getActiveSong()).toBeNull();
    expect(controller.getActiveReservation()).toBeNull();
    expect(controller.getCurrentTimeMs()).toBe(0);
    expect(controller.getTotalTimeMs()).toBe(0);
    expect(controller.getKeyOffset()).toBe(0);
  });

  test('natural song ending on last song resets controller to clean IDLE state', async () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    await controller.reserve('000001');
    expect(controller.getState()).toBe('PLAYING');

    // Natural end of song with empty queue
    await controller.handleSongEnded();
    expect(controller.getState()).toBe('IDLE');
    expect(controller.getActiveSong()).toBeNull();
    expect(controller.getActiveReservation()).toBeNull();
    expect(controller.getCurrentTimeMs()).toBe(0);
    expect(controller.getTotalTimeMs()).toBe(0);
    expect(controller.getKeyOffset()).toBe(0);
  });

  test('stale preparation completion is rejected', async () => {
    prepareDelayMs = 50; // Delay preparation
    const controller = new PlaybackController(mockAudio, mockLibrary);

    // Start load
    const reservePromise = controller.reserve('000001');
    expect(controller.getState()).toBe('LOADING');

    // Immediately stop before load finishes -> bumps generation
    await controller.stop();
    expect(controller.getState()).toBe('IDLE');

    // Wait for delayed load to finish
    await reservePromise;

    // Must remain IDLE, not transition to PLAYING!
    expect(controller.getState()).toBe('IDLE');
  });

  test.each([true, false])('cold start clears old queue (active song: %s) without touching library/settings', async (hasActive) => {
    const db = await getDatabaseAsync();
    await db.runAsync("UPDATE app_state SET selected_language = 'ceb', selected_theme = 'dark', onboarding_completed = 1 WHERE id = 1;");
    const settings = await db.getFirstAsync('SELECT * FROM app_state WHERE id = 1;');
    if (hasActive) {
      const active = await QueueDao.reserve('000001', true);
      await QueueDao.setKeyOffset(active.reservation_id, 3);
    }
    await QueueDao.reserve('000002', false);
    await QueueDao.reserve('000003', false);

    const controller = new PlaybackController(mockAudio, mockLibrary);
    await Promise.all([controller.initializeAsync(), controller.initializeAsync()]);

    expect(await QueueDao.getActive()).toBeNull();
    expect(await QueueDao.getPending()).toEqual([]);
    expect(controller.getState()).toBe('IDLE');
    expect(controller.getActiveSong()).toBeNull();
    expect(controller.getActiveReservation()).toBeNull();
    expect(controller.getPendingQueue()).toEqual([]);
    expect(controller.getKeyOffset()).toBe(0);
    expect(controller.getCurrentTimeMs()).toBe(0);
    expect(controller.getTotalTimeMs()).toBe(0);
    expect(controller.getLyricSync().getLines()).toEqual([]);
    expect(mockAudio.reset).toHaveBeenCalledTimes(1);
    expect(mockAudio.play).not.toHaveBeenCalled();
    expect(await SongDao.count()).toBe(3);
    expect(await db.getFirstAsync('SELECT * FROM app_state WHERE id = 1;')).toEqual(settings);
  });

  test.each(['paused', 'stopped'])('same-session initialization preserves %s queue and key', async (mode) => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    await controller.initializeAsync();
    await controller.reserve('000001');
    await controller.reserve('000002');
    await controller.setKeyOffset(3);
    if (mode === 'paused') controller.pause();
    else await controller.stop();
    const state = controller.getState();
    const active = controller.getActiveReservation();
    const pending = controller.getPendingQueue();
    const storedActive = await QueueDao.getActive();
    (mockAudio.reset as jest.Mock).mockClear();

    await controller.initializeAsync();

    expect(controller.getState()).toBe(state);
    expect(controller.getActiveReservation()).toEqual(active);
    expect(controller.getPendingQueue()).toEqual(pending);
    expect(await QueueDao.getActive()).toEqual(storedActive);
    expect(await QueueDao.getPending()).toEqual(pending);
    expect(controller.getKeyOffset()).toBe(3);
    expect(mockAudio.reset).not.toHaveBeenCalled();
  });

  test('fresh session resets before audio loading so startup reservations survive', async () => {
    let finishFontLoad!: (loaded: boolean) => void;
    let fontStarted!: () => void;
    const started = new Promise<void>((resolve) => { fontStarted = resolve; });
    const font = new Promise<boolean>((resolve) => { finishFontLoad = resolve; });
    mockAudio.ensureSoundFontLoaded = jest.fn().mockImplementation(() => {
      fontStarted();
      return font;
    });
    await QueueDao.reserve('000003', false);
    const controller = new PlaybackController(mockAudio, mockLibrary);
    const initialization = controller.initializeAsync();
    await started;
    expect(await QueueDao.getPending()).toEqual([]);
    const res1 = controller.reserve('000001');
    const res2 = controller.reserve('000002');
    finishFontLoad(true);
    await initialization;
    await res1;
    await res2;

    expect(controller.getState()).toBe('PLAYING');
    expect(controller.getActiveSong()?.code).toBe('000001');
    expect((await QueueDao.getPending()).map((q) => q.song_code)).toEqual(['000002']);
  });

  test('failed cold-start delete rejects initialization and retries without clearing library/settings', async () => {
    const db = await getDatabaseAsync();
    await QueueDao.reserve('000001', true);
    await QueueDao.reserve('000002', false);
    await db.execAsync("CREATE TRIGGER fail_queue_clear BEFORE DELETE ON queue BEGIN SELECT RAISE(ABORT, 'injected queue clear failure'); END;");
    const controller = new PlaybackController(mockAudio, mockLibrary);

    await expect(controller.initializeAsync()).rejects.toThrow('injected queue clear failure');
    expect((await QueueDao.getActive())?.song_code).toBe('000001');
    expect(await QueueDao.getPending()).toHaveLength(1);
    await db.execAsync('DROP TRIGGER fail_queue_clear;');
    await controller.initializeAsync();
    expect(await QueueDao.getActive()).toBeNull();
    expect(await QueueDao.getPending()).toEqual([]);
    expect(controller.getState()).toBe('IDLE');
    expect(await SongDao.count()).toBe(3);
  });

  test('separates committed queue mutations from failed refresh', async () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    await controller.reserve('000001'); // plays immediately
    await controller.reserve('000002'); // queued as pending
    await controller.reserve('000003'); // queued as pending

    const pending = controller.getPendingQueue();
    expect(pending).toHaveLength(2);
    const itemToRemove = pending[0];

    const getPendingSpy = jest
      .spyOn(QueueDao, 'getPending')
      .mockRejectedValueOnce(new Error('injected refresh failure'));

    const onQueueRefreshFailed = jest.fn();
    controller.addListener({ onQueueRefreshFailed });

    const removed = await controller.removePending(itemToRemove.reservation_id);
    expect(removed?.reservation_id).toBe(itemToRemove.reservation_id);
    expect(controller.getQueueNeedsRefresh()).toBe(true);
    expect(onQueueRefreshFailed).toHaveBeenCalled();
    expect(controller.getPendingQueue().map((q) => q.reservation_id)).not.toContain(
      itemToRemove.reservation_id
    );

    getPendingSpy.mockRestore();
    await controller.refreshQueueAsync();
    expect(controller.getQueueNeedsRefresh()).toBe(false);
  });

  test('reports truthful initialization and prevents duplicate session reset during active playback', async () => {
    mockAudio.ensureSoundFontLoaded = jest.fn().mockResolvedValue(false);
    const controller = new PlaybackController(mockAudio, mockLibrary);

    const failResult = await controller.initializeAsync();
    expect(failResult.audioReady).toBe(false);
    expect(failResult.catalogReady).toBe(false);
    expect(failResult.totalSongs).not.toBe(47997);

    // Audio recovers
    (mockAudio.ensureSoundFontLoaded as jest.Mock).mockResolvedValue(true);
    const validManifest = {
      pack_format_version: 1,
      catalog_version: 1,
      pack_sha256: 'a'.repeat(64),
      catalog_sha256: 'b'.repeat(64),
      entry_count: 3,
      pack_bytes: 1000,
      build_id: 'test-build',
      rights_review_id: 'TEST-ID',
    };
    (mockLibrary.readManifest as jest.Mock).mockReturnValue(JSON.stringify(validManifest));
    (mockLibrary.extractCatalogToCache as jest.Mock).mockResolvedValue('/tmp/fake-catalog.sqlite');

    // Spy on BundleSync to avoid real ATTACH on fake path
    const { BundleSync } = require('../src/db/bundleSync');
    const syncSpy = jest
      .spyOn(BundleSync, 'reconcileCatalogAsync')
      .mockResolvedValue({ updated: true, count: 3 });

    const successResult = await controller.initializeAsync();
    syncSpy.mockRestore();

    expect(successResult.audioReady).toBe(true);
    expect(successResult.catalogReady).toBe(true);
    expect(successResult.totalSongs).toBe(3);
    expect(successResult.packFormatVersion).toBe(1);

    // Start playback
    await controller.reserve('000001');
    expect(controller.getState()).toBe('PLAYING');
    (mockAudio.reset as jest.Mock).mockClear();

    // Repeated initializeAsync while PLAYING must not reset playback or stop audio
    await controller.initializeAsync();
    expect(controller.getState()).toBe('PLAYING');
    expect(mockAudio.stop).not.toHaveBeenCalled();
    expect(mockAudio.reset).not.toHaveBeenCalled();
  });

  describe('Idle transition state cleanliness', () => {
    test('Next on the last song resets time, duration, active song, and key to clean IDLE', async () => {
      const controller = new PlaybackController(mockAudio, mockLibrary);
      await controller.reserve('000001');
      expect(controller.getState()).toBe('PLAYING');

      await controller.next();

      expect(controller.getState()).toBe('IDLE');
      expect(controller.getActiveSong()).toBeNull();
      expect(controller.getActiveReservation()).toBeNull();
      expect(controller.getCurrentTimeMs()).toBe(0);
      expect(controller.getTotalTimeMs()).toBe(0);
      expect(controller.getKeyOffset()).toBe(0);
      expect(controller.getPendingQueue()).toEqual([]);
    });

    test('Stop on the last song resets time, duration, active song, and key to clean IDLE', async () => {
      const controller = new PlaybackController(mockAudio, mockLibrary);
      await controller.reserve('000001');
      expect(controller.getState()).toBe('PLAYING');

      await controller.stop();

      expect(controller.getState()).toBe('IDLE');
      expect(controller.getActiveSong()).toBeNull();
      expect(controller.getActiveReservation()).toBeNull();
      expect(controller.getCurrentTimeMs()).toBe(0);
      expect(controller.getTotalTimeMs()).toBe(0);
      expect(controller.getKeyOffset()).toBe(0);
      expect(controller.getPendingQueue()).toEqual([]);
    });

    test('Natural end of the last song resets time, duration, active song, and key to clean IDLE', async () => {
      const controller = new PlaybackController(mockAudio, mockLibrary);
      await controller.reserve('000001');
      expect(controller.getState()).toBe('PLAYING');

      await controller.handleSongEnded();

      expect(controller.getState()).toBe('IDLE');
      expect(controller.getActiveSong()).toBeNull();
      expect(controller.getActiveReservation()).toBeNull();
      expect(controller.getCurrentTimeMs()).toBe(0);
      expect(controller.getTotalTimeMs()).toBe(0);
      expect(controller.getKeyOffset()).toBe(0);
      expect(controller.getPendingQueue()).toEqual([]);
    });

    test('Stop with songs still in queue resets active song and time to 0 and transitions to WAITING_FOR_PLAY', async () => {
      const controller = new PlaybackController(mockAudio, mockLibrary);
      await controller.reserve('000001');
      await controller.reserve('000002');
      expect(controller.getState()).toBe('PLAYING');

      await controller.stop();

      expect(controller.getState()).toBe('WAITING_FOR_PLAY');
      expect(controller.getActiveSong()).toBeNull();
      expect(controller.getActiveReservation()).toBeNull();
      expect(controller.getCurrentTimeMs()).toBe(0);
      expect(controller.getTotalTimeMs()).toBe(0);
      expect(controller.getPendingQueue().length).toBe(1);
    });

    test('Stop then immediately reserving a new song starts clean at 0 time without stale duration', async () => {
      const controller = new PlaybackController(mockAudio, mockLibrary);
      await controller.reserve('000001');
      expect(controller.getState()).toBe('PLAYING');

      await controller.stop();
      expect(controller.getCurrentTimeMs()).toBe(0);
      expect(controller.getTotalTimeMs()).toBe(0);

      await controller.reserve('000002');
      expect(controller.getState()).toBe('PLAYING');
      expect(controller.getActiveSong()?.code).toBe('000002');
      expect(controller.getCurrentTimeMs()).toBe(0);
    });

    test('B20: closePackFd is called after song preparation succeeds or fails', async () => {
      const controller = new PlaybackController(mockAudio, mockLibrary);
      (mockLibrary.closePackFd as jest.Mock).mockClear();

      await controller.reserve('000001');
      expect(mockLibrary.closePackFd).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Lyric display cleanup', () => {
  test.each([
    { chunks: ['ma', 'HAL ', 'Ki', 'TA '], want: 'MAHAL KITA' },
    { chunks: [' \tma', 'HAL \t', '  Ki', 'TA  '], want: 'MAHAL KITA' },
    { chunks: ['Pa', 'me', 'la ', 'one '], want: 'PAMELA ONE' },
    { chunks: ["wa'y ", 'pag-', 'iBIG ', 'niÑO '], want: "WA'Y PAG-IBIG NIÑO" },
    { chunks: ['él ', 'ñ ', 'ß ', 'e\u0301 '], want: 'ÉL Ñ SS É' },
    { chunks: ['na ', 'na ', 'NA ', 'na '], want: 'NA NA NA NA' },
    { chunks: ['hello', '   ', '  world', '\t '], want: 'HELLO WORLD' },
    { chunks: ['mahal ', ' ', ' kita '], want: 'MAHAL KITA' },
    { chunks: [' ', ' ', 'ma', 'hal ', ' ', ' '], want: 'MAHAL' },
    { chunks: ['wa\u00a0', '\t', ' y ', 'ni\u00f1o\u2003'], want: 'WA Y NIÑO' },
  ])('normalizes displayed syllables without rewriting $want', ({ chunks, want }) => {
    const input = chunks.map((text, i) => Object.freeze({
      text, timeMs: i * 200, isLineBreak: false, isParagraphBreak: false,
    }));
    const original = JSON.stringify(input);
    const sync = new LyricSynchronizer();
    sync.loadLyrics(input);

    const line = sync.getLines()[0];
    const window = sync.getDisplayWindow(200);
    expect(line.text).toBe(want);
    expect(line.syllables.map((s) => s.text).join('')).toBe(want);
    expect(window.line1Text).toBe(want);
    expect(window.line1Words.flatMap((w) => w.syllables).map((s) => s.text).join('')).toBe(want);
    expect(line.syllables.map((s) => s.timeMs)).toEqual(chunks.map((_, i) => i * 200));
    expect(JSON.stringify(input)).toBe(original);
  });

  test('counts leading-space word boundaries when wrapping lines', () => {
    const sync = new LyricSynchronizer();
    sync.loadLyrics(['one', ' two', ' three', ' four', ' five', ' six', ' seven', ' eight'].map((text, i) => ({
      text, timeMs: i * 200, isLineBreak: false, isParagraphBreak: false,
    })));

    expect(sync.getLines().map((l) => l.text)).toEqual(['ONE TWO THREE FOUR FIVE SIX SEVEN', 'EIGHT']);
    expect(sync.getLines()[0].words.map((w) => w.text.trim())).toEqual([
      'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN',
    ]);
  });

  test('uses source breaks as word boundaries when whitespace is missing', () => {
    const sync = new LyricSynchronizer();
    sync.loadLyrics(['you ', 'are ', 'my ', 'love', 'forever'].map((text, i) => ({
      text, timeMs: i * 200, isLineBreak: i === 4, isParagraphBreak: false,
    })));

    expect(sync.getLines().map((l) => l.text)).toEqual(['YOU ARE MY LOVE', 'FOREVER']);
    expect(sync.getDisplayWindow(800).activeLine).toBe(2);
    expect(sync.getLines()[1].syllables[0]).toEqual({
      text: 'FOREVER', timeMs: 800, isLineBreak: true, isParagraphBreak: false,
    });
  });

  test('inserts a space when merging short source lines without trailing spaces', () => {
    const sync = new LyricSynchronizer();
    sync.loadLyrics(['hello', 'world'].map((text, i) => ({
      text, timeMs: i * 200, isLineBreak: i === 1, isParagraphBreak: false,
    })));

    expect(sync.getLines().map((l) => l.text)).toEqual(['HELLO WORLD']);
    expect(sync.getLines()[0].words.map((w) => w.text.trim())).toEqual(['HELLO', 'WORLD']);
  });

  test.each(['.', ',', '!', '?', ';', ':'])('preserves spacing when merging a source line ending in %s', (mark) => {
    const input = [`mahal${mark}`, 'kita'].map((text, i) => Object.freeze({
      text, timeMs: i * 200, isLineBreak: i === 1, isParagraphBreak: false,
    }));
    const sync = new LyricSynchronizer();
    sync.loadLyrics(input);

    const line = sync.getLines()[0];
    expect(line.text).toBe(`MAHAL${mark} KITA`);
    expect(line.words.flatMap((w) => w.syllables).map((s) => s.text).join('')).toBe(line.text);
    expect(line.syllables.map((s) => s.timeMs)).toEqual([0, 200]);
    expect(input[0].text).toBe(`mahal${mark}`);
  });

  test('does not count whitespace-only events as words when wrapping', () => {
    const chunks = ['one ', ' ', 'two ', ' ', 'three ', ' ', 'four ', ' ', 'five '];
    const sync = new LyricSynchronizer();
    sync.loadLyrics(chunks.map((text, i) => ({
      text, timeMs: i * 100, isLineBreak: false, isParagraphBreak: false,
    })));

    const lines = sync.getLines();
    expect(lines.map((l) => l.text)).toEqual(['ONE TWO THREE FOUR FIVE']);
    expect(lines[0].words.map((w) => w.text.trim())).toEqual(['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE']);
    expect(lines.flatMap((l) => l.words).every((w) => w.text.trim().length > 0)).toBe(true);
    expect(lines.flatMap((l) => l.syllables).map((s) => s.timeMs)).toEqual(chunks.map((_, i) => i * 100));
    expect(lines[0].words.flatMap((w) => w.syllables).map((s) => s.text).join('')).toBe(lines[0].text);
  });

  test('keeps a hyphenated word across a short source break', () => {
    const sync = new LyricSynchronizer();
    sync.loadLyrics(['pag-', 'ibig '].map((text, i) => ({
      text, timeMs: i * 200, isLineBreak: i === 1, isParagraphBreak: false,
    })));

    expect(sync.getLines().map((l) => l.text)).toEqual(['PAG-IBIG']);
  });

  test('keeps an overflowing word intact across timed syllables', () => {
    const sync = new LyricSynchronizer();
    sync.loadLyrics(['one ', 'two ', 'three ', 'four ', 'supercalifragilistic', 'expialidocious ', 'end '].map((text, i) => ({
      text, timeMs: i * 200, isLineBreak: false, isParagraphBreak: false,
    })));

    expect(sync.getLines().map((l) => l.text)).toEqual([
      'ONE TWO THREE FOUR SUPERCALIFRAGILISTICEXPIALIDOCIOUS', 'END',
    ]);
    expect(sync.getLines().flatMap((l) => l.syllables).map((s) => s.timeMs)).toEqual([
      0, 200, 400, 600, 800, 1000, 1200,
    ]);
  });

  test('keeps musical pauses between complete words', () => {
    const sync = new LyricSynchronizer();
    sync.loadLyrics([
      { text: 'hello ', timeMs: 0, isLineBreak: false, isParagraphBreak: false },
      { text: 'world ', timeMs: 2500, isLineBreak: false, isParagraphBreak: false },
    ]);

    expect(sync.getLines().map((l) => l.text)).toEqual(['HELLO', 'WORLD']);
    expect(sync.getDisplayWindow(2500).activeLine).toBe(2);
  });

  test('does not treat whitespace-only events as singable display text', () => {
    const sync = new LyricSynchronizer();
    sync.loadLyrics([{ text: ' \t ', timeMs: 0, isLineBreak: false, isParagraphBreak: false }]);

    expect(sync.getLines()).toEqual([]);
    expect(sync.getDisplayWindow(0).line1Text).toBe('KANTAHULAY');
  });

  test('calculates countdown dots before line starts', () => {
    const sync = new LyricSynchronizer();
    sync.loadLyrics([
      { text: 'HELLO ', timeMs: 4000, isLineBreak: false, isParagraphBreak: false },
      { text: 'WORLD ', timeMs: 5000, isLineBreak: false, isParagraphBreak: false },
      { text: 'SECOND ', timeMs: 12000, isLineBreak: true, isParagraphBreak: false },
    ]);

    // When time is 0ms (4000ms until line 1 starts) -> 4 dots
    expect(sync.getDisplayWindow(0).countdownDots).toBe(4);
    // When time is 1100ms (2900ms remaining) -> 3 dots
    expect(sync.getDisplayWindow(1100).countdownDots).toBe(3);
    // When time is 2100ms (1900ms remaining) -> 2 dots
    expect(sync.getDisplayWindow(2100).countdownDots).toBe(2);
    // When time is 3100ms (900ms remaining) -> 1 dot
    expect(sync.getDisplayWindow(3100).countdownDots).toBe(1);
    // When time is 4000ms (started) -> 0 dots (countdown hidden)
    expect(sync.getDisplayWindow(4000).countdownDots).toBe(0);

    // During interlude: line 1 ends at 5800ms, line 2 starts at 12000ms
    // Gap is 6200ms (> 3500ms threshold)
    // At 6000ms: 6000ms remaining before line 2 -> 0 dots
    expect(sync.getDisplayWindow(6000).countdownDots).toBe(0);
    // At 9000ms: 3000ms remaining before line 2 -> 3 dots
    expect(sync.getDisplayWindow(9000).countdownDots).toBe(3);
    // At 10500ms: 1500ms remaining -> 2 dots
    expect(sync.getDisplayWindow(10500).countdownDots).toBe(2);
    // At 12000ms: started -> 0 dots
    expect(sync.getDisplayWindow(12000).countdownDots).toBe(0);
  });
});
