/**
 * Maps raw system, SQLite, and native error messages to short, friendly user messages.
 * Logs full technical details to console.error without exposing them in the UI.
 */
export function formatUserErrorMessage(err: unknown, fallback: string = 'An unexpected error occurred'): string {
  if (!err) return fallback;

  const rawMessage = typeof err === 'string' ? err : (err as any)?.message || String(err);
  console.error('[Kantahulay:TechnicalError]', err);

  const lower = rawMessage.toLowerCase();

  // Constraints & duplicate checks first
  if (lower.includes('unique constraint') || lower.includes('idx_queue_one_active')) {
    return 'A song is already playing or queued.';
  }

  // SQLite / Database issues
  if (lower.includes('sqlite') || lower.includes('database busy') || lower.includes('database locked') || lower.includes('disk i/o error')) {
    return 'Database is busy. Please try again.';
  }
  if (lower.includes('no such table') || lower.includes('corrupt') || lower.includes('malformed')) {
    return 'Song catalog needs to be reloaded.';
  }

  // Audio / SoundFont / Native synthesizer errors
  if (lower.includes('soundfont') || lower.includes('sf2') || lower.includes('cannot open soundfont')) {
    return 'Could not load sound files. Please retry.';
  }
  if (lower.includes('audio') || lower.includes('oboe') || lower.includes('fluidsynth') || lower.includes('tinysoundfont')) {
    return 'Audio engine error. Please retry.';
  }

  // File / Asset / Storage errors
  if (lower.includes('enoent') || lower.includes('filenotfound') || lower.includes('cannot open file')) {
    return 'Song file not found or corrupted.';
  }
  if (lower.includes('enospc') || lower.includes('storage') || lower.includes('out of memory')) {
    return 'Low device storage space.';
  }

  // Already user-friendly or short messages
  if (rawMessage.length <= 40 && !lower.includes('error:') && !lower.includes('at ') && !lower.includes('exception')) {
    return rawMessage;
  }

  return fallback;
}
