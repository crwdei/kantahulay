import { cleanupTestEnvironment, setupTestEnvironment } from './testDbAdapter';
import { PlaybackController } from '../src/engine/PlaybackController';
import { AudioModuleInterface } from '../modules/kantahulay-audio';
import { LibraryModuleInterface } from '../modules/kantahulay-library';
import { getDatabaseAsync } from '../src/db/database';
import { QueueDao } from '../src/db/queueDao';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function beforeLoadCompletes<T>(promise: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Command blocked behind native preparation')), 500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe('U04: production controller cancellation', () => {
  let audio: jest.Mocked<AudioModuleInterface>;
  let library: LibraryModuleInterface;

  beforeEach(async () => {
    setupTestEnvironment();
    const db = await getDatabaseAsync();
    for (const code of ['000001', '000002', '000003']) {
      await db.runAsync(`INSERT INTO songs VALUES (?, ?, 'Artist', 'test', 1000, 1, 16, 100, 200, 'sha');`, [code, code]);
    }
    audio = {
      initialize: jest.fn().mockReturnValue(true), loadSoundFont: jest.fn().mockReturnValue(true),
      ensureSoundFontLoaded: jest.fn().mockResolvedValue(true), prepareSong: jest.fn().mockResolvedValue(true),
      play: jest.fn(), pause: jest.fn(), stop: jest.fn(), reset: jest.fn(), setKeyOffset: jest.fn(),
      getPlaybackState: jest.fn().mockReturnValue(0), getCurrentTimeMs: jest.fn().mockReturnValue(0),
      getTotalTimeMs: jest.fn().mockReturnValue(120000), getLyrics: jest.fn().mockResolvedValue([]),
      isSongEnded: jest.fn().mockReturnValue(false),
    };
    library = {
      openPackFd: jest.fn().mockReturnValue({ fd: 10, startOffset: 0, length: 1000 }),
      closePackFd: jest.fn(), readManifest: jest.fn().mockReturnValue(null),
      copyCatalogToTemp: jest.fn().mockResolvedValue(true), extractCatalogToCache: jest.fn().mockResolvedValue(null),
    };
  });
  afterEach(cleanupTestEnvironment);

  test('Stop commits before unresolved prepare and stale completion never plays', async () => {
    const started = deferred<void>();
    const preparation = deferred<boolean>();
    audio.prepareSong.mockImplementationOnce(() => { started.resolve(); return preparation.promise; });
    const controller = new PlaybackController(audio, library);
    const load = controller.reserve('000001');
    await started.promise;
    try {
      await beforeLoadCompletes(controller.stop());
      expect(controller.getState()).toBe('IDLE');
      expect(await QueueDao.getActive()).toBeNull();
    } finally {
      preparation.resolve(true);
      await load;
    }
    expect(audio.play).not.toHaveBeenCalled();
  });

  test('Next prepares next reservation without waiting for old preparation', async () => {
    const started = deferred<void>();
    const preparation = deferred<boolean>();
    audio.prepareSong.mockImplementationOnce(() => { started.resolve(); return preparation.promise; });
    const controller = new PlaybackController(audio, library);
    const load = controller.reserve('000001');
    await started.promise;
    try {
      await beforeLoadCompletes(controller.reserve('000002'));
      await beforeLoadCompletes(controller.next());
      expect(controller.getActiveSong()?.code).toBe('000002');
      expect(controller.getState()).toBe('PLAYING');
    } finally {
      preparation.resolve(true);
      await load;
    }
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  test('Stop while lyrics resolve invalidates completion after second await', async () => {
    const started = deferred<void>();
    const lyrics = deferred<[]>();
    audio.getLyrics.mockImplementationOnce(() => { started.resolve(); return lyrics.promise; });
    const controller = new PlaybackController(audio, library);
    const load = controller.reserve('000001');
    await started.promise;
    try {
      await beforeLoadCompletes(controller.stop());
    } finally {
      lyrics.resolve([]);
      await load;
    }
    expect(audio.play).not.toHaveBeenCalled();
    expect(controller.getState()).toBe('IDLE');
  });

  test('B05: background during preparation stays PAUSED until explicit Play', async () => {
    const started = deferred<void>();
    const preparation = deferred<boolean>();
    audio.prepareSong.mockImplementationOnce(() => { started.resolve(); return preparation.promise; });
    const controller = new PlaybackController(audio, library);
    const load = controller.reserve('000001');
    await started.promise;
    controller.handleAudioFocusChange({ event: 'BACKGROUND', action: 'PAUSE' });
    preparation.resolve(true);
    await load;
    expect(controller.getState()).toBe('PAUSED');
    expect(audio.play).not.toHaveBeenCalled();
    await controller.play();
    expect(controller.getState()).toBe('PLAYING');
    expect(audio.play).toHaveBeenCalledTimes(1);
  });
});
