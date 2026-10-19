import { QueueDao } from '../db/queueDao';
import { SongDao } from '../db/songDao';
import { SettingsDao } from '../db/settingsDao';
import { BundleSync, BundleManifest } from '../db/bundleSync';
import { QueueItem, Song } from '../db/types';
import { EngineListener, PlaybackState, InitializationResult } from './types';
import { LyricSynchronizer } from './LyricSynchronizer';
import AudioModule, { AudioModuleInterface } from '../../modules/kantahulay-audio';
import LibraryModule, { LibraryModuleInterface } from '../../modules/kantahulay-library';

function validateManifest(raw: any): BundleManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Manifest is not an object');
  }
  const {
    pack_format_version,
    catalog_version,
    pack_sha256,
    catalog_sha256,
    entry_count,
    pack_bytes,
    build_id,
    rights_review_id,
  } = raw;

  if (!Number.isInteger(pack_format_version) || pack_format_version < 1) {
    throw new Error('Invalid pack_format_version');
  }
  if (!Number.isInteger(catalog_version) || catalog_version < 1) {
    throw new Error('Invalid catalog_version');
  }
  if (typeof pack_sha256 !== 'string' || pack_sha256.length !== 64) {
    throw new Error('Invalid pack_sha256');
  }
  if (typeof catalog_sha256 !== 'string' || catalog_sha256.length !== 64) {
    throw new Error('Invalid catalog_sha256');
  }
  if (!Number.isInteger(entry_count) || entry_count < 0) {
    throw new Error('Invalid entry_count');
  }
  if (typeof pack_bytes !== 'number' || pack_bytes < 0) {
    throw new Error('Invalid pack_bytes');
  }
  if (typeof build_id !== 'string' || !build_id) {
    throw new Error('Invalid build_id');
  }
  if (typeof rights_review_id !== 'string' || !rights_review_id) {
    throw new Error('Invalid rights_review_id');
  }

  return raw as BundleManifest;
}

export class PlaybackController {
  private state: PlaybackState = 'IDLE';
  private activeSong: Song | null = null;
  private activeReservation: QueueItem | null = null;
  private pendingQueue: QueueItem[] = [];
  private keyOffset: number = 0;
  private currentTimeMs: number = 0;
  private totalTimeMs: number = 0;
  private generation: number = 0;
  private listeners: Set<EngineListener> = new Set();
  private lyricSync: LyricSynchronizer = new LyricSynchronizer();
  private audio: AudioModuleInterface;
  private library: LibraryModuleInterface;
  private queueNeedsRefresh: boolean = false;
  private audioReady: boolean = false;
  private catalogReady: boolean = false;
  private totalSongs: number | null = null;
  private packFormatVersion: number | null = null;
  private hasStartedSession: boolean = false;
  private initPromise: Promise<InitializationResult> | null = null;
  private soundFontPromise: Promise<boolean> | null = null;
  private audioFocusSub: { remove: () => void } | null = null;
  private audioNoisySub: { remove: () => void } | null = null;
  private pauseAfterLoad = false;

  constructor(audio?: AudioModuleInterface, library?: LibraryModuleInterface) {
    this.audio = audio || AudioModule;
    this.library = library || LibraryModule;

    if (this.audio.addAudioFocusListener) {
      this.audioFocusSub = this.audio.addAudioFocusListener((event) => {
        this.handleAudioFocusChange(event);
      });
    }
    if (this.audio.addAudioBecomingNoisyListener) {
      this.audioNoisySub = this.audio.addAudioBecomingNoisyListener((event) => {
        this.handleAudioBecomingNoisy(event);
      });
    }
  }

  destroy(): void {
    this.audioFocusSub?.remove();
    this.audioNoisySub?.remove();
  }

  handleAudioFocusChange(event: { event: string; action: string }): void {
    if (event.action === 'PAUSE' || event.action === 'DUCK') {
      this.pause();
    } else if (event.action === 'RESUME' && this.state === 'PAUSED') {
      this.audio.play();
      this.state = 'PLAYING';
      this.notifyState();
    }
  }

  handleAudioBecomingNoisy(_event: { action: string }): void {
    this.pause();
  }

  addListener(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyState() {
    for (const l of this.listeners) l.onStateChange?.(this.state);
  }

  private notifySong() {
    for (const l of this.listeners) l.onActiveSongChange?.(this.activeSong, this.activeReservation);
  }

  private resetIdlePlayerState(): void {
    this.activeSong = null;
    this.activeReservation = null;
    this.keyOffset = 0;
    this.currentTimeMs = 0;
    this.totalTimeMs = 0;
    this.lyricSync.setInstrumental(false);
    this.lyricSync.loadLyrics([]);
    this.notifySong();
    this.notifyKey();
  }

  private notifyQueue() {
    for (const l of this.listeners) l.onQueueChange?.(this.pendingQueue);
  }

  private notifyKey() {
    for (const l of this.listeners) l.onKeyChange?.(this.keyOffset);
  }

  getState(): PlaybackState {
    return this.state;
  }

  getActiveSong(): Song | null {
    return this.activeSong;
  }

  getActiveReservation(): QueueItem | null {
    return this.activeReservation;
  }

  getPendingQueue(): QueueItem[] {
    return [...this.pendingQueue];
  }

  getQueueNeedsRefresh(): boolean {
    return this.queueNeedsRefresh;
  }

  getKeyOffset(): number {
    return this.keyOffset;
  }

  getCurrentTimeMs(): number {
    if (this.state === 'PLAYING') {
      this.currentTimeMs = this.audio.getCurrentTimeMs();
    }
    return this.currentTimeMs;
  }

  isSongEnded(): boolean {
    return this.audio.isSongEnded();
  }

  getTotalTimeMs(): number {
    return this.totalTimeMs;
  }

  isAudioReady(): boolean {
    return this.audioReady;
  }

  isCatalogReady(): boolean {
    return this.catalogReady;
  }

  getTotalSongs(): number | null {
    return this.totalSongs;
  }

  getPackFormatVersion(): number | null {
    return this.packFormatVersion;
  }

  isPreparingSound(): boolean {
    return !this.audioReady && Boolean(this.soundFontPromise || this.initPromise);
  }

  getLyricSync(): LyricSynchronizer {
    return this.lyricSync;
  }

  async initializeAsync(): Promise<InitializationResult> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      // New controller means a fresh launch; background/resume keeps this controller.
      if (!this.hasStartedSession) {
        await this.enqueueCommand(async () => {
          this.audio.reset();
          await QueueDao.clearAll();
          this.resetIdlePlayerState();
          this.pendingQueue = [];
          this.queueNeedsRefresh = false;
          this.state = 'IDLE';
          this.hasStartedSession = true;
          this.notifyQueue();
          this.notifyState();
        });
      }

      // 1. Audio initialization (only if not already ready)
      if (!this.audioReady) {
        try {
          const initOk = this.audio.initialize();
          if (initOk) {
            this.soundFontPromise = this.audio.ensureSoundFontLoaded().catch(() => false);
          } else {
            this.soundFontPromise = Promise.resolve(false);
          }
          const sfOk = initOk && (await this.soundFontPromise);
          this.audioReady = Boolean(initOk && sfOk);

          // 1b. Load persistent audio settings from DB before first song plays (B08, B17)
          const offset = await SettingsDao.getBluetoothLyricOffset();
          this.audio.setBluetoothLyricOffset?.(offset);
          const effectsLevel = await SettingsDao.getVocalEffectsLevel();
          this.audio.setEffectsLevel?.(effectsLevel);
          const musicVolume = await SettingsDao.getMusicVolume();
          this.audio.setMasterGain?.(musicVolume);
        } catch {
          this.audioReady = false;
        } finally {
          this.soundFontPromise = null;
        }
      }

      // 2. Catalog & manifest reconciliation
      try {
        const manifestStr = this.library.readManifest();
        if (manifestStr) {
          const parsed = JSON.parse(manifestStr);
          const manifest = validateManifest(parsed);
          const cachePath = await this.library.extractCatalogToCache();
          if (cachePath) {
            const syncResult = await BundleSync.reconcileCatalogAsync(cachePath, manifest);
            this.totalSongs = syncResult.count;
            this.packFormatVersion = manifest.pack_format_version;
            this.catalogReady = true;
          } else {
            this.catalogReady = false;
          }
        } else {
          this.catalogReady = false;
        }
      } catch {
        this.catalogReady = false;
      }

      return {
        audioReady: this.audioReady,
        catalogReady: this.catalogReady,
        totalSongs: this.totalSongs,
        packFormatVersion: this.packFormatVersion,
      };
    })().finally(() => {
      this.initPromise = null;
    });

    return this.initPromise;
  }

  async refreshQueueAsync(): Promise<void> {
    this.pendingQueue = await QueueDao.getPending();
    this.queueNeedsRefresh = false;
    this.notifyQueue();
  }

  private commandLane: Promise<any> = Promise.resolve();

  private enqueueCommand<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.commandLane.then(fn, fn);
    this.commandLane = next.catch(() => {});
    return next;
  }

  // Keep DB transitions serialized, but never hold the lane while native work runs.
  private enqueueLoadCommand(fn: () => Promise<{ loading?: Promise<void> } | void>): Promise<void> {
    return this.enqueueCommand(fn).then((result) => result?.loading);
  }

  private beginPreparation(): number {
    const generation = ++this.generation;
    this.pauseAfterLoad = false;
    this.audio.beginPreparation?.(generation);
    return generation;
  }

  private async refreshQueueAfterCommitAsync(): Promise<void> {
    try {
      await this.refreshQueueAsync();
    } catch {
      this.queueNeedsRefresh = true;
      for (const l of this.listeners) l.onQueueRefreshFailed?.();
    }
  }

  reserve(songCode: string): Promise<void> {
    if (this.state === 'IDLE') {
      const currentGen = this.beginPreparation();
      this.state = 'LOADING';
      this.notifyState();

      return this.enqueueLoadCommand(async () => {
        const existingActive = await QueueDao.getActive();
        if (existingActive) {
          await QueueDao.stopQueue(true);
        }

        const activeItem = await QueueDao.reserve(songCode, true);
        if (this.generation !== currentGen) {
          return;
        }
        this.activeReservation = activeItem;
        this.activeSong = await SongDao.getByCode(songCode);
        this.keyOffset = 0;
        this.notifySong();
        this.notifyKey();
        await this.refreshQueueAfterCommitAsync();
        return { loading: this.loadAndPlayCurrentAsync(currentGen) };
      });
    } else {
      return this.enqueueCommand(async () => {
        await QueueDao.reserve(songCode, false);
        await this.refreshQueueAfterCommitAsync();
      });
    }
  }

  playNow(songCode: string): Promise<void> {
    this.audio.stop();
    const currentGen = this.beginPreparation();
    this.state = 'LOADING';
    this.notifyState();

    return this.enqueueLoadCommand(async () => {
      await QueueDao.stopQueue(true);

      const activeItem = await QueueDao.reserve(songCode, true);
      if (this.generation !== currentGen) {
        return;
      }
      this.activeReservation = activeItem;
      this.activeSong = await SongDao.getByCode(songCode);
      this.keyOffset = 0;
      this.notifySong();
      this.notifyKey();
      await this.refreshQueueAfterCommitAsync();
      return { loading: this.loadAndPlayCurrentAsync(currentGen) };
    });
  }

  play(): Promise<void> {
    return this.enqueueLoadCommand(async () => {
      if (this.state === 'PAUSED') {
        this.audio.play();
        this.state = 'PLAYING';
        this.notifyState();
        return;
      }

      if (this.state === 'WAITING_FOR_PLAY' || this.state === 'ERROR') {
        if (this.activeReservation) {
          return { loading: this.loadAndPlayCurrentAsync(this.beginPreparation()) };
        } else {
          return this.advanceNextAsync(this.beginPreparation());
        }
      }
    });
  }

  pause(): void {
    if (this.state === 'LOADING') {
      this.pauseAfterLoad = true;
      this.audio.pause();
    } else if (this.state === 'PLAYING') {
      this.currentTimeMs = this.audio.getCurrentTimeMs();
      this.audio.pause();
      this.state = 'PAUSED';
      this.notifyState();
    }
  }

  stop(): Promise<void> {
    this.generation++;
    this.audio.stop();
    this.state = this.pendingQueue.length > 0 ? 'WAITING_FOR_PLAY' : 'IDLE';
    this.activeReservation = null;
    this.activeSong = null;
    this.currentTimeMs = 0;
    this.totalTimeMs = 0;
    this.lyricSync.setInstrumental(false);
    this.lyricSync.loadLyrics([]);
    this.notifyState();
    this.notifySong();

    return this.enqueueCommand(async () => {
      await QueueDao.stopQueue(true);
      await this.refreshQueueAfterCommitAsync();
      this.state = this.pendingQueue.length > 0 ? 'WAITING_FOR_PLAY' : 'IDLE';
      this.activeReservation = null;
      this.activeSong = null;
      this.currentTimeMs = 0;
      this.totalTimeMs = 0;
      this.lyricSync.setInstrumental(false);
      this.lyricSync.loadLyrics([]);
      this.notifyState();
      this.notifySong();
    });
  }

  next(): Promise<void> {
    this.audio.stop();
    const currentGen = this.beginPreparation();
    return this.enqueueLoadCommand(() => this.advanceNextAsync(currentGen));
  }

  async setKeyOffset(semitones: number): Promise<void> {
    const clamped = Math.max(-6, Math.min(6, semitones));
    this.keyOffset = clamped;
    this.audio.setKeyOffset(clamped);
    if (this.activeReservation) {
      await QueueDao.setKeyOffset(this.activeReservation.reservation_id, clamped);
    }
    this.notifyKey();
  }

  async setEffectsLevel(level: number): Promise<void> {
    if (!Number.isFinite(level)) throw new Error('Invalid vocal effects level');
    const clamped = Math.max(0, Math.min(3, Math.trunc(level)));
    await SettingsDao.setVocalEffectsLevel(clamped);
    this.audio.setEffectsLevel?.(clamped);
  }

  getEffectsLevel(): number {
    return this.audio.getEffectsLevel?.() ?? 2;
  }

  async setMasterGain(gain: number): Promise<void> {
    if (!Number.isFinite(gain)) throw new Error('Invalid music volume');
    const clamped = Math.max(0.0, Math.min(1.0, gain));
    await SettingsDao.setMusicVolume(clamped);
    this.audio.setMasterGain?.(clamped);
  }

  getMasterGain(): number {
    return this.audio.getMasterGain?.() ?? 1.0;
  }

  setBluetoothLyricOffset(offsetMs: number): void {
    const clamped = Math.max(-500, Math.min(500, Math.floor(offsetMs)));
    this.audio.setBluetoothLyricOffset?.(clamped);
  }

  getBluetoothLyricOffset(): number {
    return this.audio.getBluetoothLyricOffset?.() ?? 0;
  }

  isBluetoothActive(): boolean {
    return this.audio.isBluetoothActive?.() ?? false;
  }

  async removePending(reservationId: number): Promise<QueueItem | null> {
    const item = await QueueDao.removePending(reservationId);
    if (item) {
      this.pendingQueue = this.pendingQueue.filter(
        (q) => q.reservation_id !== reservationId
      );
      this.notifyQueue();
    }
    await this.refreshQueueAfterCommitAsync();
    return item;
  }

  async restorePending(item: QueueItem): Promise<void> {
    await QueueDao.restorePending(item);
    if (!this.pendingQueue.some((q) => q.reservation_id === item.reservation_id)) {
      this.pendingQueue = [...this.pendingQueue, item].sort(
        (a, b) => a.reservation_id - b.reservation_id
      );
      this.notifyQueue();
    }
    await this.refreshQueueAfterCommitAsync();
  }

  movePending(reservationId: number, direction: 'up' | 'down'): Promise<boolean> {
    return this.enqueueCommand(async () => {
      const idx = this.pendingQueue.findIndex((q) => q.reservation_id === reservationId);
      if (idx < 0) return false;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= this.pendingQueue.length) return false;

      const currentItem = this.pendingQueue[idx];
      const targetItem = this.pendingQueue[targetIdx];

      const swapped = await QueueDao.swapPendingOrder(currentItem.reservation_id, targetItem.reservation_id);
      if (swapped) {
        await this.refreshQueueAfterCommitAsync();
      }
      return swapped;
    });
  }

  handleSongEnded(): Promise<void> {
    if (this.state === 'PLAYING') {
      const reservationId = this.activeReservation?.reservation_id;
      return this.enqueueLoadCommand(async () => {
        if (this.state !== 'PLAYING' || this.activeReservation?.reservation_id !== reservationId) return;
        return this.advanceNextAsync(this.beginPreparation());
      });
    }
    return Promise.resolve();
  }

  private async advanceNextAsync(currentGen: number): Promise<{ loading?: Promise<void> } | void> {
    const nextItem = await QueueDao.advanceToNext();
    await this.refreshQueueAfterCommitAsync();
    if (this.generation !== currentGen) return;

    if (nextItem) {
      this.activeReservation = nextItem;
      this.keyOffset = nextItem.key_offset;
      this.activeSong = await SongDao.getByCode(nextItem.song_code);
      this.notifySong();
      this.notifyKey();
      return { loading: this.loadAndPlayCurrentAsync(currentGen) };
    } else {
      this.resetIdlePlayerState();
      this.state = 'IDLE';
      this.notifyState();
    }
  }

  private async loadAndPlayCurrentAsync(currentGen: number): Promise<void> {
    if (this.generation !== currentGen) return;
    if (!this.activeReservation) {
      this.state = 'IDLE';
      this.notifyState();
      return;
    }

    const reservationId = this.activeReservation.reservation_id;
    this.state = 'LOADING';
    this.notifyState();

    if (!this.audioReady) {
      if (this.soundFontPromise) {
        await this.soundFontPromise;
        if (this.generation !== currentGen) return;
      }
    }

    const song = this.activeSong || (await SongDao.getByCode(this.activeReservation.song_code));
    if (!song) {
      if (this.generation === currentGen) {
        this.state = 'ERROR';
        this.notifyState();
        for (const l of this.listeners) l.onError?.('Song not in catalog');
      }
      return;
    }

    if (this.generation !== currentGen) {
      return;
    }

    this.activeSong = song;
    if (this.activeReservation && (!this.activeReservation.title || !this.activeReservation.artist)) {
      this.activeReservation = {
        ...this.activeReservation,
        title: this.activeReservation.title || song.title,
        artist: this.activeReservation.artist || song.artist,
      };
    }
    this.notifySong();

    try {
      const packFdInfo = this.library.openPackFd();
      if (!packFdInfo || packFdInfo.fd < 0) throw new Error('Song pack is unavailable');

      const ok = await this.audio.prepareSong(
        packFdInfo.fd,
        packFdInfo.startOffset,
        packFdInfo.length,
        song.pack_offset,
        song.packed_size,
        song.unpacked_size,
        song.midi_sha256,
        reservationId,
        currentGen
      );

      // Rejection of stale completion
      if (this.generation !== currentGen) {
        this.library.closePackFd?.();
        return;
      }

      if (!ok) throw new Error('Failed to prepare audio: song pack may be damaged');
      this.library.closePackFd?.();
      const lyrics = await this.audio.getLyrics();
      await this.enqueueCommand(async () => {
        if (this.generation !== currentGen) return;
        const isInstrumental = !song.has_singable_lyrics || lyrics.length === 0;
        this.lyricSync.setInstrumental(isInstrumental);
        this.lyricSync.loadLyrics(lyrics);
        this.totalTimeMs = this.audio.getTotalTimeMs();
        this.currentTimeMs = 0;
        this.audio.setKeyOffset(this.keyOffset);
        if (this.pauseAfterLoad) {
          this.state = 'PAUSED';
        } else {
          this.audio.play();
          this.state = 'PLAYING';
        }
        this.notifyState();
      });
    } catch (err: any) {
      this.library.closePackFd?.();
      if (this.generation === currentGen) {
        this.state = 'ERROR';
        this.notifyState();
        for (const l of this.listeners) l.onError?.(err?.message || 'Preparation error');
      }
    }
  }
}
