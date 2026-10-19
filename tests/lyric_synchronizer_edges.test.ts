import { LyricSynchronizer } from '../src/engine/LyricSynchronizer';

describe('LyricSynchronizer Edge Cases & Hardening', () => {
  test('handles zero-duration syllables and out-of-order timestamps gracefully', () => {
    const sync = new LyricSynchronizer();
    // Syllables with identical timestamps (zero duration) and out-of-order arrival
    sync.loadLyrics([
      { text: 'world ', timeMs: 2000, isLineBreak: false, isParagraphBreak: false },
      { text: 'Hello ', timeMs: 1000, isLineBreak: false, isParagraphBreak: false },
      { text: 'zero', timeMs: 2000, isLineBreak: false, isParagraphBreak: false },
      { text: 'time', timeMs: 2000, isLineBreak: false, isParagraphBreak: false },
    ]);

    const lines = sync.getLines();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0].startMs).toBe(1000);
    expect(lines[0].endMs).toBeGreaterThan(lines[0].startMs);

    // Sweep ratio should be bounded in [0, 1]
    const ratio0 = sync.getSweepRatio(0, 500);
    expect(ratio0).toBe(0.0);
    const ratioMid = sync.getSweepRatio(0, 1500);
    expect(ratioMid).toBeGreaterThanOrEqual(0.0);
    expect(ratioMid).toBeLessThanOrEqual(1.0);
    const ratioEnd = sync.getSweepRatio(0, 5000);
    expect(ratioEnd).toBe(1.0);
  });

  test('handles long instrumental break (> 30 seconds) with countdown dots at 4-beat threshold', () => {
    const sync = new LyricSynchronizer();
    // Line 1: 0ms to 2000ms
    // Break: 2800ms to 45000ms (42.2 second instrumental break!)
    // Line 2: 45000ms
    sync.loadLyrics([
      { text: 'First ', timeMs: 0, isLineBreak: true, isParagraphBreak: true },
      { text: 'phrase ', timeMs: 1000, isLineBreak: false, isParagraphBreak: false },
      { text: 'Second ', timeMs: 45000, isLineBreak: true, isParagraphBreak: true },
      { text: 'phrase ', timeMs: 45800, isLineBreak: false, isParagraphBreak: false },
    ]);

    const lines = sync.getLines();
    expect(lines.length).toBe(2);

    // At 20000ms (midway through 42s instrumental break):
    // Countdown should NOT show yet (remaining is 25000ms > 4000ms)
    const midBreak = sync.getDisplayWindow(20000);
    expect(midBreak.countdownDots).toBe(0);

    // At 42000ms (3000ms remaining before line 2):
    // Countdown dots should trigger 3 dots
    const nearEntry3 = sync.getDisplayWindow(42000);
    expect(nearEntry3.countdownDots).toBe(3);

    // At 43500ms (1500ms remaining): 2 dots
    const nearEntry2 = sync.getDisplayWindow(43500);
    expect(nearEntry2.countdownDots).toBe(2);

    // At 45000ms (vocal entry): countdown hidden (0 dots)
    const vocalEntry = sync.getDisplayWindow(45000);
    expect(vocalEntry.countdownDots).toBe(0);
    expect(vocalEntry.activeLine).toBe(2);
  });

  test('displays INSTRUMENTAL for songs with no lyrics when marked instrumental', () => {
    const sync = new LyricSynchronizer();
    sync.setInstrumental(true);
    sync.loadLyrics([]);

    expect(sync.isInstrumental()).toBe(true);
    const window = sync.getDisplayWindow(5000);
    expect(window.line1Text).toBe('INSTRUMENTAL');
    expect(window.line2Text).toBe('');
    expect(window.line1Words).toEqual([]);
    expect(window.line2Words).toEqual([]);
  });
});
