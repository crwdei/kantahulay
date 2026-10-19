import { formatUserErrorMessage } from '../src/utils/errorMapper';

describe('U11: Error Mapping & Technical Details Sanitization', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('maps raw SQLite errors to friendly user messages and logs technical details', () => {
    const raw = 'SqliteError: cannot start a transaction within a transaction (code 1)';
    const friendly = formatUserErrorMessage(raw);

    expect(friendly).toBe('Database is busy. Please try again.');
    expect(consoleSpy).toHaveBeenCalledWith('[Kantahulay:TechnicalError]', raw);
  });

  test('maps unique constraint failures to duplicate/queue active message', () => {
    const raw = 'SqliteError: UNIQUE constraint failed: queue.status idx_queue_one_active';
    const friendly = formatUserErrorMessage(raw);

    expect(friendly).toBe('A song is already playing or queued.');
    expect(consoleSpy).toHaveBeenCalledWith('[Kantahulay:TechnicalError]', raw);
  });

  test('maps native synthesizer / soundfont errors to friendly audio retry message', () => {
    const raw = 'NativeAudioException: cannot open soundfont /data/user/0/soundfont.sf2';
    const friendly = formatUserErrorMessage(raw);

    expect(friendly).toBe('Could not load sound files. Please retry.');
    expect(consoleSpy).toHaveBeenCalledWith('[Kantahulay:TechnicalError]', raw);
  });

  test('maps file missing or corrupt errors to friendly song file message', () => {
    const raw = 'Error: ENOENT: no such file or directory, open "assets/songs.kpak"';
    const friendly = formatUserErrorMessage(raw);

    expect(friendly).toBe('Song file not found or corrupted.');
    expect(consoleSpy).toHaveBeenCalledWith('[Kantahulay:TechnicalError]', raw);
  });

  test('passes through short safe messages', () => {
    const msg = 'Please choose a song';
    expect(formatUserErrorMessage(msg)).toBe('Please choose a song');
  });

  test('falls back to safe generic message for unrecognized technical stack traces', () => {
    const longStack = 'Error: unhandled runtime failure at AudioEngine.render (audio_engine.cpp:342:15) with code 0x80004005';
    const friendly = formatUserErrorMessage(longStack);
    expect(friendly).toBe('Audio engine error. Please retry.');
  });
});
