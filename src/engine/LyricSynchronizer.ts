export interface LyricSyllable {
  text: string;
  timeMs: number;
  isLineBreak: boolean;
  isParagraphBreak: boolean;
}

export interface LyricWord {
  text: string;
  syllables: LyricSyllable[];
}

export interface LyricLine {
  lineIndex: number;
  startMs: number;
  endMs: number;
  text: string;
  syllables: LyricSyllable[];
  words: LyricWord[];
}

export interface LyricDisplayWindow {
  line1Words: LyricWord[];
  line2Words: LyricWord[];
  line1Syllables: LyricSyllable[];
  line2Syllables: LyricSyllable[];
  line1Text: string;
  line2Text: string;
  activeLine: 1 | 2;
  activeRatio: number;
  countdownDots: number; // 0 to 4 dots indicating impending vocal entry
}

function isWordBoundary(syl?: LyricSyllable): boolean {
  if (!syl) return true;
  if (syl.text.endsWith('-')) return false;
  return /[ \t\.,!?;:\/]$/.test(syl.text);
}

function hasLeadingBoundary(syl?: LyricSyllable): boolean {
  if (!syl) return false;
  return /^[ \t\.,!?;:\/]/.test(syl.text);
}

function isWordSeparator(syl?: LyricSyllable, nextSyl?: LyricSyllable): boolean {
  return isWordBoundary(syl) || hasLeadingBoundary(nextSyl);
}

function cleanToken(raw: string): string {
  return raw
    .normalize('NFC')
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function groupSyllablesIntoWords(syllables: LyricSyllable[]): LyricWord[] {
  const words: LyricWord[] = [];
  let cur: LyricSyllable[] = [];

  for (let i = 0; i < syllables.length; i++) {
    const s = syllables[i];
    cur.push(s);
    if (isWordSeparator(s, syllables[i + 1]) && cur.some((x) => x.text.trim())) {
      words.push({
        text: cur.map((x) => x.text).join(''),
        syllables: cur,
      });
      cur = [];
    }
  }
  if (cur.length > 0) {
    const text = cur.map((x) => x.text).join('');
    if (text.trim()) {
      words.push({ text, syllables: cur });
    } else if (words.length > 0) {
      // Retain silent event timestamps without counting them as another word.
      const last = words[words.length - 1];
      last.text += text;
      last.syllables.push(...cur);
    }
  }
  return words;
}

export class LyricSynchronizer {
  private lines: LyricLine[] = [];
  private isInstrumentalFlag: boolean = false;

  setInstrumental(instrumental: boolean) {
    this.isInstrumentalFlag = instrumental;
  }

  isInstrumental(): boolean {
    return this.isInstrumentalFlag;
  }

  getSweepRatio(lineIdx: number, currentTimeMs: number): number {
    const line = this.lines[lineIdx];
    if (!line || line.endMs <= line.startMs) {
      return 0;
    }
    if (currentTimeMs <= line.startMs) return 0.0;
    if (currentTimeMs >= line.endMs) return 1.0;
    return Math.min(1.0, Math.max(0.0, (currentTimeMs - line.startMs) / (line.endMs - line.startMs)));
  }

  loadLyrics(syllables: LyricSyllable[]) {
    this.lines = [];
    if (!syllables || syllables.length === 0) return;

    const sanitized: LyricSyllable[] = [];
    for (let i = 0; i < syllables.length; i++) {
      const s = syllables[i];
      let txt = cleanToken(s.text);
      if (s.isLineBreak || s.isParagraphBreak) {
        txt = txt.replace(/^[ \t]+/, '');
      }
      if (!txt) continue;
      sanitized.push({
        text: txt,
        timeMs: s.timeMs,
        isLineBreak: s.isLineBreak,
        isParagraphBreak: s.isParagraphBreak,
      });
    }

    if (sanitized.length === 0 || !sanitized.some((s) => s.text.trim().length > 0)) {
      return;
    }

    sanitized.sort((a, b) => a.timeMs - b.timeMs);

    let currentLineSyllables: LyricSyllable[] = [];
    let lineIdx = 0;
    let pendingLineBreak = false;

    for (let i = 0; i < sanitized.length; ++i) {
      const syl = sanitized[i];

      const prevSyl = currentLineSyllables[currentLineSyllables.length - 1];
      const prevEndedWord = isWordSeparator(prevSyl, syl) || syl.isLineBreak || syl.isParagraphBreak;

      const wordsCount = groupSyllablesIntoWords(currentLineSyllables).length;
      const charsCount = currentLineSyllables.reduce((acc, s) => acc + s.text.length, 0);

      const isParagraph = syl.isParagraphBreak;
      const isTimeGap = prevSyl && (syl.timeMs - prevSyl.timeMs > 1800);
      const isSufficientBreak = syl.isLineBreak && (wordsCount >= 4 || charsCount >= 22);
      const isOverflow = prevEndedWord && (wordsCount >= 7 || charsCount >= 36);

      const shouldBreak = isParagraph || isTimeGap || isSufficientBreak || isOverflow;

      if ((pendingLineBreak || shouldBreak) && currentLineSyllables.length > 0) {
        if (prevEndedWord) {
          this.finishLine(lineIdx++, currentLineSyllables);
          currentLineSyllables = [];
          pendingLineBreak = false;
        } else {
          pendingLineBreak = true;
        }
      }

      const lastInCurrent = currentLineSyllables[currentLineSyllables.length - 1];
      if (
        lastInCurrent &&
        !/\s$/.test(lastInCurrent.text) &&
        !/^\s/.test(syl.text) &&
        !lastInCurrent.text.endsWith('-') &&
        (syl.isLineBreak || syl.isParagraphBreak)
      ) {
        lastInCurrent.text = `${lastInCurrent.text} `;
      }

      currentLineSyllables.push(syl);

      if (pendingLineBreak && isWordSeparator(syl, sanitized[i + 1]) && currentLineSyllables.length > 0) {
        const wordsNow = groupSyllablesIntoWords(currentLineSyllables).length;
        const charsNow = currentLineSyllables.reduce((acc, s) => acc + s.text.length, 0);
        if (wordsNow >= 4 || charsNow >= 22 || isOverflow) {
          this.finishLine(lineIdx++, currentLineSyllables);
          currentLineSyllables = [];
          pendingLineBreak = false;
        }
      }
    }
    if (currentLineSyllables.length > 0) {
      this.finishLine(lineIdx, currentLineSyllables);
    }
  }

  private finishLine(lineIdx: number, syllables: LyricSyllable[]) {
    if (syllables.length === 0) return;

    let endsWithSpace = true;
    const displaySyllables: LyricSyllable[] = syllables.map((s) => {
      const text = endsWithSpace ? s.text.replace(/^ +/, '') : s.text;
      if (text) endsWithSpace = text.endsWith(' ');
      return { ...s, text };
    });
    for (let i = displaySyllables.length - 1; i >= 0; --i) {
      const s = displaySyllables[i];
      s.text = s.text.replace(/ +$/, '');
      if (s.text) break;
    }
    const last = displaySyllables[displaySyllables.length - 1];
    const lineText = displaySyllables.map((s) => s.text).join('');
    if (!lineText) return;

    const startMs = displaySyllables[0].timeMs;
    const endMs = last.timeMs + 800;
    const words = groupSyllablesIntoWords(displaySyllables);

    this.lines.push({
      lineIndex: lineIdx,
      startMs,
      endMs,
      text: lineText,
      syllables: displaySyllables,
      words,
    });
  }

  getDisplayWindow(currentTimeMs: number): LyricDisplayWindow {
    if (this.isInstrumentalFlag || this.lines.length === 0) {
      return {
        line1Words: [],
        line2Words: [],
        line1Syllables: [],
        line2Syllables: [],
        line1Text: this.isInstrumentalFlag ? 'INSTRUMENTAL' : 'KANTAHULAY',
        line2Text: '',
        activeLine: 1,
        activeRatio: 0,
        countdownDots: 0,
      };
    }

    // Determine upcoming line and compute countdown
    let countdownDots = 0;
    if (currentTimeMs < this.lines[0].startMs) {
      const remainingMs = this.lines[0].startMs - currentTimeMs;
      if (remainingMs <= 4000 && remainingMs > 0) {
        countdownDots = Math.min(4, Math.max(1, Math.ceil(remainingMs / 1000)));
      }
    }

    let activeLineIdx = 0;
    for (let i = 0; i < this.lines.length; ++i) {
      if (currentTimeMs >= this.lines[i].startMs) {
        activeLineIdx = i;
      } else {
        break;
      }
    }

    const cur = this.lines[activeLineIdx];
    let ratio = 0;
    if (cur && cur.endMs > cur.startMs) {
      ratio = Math.min(1.0, Math.max(0.0, (currentTimeMs - cur.startMs) / (cur.endMs - cur.startMs)));
    }

    // Check for countdown in interlude before next line
    if (countdownDots === 0 && activeLineIdx < this.lines.length - 1) {
      const nextLine = this.lines[activeLineIdx + 1];
      if (cur && currentTimeMs >= cur.endMs && currentTimeMs < nextLine.startMs) {
        const gap = nextLine.startMs - cur.endMs;
        const remainingMs = nextLine.startMs - currentTimeMs;
        if (gap >= 3500 && remainingMs <= 4000 && remainingMs > 0) {
          countdownDots = Math.min(4, Math.max(1, Math.ceil(remainingMs / 1000)));
        }
      }
    }

    // Two-line alternating window
    if (activeLineIdx % 2 === 0) {
      const next = this.lines[activeLineIdx + 1];
      return {
        line1Words: cur ? cur.words : [],
        line2Words: next ? next.words : [],
        line1Syllables: cur ? cur.syllables : [],
        line2Syllables: next ? next.syllables : [],
        line1Text: cur?.text || '',
        line2Text: next?.text || '',
        activeLine: 1,
        activeRatio: ratio,
        countdownDots,
      };
    } else {
      const upcoming = this.lines[activeLineIdx + 1];
      return {
        line1Words: upcoming ? upcoming.words : [],
        line2Words: cur ? cur.words : [],
        line1Syllables: upcoming ? upcoming.syllables : [],
        line2Syllables: cur ? cur.syllables : [],
        line1Text: upcoming?.text || '',
        line2Text: cur?.text || '',
        activeLine: 2,
        activeRatio: ratio,
        countdownDots,
      };
    }
  }

  getLines(): LyricLine[] {
    return this.lines;
  }
}
