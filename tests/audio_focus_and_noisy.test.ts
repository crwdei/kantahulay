import { PlaybackController } from '../src/engine/PlaybackController';
import { AudioModuleInterface } from '../modules/kantahulay-audio';

describe('B02 & B03: Audio focus and becoming noisy lifecycle', () => {
  let focusCallback: ((event: { event: string; action: string }) => void) | null = null;
  let noisyCallback: ((event: { action: string }) => void) | null = null;
  let mockAudio: AudioModuleInterface;
  let mockLibrary: any;

  beforeEach(() => {
    focusCallback = null;
    noisyCallback = null;

    mockAudio = {
      initialize: jest.fn().mockReturnValue(true),
      loadSoundFont: jest.fn().mockReturnValue(true),
      ensureSoundFontLoaded: jest.fn().mockResolvedValue(true),
      prepareSong: jest.fn().mockResolvedValue(true),
      play: jest.fn(),
      pause: jest.fn(),
      stop: jest.fn(),
      setKeyOffset: jest.fn(),
      getPlaybackState: jest.fn().mockReturnValue(0),
      getCurrentTimeMs: jest.fn().mockReturnValue(0),
      getTotalTimeMs: jest.fn().mockReturnValue(180000),
      getLyrics: jest.fn().mockResolvedValue([]),
      isSongEnded: jest.fn().mockReturnValue(false),
      reset: jest.fn(),
      addAudioFocusListener: jest.fn().mockImplementation((cb) => {
        focusCallback = cb;
        return { remove: jest.fn() };
      }),
      addAudioBecomingNoisyListener: jest.fn().mockImplementation((cb) => {
        noisyCallback = cb;
        return { remove: jest.fn() };
      }),
    };

    mockLibrary = {
      readManifest: jest.fn().mockReturnValue(null),
      extractCatalogToCache: jest.fn().mockResolvedValue(null),
    };
  });

  test('B02: focus loss (call/alarm) pauses native playback and transitions JS state to PAUSED', () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    (controller as any).state = 'PLAYING';

    expect(focusCallback).toBeTruthy();
    focusCallback!({ event: 'LOSS', action: 'PAUSE' });

    expect(mockAudio.pause).toHaveBeenCalled();
    expect(controller.getState()).toBe('PAUSED');
  });

  test('B02: focus regain after call (STAY_PAUSED) does not auto-resume', () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    (controller as any).state = 'PAUSED';

    focusCallback!({ event: 'GAIN', action: 'STAY_PAUSED' });

    expect(mockAudio.play).not.toHaveBeenCalled();
    expect(controller.getState()).toBe('PAUSED');
  });

  test('B02: transient focus regain (RESUME) auto-resumes playback', () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    (controller as any).state = 'PAUSED';

    focusCallback!({ event: 'GAIN', action: 'RESUME' });

    expect(mockAudio.play).toHaveBeenCalled();
    expect(controller.getState()).toBe('PLAYING');
  });

  test('B03: audio becoming noisy (unplug headphones) pauses playback and updates JS state to PAUSED', () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    (controller as any).state = 'PLAYING';

    expect(noisyCallback).toBeTruthy();
    noisyCallback!({ action: 'PAUSE' });

    expect(mockAudio.pause).toHaveBeenCalled();
    expect(controller.getState()).toBe('PAUSED');
  });

  test('B03: audio becoming noisy ignored when already paused or idle', () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    (controller as any).state = 'IDLE';

    expect(noisyCallback).toBeTruthy();
    noisyCallback!({ action: 'PAUSE' });

    expect(mockAudio.pause).not.toHaveBeenCalled();
    expect(controller.getState()).toBe('IDLE');
  });

  test('B05: screen off / background event pauses playback and stays paused on regain', () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    (controller as any).state = 'PLAYING';

    expect(focusCallback).toBeTruthy();
    focusCallback!({ event: 'SCREEN_OFF', action: 'PAUSE' });

    expect(mockAudio.pause).toHaveBeenCalled();
    expect(controller.getState()).toBe('PAUSED');

    // On return to foreground / screen unlock, it receives GAIN with STAY_PAUSED
    focusCallback!({ event: 'GAIN', action: 'STAY_PAUSED' });
    expect(mockAudio.play).not.toHaveBeenCalled();
    expect(controller.getState()).toBe('PAUSED');
  });
});
