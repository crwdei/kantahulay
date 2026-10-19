import { QueueItem, Song } from '../db/types';

export type PlaybackState =
  | 'IDLE'
  | 'LOADING'
  | 'PLAYING'
  | 'PAUSED'
  | 'WAITING_FOR_PLAY'
  | 'ERROR';

export interface EngineListener {
  onStateChange?(state: PlaybackState): void;
  onActiveSongChange?(song: Song | null, queueItem: QueueItem | null): void;
  onTimeUpdate?(currentTimeMs: number, totalTimeMs: number): void;
  onKeyChange?(keyOffset: number): void;
  onQueueChange?(pending: QueueItem[]): void;
  onQueueRefreshFailed?(): void;
  onError?(message: string): void;
}

export interface InitializationResult {
  audioReady: boolean;
  catalogReady: boolean;
  totalSongs: number | null;
  packFormatVersion: number | null;
}
