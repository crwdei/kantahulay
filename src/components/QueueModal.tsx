import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  useWindowDimensions,
  AccessibilityInfo,
  AppState,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { QueueItem, Song } from '../db/types';
import { t, SupportedLanguage } from '../i18n';
import { formatUserErrorMessage } from '../utils/errorMapper';
import { CloseIcon, MusicIcon, MicIcon, ChevronUpIcon, ChevronDownIcon } from './Icons';

interface QueueModalProps {
  visible: boolean;
  onClose: () => void;
  activeReservation: QueueItem | null;
  activeSong?: Song | null;
  pendingQueue: QueueItem[];
  onRemovePending: (reservationId: number) => Promise<QueueItem | null>;
  onRestorePending: (item: QueueItem) => Promise<void>;
  onMovePending?: (reservationId: number, direction: 'up' | 'down') => Promise<boolean>;
  language: SupportedLanguage;
  activeKeyOffset: number;
  queueNeedsRefresh?: boolean;
  onRetryQueue?: () => Promise<void>;
}

export const QueueModal: React.FC<QueueModalProps> = ({
  visible,
  onClose,
  activeReservation,
  activeSong,
  pendingQueue,
  onRemovePending,
  onRestorePending,
  onMovePending,
  language,
  activeKeyOffset,
  queueNeedsRefresh,
  onRetryQueue,
}) => {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const insets = useSafeAreaInsets();

  const [undoItem, setUndoItem] = useState<QueueItem | null>(null);
  const [undoRemainingMs, setUndoRemainingMs] = useState<number>(0);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const isMutatingRef = useRef<boolean>(false);
  const undoGenerationRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const remainingMsRef = useRef<number>(0);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startTimer = (initialMs: number, gen: number) => {
    clearTimer();
    remainingMsRef.current = initialMs;
    setUndoRemainingMs(initialMs);
    let lastTime = Date.now();

    timerRef.current = setInterval(() => {
      if (AppState.currentState !== 'active' || isRestoring) {
        lastTime = Date.now();
        return;
      }
      const now = Date.now();
      const elapsed = now - lastTime;
      lastTime = now;

      remainingMsRef.current = Math.max(0, remainingMsRef.current - elapsed);
      setUndoRemainingMs(remainingMsRef.current);

      if (remainingMsRef.current <= 0) {
        clearTimer();
        if (undoGenerationRef.current === gen) {
          setUndoItem(null);
          setRestoreError(null);
        }
      }
    }, 100);
  };

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, []);

  const handleRemove = async (item: QueueItem) => {
    if (isMutatingRef.current) return;
    isMutatingRef.current = true;
    try {
      const removed = await onRemovePending(item.reservation_id);
      if (!removed) return;

      setRestoreError(null);
      setUndoItem(removed);
      const gen = ++undoGenerationRef.current;

      let timeoutMs = 5000;
      try {
        timeoutMs = await AccessibilityInfo.getRecommendedTimeoutMillis(5000);
      } catch {
        timeoutMs = 5000;
      }
      startTimer(timeoutMs, gen);
    } finally {
      isMutatingRef.current = false;
    }
  };

  const handleUndo = async () => {
    if (isMutatingRef.current || isRestoring || !undoItem) return;
    isMutatingRef.current = true;
    setIsRestoring(true);
    clearTimer();

    try {
      await onRestorePending(undoItem);
      setUndoItem(null);
      setRestoreError(null);
    } catch (err: any) {
      setRestoreError(formatUserErrorMessage(err, t('restore_failed', language)));
    } finally {
      setIsRestoring(false);
      isMutatingRef.current = false;
    }
  };

  const handleDismissUndo = () => {
    clearTimer();
    setUndoItem(null);
    setRestoreError(null);
  };

  const handleMove = async (item: QueueItem, direction: 'up' | 'down') => {
    if (isMutatingRef.current || !onMovePending) return;
    isMutatingRef.current = true;
    try {
      await onMovePending(item.reservation_id, direction);
    } finally {
      isMutatingRef.current = false;
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent={true}
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.overlay,
          isLandscape && styles.overlayLandscape,
          {
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
        ]}
      >
        <SafeAreaView edges={[]} style={[styles.container, isLandscape && styles.containerLandscape]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.titleWrap}>
              <Text style={styles.title}>{t('queue', language)}</Text>
              <Text style={styles.badge}>
                {pendingQueue.length + (activeReservation ? 1 : 0)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={t('close', language)}
            >
              <CloseIcon size={24} color="#A0A0A0" />
            </TouchableOpacity>
          </View>

          {/* Stale Queue Warning Banner */}
          {queueNeedsRefresh && (
            <View style={styles.refreshBanner}>
              <Text style={styles.refreshBannerText}>{t('queue_needs_refresh', language)}</Text>
              {onRetryQueue && (
                <TouchableOpacity
                  style={styles.refreshBtn}
                  onPress={() => onRetryQueue()}
                  accessibilityRole="button"
                  accessibilityLabel={t('reload', language)}
                >
                  <Text style={styles.refreshBtnText}>{t('reload', language)}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Modal Body: Two-column in landscape, stacked in portrait */}
          <View style={[styles.contentBody, isLandscape && styles.contentBodyLandscape]}>
            {/* Active Song Section */}
            <View style={[styles.sectionWrap, isLandscape && styles.activeSectionLandscape]}>
              <Text style={styles.sectionHeader}>{t('now_playing', language)}</Text>
              {activeReservation ? (
                <View style={[styles.activeCard, isLandscape && styles.activeCardLandscape]}>
                  <View style={styles.activeIconWrap}>
                    <MicIcon size={22} color="#000" />
                  </View>
                  <View style={styles.songTextWrap}>
                    <Text style={styles.activeSongCode}>{activeReservation.song_code}</Text>
                    <Text style={styles.activeSongTitle} numberOfLines={1}>
                      {activeReservation.title || activeSong?.title || `Song #${activeReservation.song_code}`}
                    </Text>
                    <Text style={styles.activeSongArtist} numberOfLines={1}>
                      {activeReservation.artist || activeSong?.artist || 'Unknown Artist'}
                    </Text>
                  </View>
                  {activeKeyOffset !== 0 && (
                    <View style={styles.keyBadge}>
                      <Text style={styles.keyBadgeText}>
                        {activeKeyOffset > 0 ? `+${activeKeyOffset}` : activeKeyOffset}
                      </Text>
                    </View>
                  )}
                </View>
              ) : (
                <View style={[styles.emptyCard, isLandscape && styles.emptyCardLandscape]}>
                  <Text style={styles.emptyText}>{t('no_active_song', language)}</Text>
                </View>
              )}
            </View>

            {/* Pending Queue Section */}
            <View style={[styles.sectionWrap, { flex: 1 }, isLandscape && styles.pendingSectionLandscape]}>
              <Text style={styles.sectionHeader}>
                {t('pending_queue', language)} ({pendingQueue.length})
              </Text>
              {pendingQueue.length === 0 ? (
                <View style={[styles.emptyCard, { flex: 1, justifyContent: 'center' }]}>
                  <Text style={styles.emptyText}>{t('no_upcoming_songs', language)}</Text>
                </View>
              ) : (
                <FlatList
                  data={pendingQueue}
                  keyExtractor={(item) => String(item.reservation_id)}
                  renderItem={({ item, index }) => (
                    <View style={styles.pendingRow}>
                      <View style={styles.indexWrap}>
                        <Text style={styles.indexText}>{index + 1}</Text>
                      </View>
                      <View style={styles.songTextWrap}>
                        <Text style={styles.pendingTitle} numberOfLines={1}>
                          {item.title || `Song #${item.song_code}`}
                        </Text>
                        <Text style={styles.pendingArtist} numberOfLines={1}>
                          {item.artist ? `${item.artist} · ` : ''}{item.song_code}
                        </Text>
                      </View>
                      <View style={styles.reorderActions}>
                        <TouchableOpacity
                          style={[styles.moveBtn, index === 0 && styles.moveBtnDisabled]}
                          onPress={() => handleMove(item, 'up')}
                          disabled={index === 0}
                          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                          accessibilityRole="button"
                          accessibilityLabel={`Move up ${item.title || item.song_code}`}
                        >
                          <ChevronUpIcon size={14} color={index === 0 ? '#485268' : '#B3B8C6'} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.moveBtn, index === pendingQueue.length - 1 && styles.moveBtnDisabled]}
                          onPress={() => handleMove(item, 'down')}
                          disabled={index === pendingQueue.length - 1}
                          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                          accessibilityRole="button"
                          accessibilityLabel={`Move down ${item.title || item.song_code}`}
                        >
                          <ChevronDownIcon size={14} color={index === pendingQueue.length - 1 ? '#485268' : '#B3B8C6'} />
                        </TouchableOpacity>
                      </View>
                      <TouchableOpacity
                        style={styles.removeBtn}
                        onPress={() => handleRemove(item)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityRole="button"
                        accessibilityLabel={`${t('remove', language)} ${item.title || item.song_code}`}
                      >
                        <Text style={styles.removeBtnText}>{t('remove', language)}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                />
              )}
            </View>
          </View>

          {/* Undo / Restore Notification Banner */}
          {undoItem && (
            <View
              style={[styles.undoBanner, restoreError && styles.undoBannerError]}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              <View style={styles.undoTextWrap}>
                <Text style={styles.undoNotice} numberOfLines={1}>
                  {restoreError ? restoreError : `${t('song_removed', language)}: ${undoItem.title || undoItem.song_code}`}
                </Text>
                {!restoreError && (
                  <Text style={styles.undoTimer}>({Math.ceil(undoRemainingMs / 1000)}s)</Text>
                )}
              </View>
              <View style={styles.undoActions}>
                {restoreError ? (
                  <>
                    <TouchableOpacity
                      style={styles.undoRetryBtn}
                      onPress={handleUndo}
                      accessibilityRole="button"
                      accessibilityLabel={t('retry', language)}
                    >
                      <Text style={styles.undoRetryBtnText}>{t('retry', language)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.undoDismissBtn}
                      onPress={handleDismissUndo}
                      accessibilityRole="button"
                      accessibilityLabel={t('dismiss', language)}
                    >
                      <Text style={styles.undoDismissBtnText}>{t('dismiss', language)}</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity
                    style={styles.undoBtn}
                    onPress={handleUndo}
                    accessibilityRole="button"
                    accessibilityLabel={t('undo', language)}
                  >
                    <Text style={styles.undoBtnText}>{t('undo', language).toUpperCase()}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  overlayLandscape: {
    justifyContent: 'center',
  },
  container: {
    width: '100%',
    maxWidth: 500,
    height: '85%',
    maxHeight: '92%',
    backgroundColor: '#161A24',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    padding: 20,
    borderWidth: 1,
    borderColor: '#283248',
  },
  containerLandscape: {
    width: '88%',
    maxWidth: 700,
    height: '86%',
    maxHeight: '90%',
    padding: 14,
  },
  contentBody: {
    flex: 1,
  },
  contentBodyLandscape: {
    flexDirection: 'row',
    gap: 16,
    flex: 1,
  },
  activeSectionLandscape: {
    width: 260,
    marginBottom: 0,
  },
  activeCardLandscape: {
    padding: 10,
  },
  emptyCardLandscape: {
    padding: 16,
  },
  pendingSectionLandscape: {
    marginBottom: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  badge: {
    backgroundColor: '#20283A',
    color: '#FFD63D',
    fontSize: 14,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#283248',
  },
  closeBtn: {
    padding: 6,
    minWidth: 48,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionWrap: {
    marginBottom: 16,
  },
  sectionHeader: {
    color: '#B3B8C6',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  activeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFD63D',
    borderRadius: 10,
    padding: 12,
  },
  activeIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E6C200',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  songTextWrap: {
    flex: 1,
  },
  activeSongCode: {
    color: '#423700',
    fontSize: 11,
    fontWeight: '700',
  },
  activeSongTitle: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '800',
  },
  activeSongArtist: {
    color: '#2E2600',
    fontSize: 13,
  },
  keyBadge: {
    backgroundColor: '#000000',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  keyBadgeText: {
    color: '#FFD63D',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: '#1B2030',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#283248',
  },
  emptyText: {
    color: '#B3B8C6',
    fontSize: 13,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1B2030',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#283248',
  },
  indexWrap: {
    width: 24,
    alignItems: 'center',
    marginRight: 8,
  },
  indexText: {
    color: '#FFD63D',
    fontSize: 13,
    fontWeight: '700',
  },
  pendingTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  pendingArtist: {
    color: '#B3B8C6',
    fontSize: 12,
  },
  reorderActions: {
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
    gap: 2,
  },
  moveBtn: {
    width: 38,
    height: 24,
    minHeight: 24,
    backgroundColor: '#1B2030',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#283248',
    justifyContent: 'center',
    alignItems: 'center',
  },
  moveBtnDisabled: {
    opacity: 0.3,
    borderColor: '#1E2433',
  },
  removeBtn: {
    backgroundColor: '#20283A',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
    minHeight: 44,
    minWidth: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  removeBtnText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '700',
  },
  undoBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#20283A',
    borderWidth: 1,
    borderColor: '#FFD63D',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 8,
  },
  undoTextWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  undoNotice: {
    color: '#FFFFFF',
    fontSize: 13,
    flexShrink: 1,
  },
  undoTimer: {
    color: '#FFD63D',
    fontSize: 12,
    fontWeight: '700',
  },
  undoBtn: {
    backgroundColor: '#FFD63D',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  undoBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '800',
  },
  refreshBanner: {
    backgroundColor: 'rgba(255, 179, 0, 0.2)',
    borderColor: '#FFB300',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  refreshBannerText: {
    color: '#FFD54F',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  refreshBtn: {
    backgroundColor: '#FFB300',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    minHeight: 44,
    minWidth: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  refreshBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '700',
  },
  undoBannerError: {
    borderColor: '#FF5252',
    backgroundColor: 'rgba(255, 82, 82, 0.2)',
  },
  undoActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  undoRetryBtn: {
    backgroundColor: '#FFD600',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    minHeight: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  undoRetryBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
  },
  undoDismissBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    minHeight: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  undoDismissBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});
