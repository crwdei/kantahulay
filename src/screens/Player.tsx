import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  StatusBar,
  Modal,
  TextInput,
  FlatList,
  useWindowDimensions,
  Platform,
  Keyboard,
  LayoutAnimation,
  UIManager,
  Animated,
  Easing,
  BackHandler,
  Alert,
  AppState,
} from 'react-native';
import LibraryModule from '../../modules/kantahulay-library';
import AudioModule from '../../modules/kantahulay-audio';
import {
  PlayIcon,
  PauseIcon,
  StopIcon,
  NextIcon,
  PlusIcon,
  MinusIcon,
  SearchIcon,
  BookIcon,
  CloseIcon,
  MusicIcon,
  CheckIcon,
  SettingsIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RotateDeviceIcon,
} from '../components/Icons';
import { QueueModal } from '../components/QueueModal';
import { SettingsModal } from '../components/SettingsModal';
import { OnboardingModal } from '../components/OnboardingModal';
import { t, setLanguage, getLanguage, SupportedLanguage } from '../i18n';
import { PlaybackController } from '../engine/PlaybackController';
import { PlaybackState } from '../engine/types';
import { QueueItem, Song } from '../db/types';
import { SongDao } from '../db/songDao';
import { SettingsDao } from '../db/settingsDao';
import { formatUserErrorMessage } from '../utils/errorMapper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

if (Platform.OS === 'android' && UIManager?.setLayoutAnimationEnabledExperimental) {
  try {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  } catch (_e) {}
}

function formatTimeMs(ms: number): string {
  if (!ms || ms < 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

interface PlayerProps {
  controller?: PlaybackController;
  initialShowOnboarding?: boolean;
}

export const PlayerScreen: React.FC<PlayerProps> = ({
  controller: propController,
  initialShowOnboarding,
}) => {
  const [controller] = useState(() => propController || new PlaybackController());
  const [state, setState] = useState<PlaybackState>(controller.getState());
  const [activeSong, setActiveSong] = useState<Song | null>(controller.getActiveSong());
  const [activeReservation, setActiveReservation] = useState<QueueItem | null>(
    controller.getActiveReservation()
  );
  const [pendingQueue, setPendingQueue] = useState<QueueItem[]>(controller.getPendingQueue());
  const [keyOffset, setKeyOffset] = useState<number>(controller.getKeyOffset());
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const [playbackNotice, setPlaybackNotice] = useState<string | null>(null);
  const [songbookError, setSongbookError] = useState<string | null>(null);
  const feedbackTimerRef = useRef<NodeJS.Timeout | null>(null);
  const feedbackGenerationRef = useRef<number>(0);

  const [isSongbookOpen, setIsSongbookOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedQuery, setDebouncedQuery] = useState({ query: '' });
  const [songList, setSongList] = useState<Song[]>([]);
  const [isFallbackSearch, setIsFallbackSearch] = useState<boolean>(false);
  const [isLoadingSongs, setIsLoadingSongs] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [hasMoreSongs, setHasMoreSongs] = useState<boolean>(true);
  const searchGenRef = useRef<number>(0);
  const loadingMoreGenRef = useRef<number | null>(null);
  const currentQueryRef = useRef<string>('');

  const handleSearchChange = useCallback((query: string) => {
    if (query === currentQueryRef.current) return;
    currentQueryRef.current = query;
    ++searchGenRef.current; // Invalidate before debounce, not when next request starts.
    loadingMoreGenRef.current = null;
    setIsLoadingMore(false);
    setIsLoadingSongs(true);
    setSearchQuery(query);
  }, []);

  useEffect(() => () => {
    ++searchGenRef.current;
    loadingMoreGenRef.current = null;
  }, []);
  const actionInProgressRef = useRef<boolean>(false);
  const lastReserveTapRef = useRef<Record<string, number>>({});
  const transportPendingRef = useRef(0);
  const stopBusyRef = useRef(false);
  const lastNextTapRef = useRef(0);
  const [totalSongs, setTotalSongs] = useState<number>(0);
  const [isAudioReady, setIsAudioReady] = useState<boolean>(controller?.isAudioReady ? controller.isAudioReady() : true);
  const [isCatalogReady, setIsCatalogReady] = useState<boolean>(controller?.isCatalogReady ? controller.isCatalogReady() : false);
  const [catalogSyncTimedOut, setCatalogSyncTimedOut] = useState<boolean>(false);
  const [isSoundPreparing, setIsSoundPreparing] = useState<boolean>(controller?.isPreparingSound ? controller.isPreparingSound() : false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [reservedFeedback, setReservedFeedback] = useState<string | null>(null);
  const [isQueueOpen, setIsQueueOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isOnboardingVisible, setIsOnboardingVisible] = useState<boolean>(
    initialShowOnboarding ?? false
  );
  const [isTutorialMode, setIsTutorialMode] = useState<boolean>(false);
  const [isLandscapePanelExpanded, setIsLandscapePanelExpanded] = useState<boolean>(true);
  const [language, setLangState] = useState<SupportedLanguage>('en');
  const [theme, setTheme] = useState<string>('dark');

  const { width, height } = useWindowDimensions();
  const isPortrait = height > width;

  // Gentle 90-degree turn pulse every 3s (portrait to landscape hint)
  const phoneRotateAnim = useRef<Animated.Value | null>(null);
  if (!phoneRotateAnim.current) {
    phoneRotateAnim.current = new Animated.Value(0);
  }

  useEffect(() => {
    if (!isPortrait) return;

    const anim = phoneRotateAnim.current;
    if (!anim) return;

    anim.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.delay(2000),
        Animated.timing(anim, {
          toValue: 0,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.delay(1000),
      ])
    );
    loop.start();

    return () => {
      loop.stop();
    };
  }, [isPortrait]);

  const handleRotateToLandscape = useCallback(() => {
    try {
      LibraryModule.setScreenOrientation?.('landscape');
    } catch (_e) {}
  }, []);

  const handleToggleLandscapePanel = useCallback(() => {
    try {
      if (LayoutAnimation?.configureNext) {
        LayoutAnimation.configureNext({
          duration: 220,
          create: { type: LayoutAnimation.Types?.easeInEaseOut ?? 'easeInEaseOut', property: LayoutAnimation.Properties?.opacity ?? 'opacity' },
          update: { type: LayoutAnimation.Types?.easeInEaseOut ?? 'easeInEaseOut' },
          delete: { type: LayoutAnimation.Types?.easeInEaseOut ?? 'easeInEaseOut', property: LayoutAnimation.Properties?.opacity ?? 'opacity' },
        });
      }
    } catch (_e) {}
    setIsLandscapePanelExpanded((prev) => !prev);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery({ query: searchQuery });
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const PAGE_SIZE = 50;

  const loadSongs = useCallback(async (query: string = '') => {
    if (query !== currentQueryRef.current) return;
    const token = ++searchGenRef.current;
    loadingMoreGenRef.current = null;
    setIsLoadingMore(false);
    setIsLoadingSongs(true);
    setHasMoreSongs(true);
    setIsFallbackSearch(false);
    try {
      const { songs: results, isFallback } = await (SongDao.searchWithFallback
        ? SongDao.searchWithFallback(query, PAGE_SIZE, 0)
        : SongDao.search(query, PAGE_SIZE, 0).then((s) => ({ songs: s, isFallback: false })));
      if (searchGenRef.current !== token) return;
      setSongList(results);
      setIsFallbackSearch(isFallback);
      setHasMoreSongs(!isFallback && results.length >= PAGE_SIZE);
      const count = await SongDao.count();
      if (searchGenRef.current === token) {
        setTotalSongs(count);
      }
    } catch {
      if (searchGenRef.current === token) {
        setSongList([]);
        setIsFallbackSearch(false);
        setHasMoreSongs(false);
      }
    } finally {
      if (searchGenRef.current === token) {
        setIsLoadingSongs(false);
      }
    }
  }, []);

  const loadMoreSongs = useCallback(async () => {
    if (loadingMoreGenRef.current !== null || isLoadingMore || !hasMoreSongs || isLoadingSongs) return;
    const token = searchGenRef.current;
    const query = currentQueryRef.current;
    const offset = songList.length;

    loadingMoreGenRef.current = token;
    setIsLoadingMore(true);
    try {
      const nextBatch = await SongDao.search(query, PAGE_SIZE, offset);
      if (searchGenRef.current !== token) return;

      if (nextBatch.length === 0) {
        setHasMoreSongs(false);
      } else {
        setSongList((prev) => {
          const existingCodes = new Set(prev.map((s) => s.code));
          const filtered = nextBatch.filter((s) => !existingCodes.has(s.code));
          return [...prev, ...filtered];
        });
        if (nextBatch.length < PAGE_SIZE) {
          setHasMoreSongs(false);
        }
      }
    } catch {
      // Keep existing results on pagination error
    } finally {
      if (loadingMoreGenRef.current === token) {
        loadingMoreGenRef.current = null;
        setIsLoadingMore(false);
      }
    }
  }, [isLoadingMore, hasMoreSongs, isLoadingSongs, songList.length]);

  useEffect(() => {
    if (isSongbookOpen) {
      loadSongs(debouncedQuery.query);
    }
  }, [isSongbookOpen, debouncedQuery, loadSongs]);

  const handlePlaySong = async (song: Song) => {
    Keyboard.dismiss();
    if (actionInProgressRef.current || transportPendingRef.current > 0 || stopBusyRef.current) return;
    actionInProgressRef.current = true;
    try {
      setSongbookError(null);
      await controller.playNow(song.code);
      setIsSongbookOpen(false);
    } catch (e: any) {
      setSongbookError(e?.message || t('could_not_play', language));
    } finally {
      actionInProgressRef.current = false;
    }
  };

  const handleReserveSong = async (song: Song) => {
    Keyboard.dismiss();
    const now = Date.now();
    const lastTap = lastReserveTapRef.current[song.code] || 0;
    if (now - lastTap < 500) return;

    if (actionInProgressRef.current || transportPendingRef.current > 0 || stopBusyRef.current) return;
    actionInProgressRef.current = true;
    try {
      setSongbookError(null);
      await controller.reserve(song.code);
      lastReserveTapRef.current[song.code] = Date.now();
      const currentGen = ++feedbackGenerationRef.current;
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
      setReservedFeedback(`${song.title} ${t('reserved', language)}`);
      feedbackTimerRef.current = setTimeout(() => {
        if (feedbackGenerationRef.current === currentGen) {
          setReservedFeedback(null);
        }
      }, 2500);
    } catch (e: any) {
      delete lastReserveTapRef.current[song.code];
      setSongbookError(e?.message || t('could_not_reserve', language));
    } finally {
      actionInProgressRef.current = false;
    }
  };

  const runInitialization = () => {
    setStartupError(null);
    setCatalogSyncTimedOut(false);
    if (controller?.isPreparingSound) {
      setIsSoundPreparing(controller.isPreparingSound());
    }

    // B15: Fallback timeout (5 seconds) to prevent infinite "Syncing catalog..." hang
    const syncTimeoutId = setTimeout(() => {
      setCatalogSyncTimedOut(true);
    }, 5000);

    controller
      .initializeAsync()
      .then(async (initResult) => {
        clearTimeout(syncTimeoutId);
        if (initResult?.audioReady !== undefined) {
          setIsAudioReady(initResult.audioReady);
        }
        if (initResult?.catalogReady !== undefined) {
          setIsCatalogReady(initResult.catalogReady);
        }
        setIsSoundPreparing(false);
        if (initResult && initResult.audioReady === false && initResult.catalogReady === false) {
          setStartupError('Could not initialize audio engine and song catalog.');
        } else if (initResult && initResult.audioReady === false) {
          setStartupError('Could not initialize audio engine.');
        } else if (initResult && initResult.catalogReady === false && (initResult.totalSongs === null || initResult.totalSongs === 0)) {
          setStartupError('Song catalog is empty or missing.');
        }
        if (initResult && initResult.totalSongs !== null && initResult.totalSongs !== undefined) {
          setTotalSongs(initResult.totalSongs);
        } else {
          const count = await SongDao.count();
          setTotalSongs(count);
          if (count > 0) setIsCatalogReady(true);
        }
      })
      .catch((err: any) => {
        clearTimeout(syncTimeoutId);
        setIsAudioReady(false);
        setIsCatalogReady(false);
        setIsSoundPreparing(false);
        const friendly = formatUserErrorMessage(err, 'Initialization failed. Please check app files and retry.');
        setStartupError(friendly);
        setPlaybackNotice(friendly);
      });
  };

  useEffect(() => {
    const unsubscribe = controller.addListener({
      onStateChange: (s) => {
        setState(s);
        if (s === 'IDLE' || s === 'WAITING_FOR_PLAY') {
          setCurrentTimeMs(0);
        }
        if (s === 'PLAYING') {
          setPlaybackNotice(null);
        }
      },
      onActiveSongChange: (song, res) => {
        setActiveSong(song);
        setActiveReservation(res);
        if (!song && !res) {
          setCurrentTimeMs(0);
        }
      },
      onQueueChange: (q) => setPendingQueue(q),
      onKeyChange: (k) => setKeyOffset(k),
      onError: (msg) => setPlaybackNotice(formatUserErrorMessage(msg)),
    });

    runInitialization();

    SettingsDao.getLanguage()
      .then((_stored) => {
        // Enforce English-only interface per requirement
        setLanguage('en');
        setLangState('en');
      })
      .catch(() => {
        setLanguage('en');
        setLangState('en');
      });

    if (initialShowOnboarding === undefined) {
      SettingsDao.isOnboardingCompleted()
        .then((completed) => {
          if (!completed) {
            setIsOnboardingVisible(true);
          }
        })
        .catch(() => {});
    }

    return () => {
      unsubscribe();
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
    };
  }, [controller, initialShowOnboarding]);

  const handleOpenTutorial = useCallback(() => {
    setIsSettingsOpen(false);
    setIsTutorialMode(true);
    setIsOnboardingVisible(true);
  }, []);

  const handleCloseOnboarding = useCallback((_completed: boolean) => {
    setIsOnboardingVisible(false);
    setIsTutorialMode(false);
  }, []);

  useEffect(() => {
    if (state !== 'PLAYING') return;

    const interval = setInterval(() => {
      try {
        const ms = controller.getCurrentTimeMs();
        setCurrentTimeMs(ms);

        if (controller.isSongEnded()) {
          controller.handleSongEnded();
        }
      } catch (err: any) {
        setPlaybackNotice(err?.message || 'Playback ticker error');
      }
    }, 50);

    return () => clearInterval(interval);
  }, [state, controller]);

  // U01: Keep screen awake only while PLAYING or PAUSED on Player screen
  useEffect(() => {
    const shouldKeepAwake = state === 'PLAYING' || state === 'PAUSED';
    AudioModule.setKeepScreenOn?.(shouldKeepAwake);
    return () => {
      AudioModule.setKeepScreenOn?.(false);
    };
  }, [state]);

  // B19: Restore default orientation (UNSPECIFIED) when leaving player screen
  useEffect(() => {
    return () => {
      try {
        LibraryModule.setScreenOrientation?.('unspecified');
      } catch (_e) {}
    };
  }, []);

  // B05: Pause playback when app moves to background or screen locks; stay paused on return
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        if (state === 'PLAYING') {
          controller.pause();
        }
      }
    });
    return () => sub.remove();
  }, [state, controller]);

  // B09: Intercept hardware back button / gesture on Player screen
  useEffect(() => {
    const onBackPress = () => {
      if (isQueueOpen) {
        setIsQueueOpen(false);
        return true;
      }
      if (isSettingsOpen) {
        setIsSettingsOpen(false);
        return true;
      }
      if (isOnboardingVisible) {
        setIsOnboardingVisible(false);
        return true;
      }
      if (searchQuery.trim().length > 0) {
        handleSearchChange('');
        return true;
      }

      if (state === 'PLAYING' || state === 'PAUSED') {
        Alert.alert(
          'Stop song and leave?',
          'Do you want to stop playback and exit?',
          [
            { text: 'Cancel', style: 'cancel', onPress: () => {} },
            {
              text: 'Stop & Exit',
              style: 'destructive',
              onPress: () => {
                controller.stop();
                BackHandler.exitApp();
              },
            },
          ]
        );
        return true;
      }

      return false;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [state, isQueueOpen, isSettingsOpen, isOnboardingVisible, searchQuery, controller]);

  let lyricWindow;
  try {
    lyricWindow = controller.getLyricSync().getDisplayWindow(currentTimeMs);
  } catch (err: any) {
    lyricWindow = {
      line1Words: [],
      line2Words: [],
      line1Text: '',
      line2Text: '',
      activeLine: 1,
      activeRatio: 0,
      countdownDots: 0,
    };
    if (!playbackNotice) {
      setPlaybackNotice(err?.message || 'Lyric sync error');
    }
  }

  const handlePlayPause = async () => {
    if (stopBusyRef.current) return;
    const currentState = controller.getState();
    if (currentState === 'PLAYING' || currentState === 'LOADING') {
      await controller.pause();
      return;
    }
    if (actionInProgressRef.current || transportPendingRef.current > 0) return;
    ++transportPendingRef.current;
    try {
      await controller.play();
    } finally {
      --transportPendingRef.current;
    }
  };

  const handleStop = async () => {
    if (stopBusyRef.current) return;
    if (controller.getState() === 'IDLE' && !activeSong) return;

    const performStop = async () => {
      stopBusyRef.current = true;
      setCurrentTimeMs(0);
      try {
        await controller.stop();
      } finally {
        stopBusyRef.current = false;
      }
    };

    const currentState = controller.getState();
    const currentPosition = controller.getCurrentTimeMs?.() ?? currentTimeMs;
    if ((currentState === 'PLAYING' || currentState === 'PAUSED') && currentPosition > 10000) {
      Alert.alert(
        'Stop song?',
        'Do you want to stop the current song?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Stop', style: 'destructive', onPress: performStop },
        ]
      );
      return;
    }

    await performStop();
  };

  const handleNext = async () => {
    if (stopBusyRef.current) return;
    const currentState = controller.getState();
    // Load promises include native preparation; cancellation must not wait for them.
    if (currentState !== 'LOADING' && (actionInProgressRef.current || transportPendingRef.current > 0)) return;
    if (currentState === 'IDLE' && !activeSong && pendingQueue.length === 0) return;
    const now = Date.now();
    if (now - lastNextTapRef.current < 500) return;
    lastNextTapRef.current = now;
    ++transportPendingRef.current;
    try {
      await controller.next();
    } finally {
      --transportPendingRef.current;
    }
  };

  const handleKeyDec = () => {
    controller.setKeyOffset(keyOffset - 1);
  };

  const handleKeyInc = () => {
    controller.setKeyOffset(keyOffset + 1);
  };

  const renderStatusBadge = () => {
    let color = '#888888';
    let label: string = state;
    if (state === 'PLAYING') color = '#00E676';
    if (state === 'LOADING') color = '#FFD600';
    if (state === 'PAUSED') color = '#29B6F6';
    if (state === 'ERROR') color = '#FF1744';
    if (state === 'WAITING_FOR_PLAY') {
      color = '#FFB300';
      label = 'READY';
    }

    return (
      <View style={[styles.badge, { borderColor: color }]}>
        <Text style={[styles.badgeText, { color }]} numberOfLines={1} maxFontSizeMultiplier={1.15}>{label}</Text>
      </View>
    );
  };

  const insets = useSafeAreaInsets();

  const displayCode = activeSong?.code || activeReservation?.song_code;
  const displayTitle = activeSong?.title || activeReservation?.title || (displayCode ? `Song #${displayCode}` : 'Tap to Select Song');
  const displayArtist = activeSong?.artist || activeReservation?.artist || '';
  const totalTimeMs = (activeSong || activeReservation) ? (controller.getTotalTimeMs?.() ?? 0) : 0;
  const progressPct = totalTimeMs > 0 ? Math.min(100, Math.max(0, (currentTimeMs / totalTimeMs) * 100)) : 0;
  const isIdleEmpty = (state === 'IDLE' || (state === 'WAITING_FOR_PLAY' && pendingQueue.length === 0)) && !activeSong && !activeReservation;

  const dynamicSafeArea = {
    paddingTop: insets?.top ?? 0,
    paddingBottom: insets?.bottom ?? 0,
    paddingLeft: insets?.left ?? 0,
    paddingRight: insets?.right ?? 0,
  };

  const dynamicModalInsets = {
    paddingTop: insets?.top ?? 0,
    paddingBottom: Math.max(insets?.bottom ?? 0, 8),
    paddingLeft: insets?.left ?? 0,
    paddingRight: insets?.right ?? 0,
  };

  return (
    <SafeAreaView edges={[]} style={[styles.safeArea, dynamicSafeArea]}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0D12" hidden />
      <View style={[styles.stage, isPortrait ? styles.stagePortrait : styles.stageLandscape]}>
        {isPortrait ? (
          <>
            {/* Top Header Bar */}
            <View style={styles.topBarPortrait}>
              {/* Header: Brand on left, Status Badge on right */}
              <View style={styles.headerBrandRow}>
                <View style={styles.brandGroupPortrait}>
                  <MusicIcon size={18} color="#FFD600" style={{ marginRight: 6 }} />
                  <Text style={styles.brandTitlePortrait}>KANTAHULAY</Text>
                </View>
                <View style={styles.badgeRow}>
                  {renderStatusBadge()}
                </View>
              </View>

              {/* Action Buttons Row */}
              <View style={styles.headerActionsRow}>
                <TouchableOpacity
                  style={styles.songbookBtnPortrait}
                  onPress={() => setIsSongbookOpen(true)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={t('songbook', language)}
                >
                  <BookIcon size={14} color="#000000" style={{ marginRight: 6 }} />
                  <Text style={styles.songbookBtnText} numberOfLines={1}>
                    {t('songbook', language).toUpperCase()}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.queueBtnPortrait}
                  onPress={() => setIsQueueOpen(true)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('queue', language)}, ${pendingQueue.length + (activeReservation ? 1 : 0)} items`}
                >
                  <Text style={styles.queueBadgeText}>
                    {t('queue', language)} ({pendingQueue.length + (activeReservation ? 1 : 0)})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.iconBtnPortrait}
                  onPress={() => setIsSettingsOpen(true)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings', language)}
                >
                  <SettingsIcon size={16} color="#B3B8C6" />
                </TouchableOpacity>
              </View>

              {/* Now Playing Banner */}
              <TouchableOpacity
                style={styles.portraitNowPlayingBanner}
                onPress={() => setIsSongbookOpen(true)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={displayCode ? `Song #${displayCode}: ${displayTitle}${displayArtist ? ` by ${displayArtist}` : ''}` : 'Select Song'}
              >
                <View style={styles.nowPlayingTopRow}>
                  <Text style={styles.nowPlayingCodeBadge}>
                    {displayCode ? `[${displayCode}]` : '[------]'}
                  </Text>
                  {totalTimeMs > 0 ? (
                    <Text style={styles.nowPlayingTimeText}>
                      {formatTimeMs(currentTimeMs)} / {formatTimeMs(totalTimeMs)}
                    </Text>
                  ) : state === 'PLAYING' ? (
                    <Text style={styles.nowPlayingHintText}>
                      {t('now_playing', language)}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.nowPlayingTitleText} numberOfLines={1}>
                  {displayTitle}
                </Text>
                {displayArtist ? (
                  <Text style={styles.nowPlayingArtistText} numberOfLines={1}>
                    {displayArtist}
                  </Text>
                ) : null}
                {pendingQueue.length > 0 && (
                  <Text style={styles.upNextBannerText} numberOfLines={1}>
                    Up next: {pendingQueue[0].title || `Song #${pendingQueue[0].song_code}`}
                  </Text>
                )}
                {totalTimeMs > 0 && (
                  <View style={styles.progressBarTrackPortrait}>
                    <View style={[styles.progressBarFillPortrait, { width: `${progressPct}%` }]} />
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* Center Stage: 2-Line Lyric Screen */}
            <View style={[styles.lyricScreen, styles.lyricScreenPortrait, isIdleEmpty && styles.lyricScreenPortraitIdle]}>
              {playbackNotice && (
                <View style={styles.noticeBanner}>
                  <Text style={styles.noticeBannerText}>Notice: {playbackNotice}</Text>
                  <TouchableOpacity
                    onPress={() => setPlaybackNotice(null)}
                    style={styles.noticeDismissBtn}
                    accessibilityRole="button"
                    accessibilityLabel={t('dismiss', language)}
                  >
                    <Text style={styles.noticeDismissText}>{t('dismiss', language)}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {isIdleEmpty ? (
                <View style={styles.idleSplash}>
                  <Text style={styles.idleTitle}>KANTAHULAY</Text>
                  {startupError ? (
                    <View style={styles.startupErrorCard}>
                      <Text style={styles.startupErrorText}>{startupError}</Text>
                      <TouchableOpacity
                        style={styles.retryBtn}
                        onPress={runInitialization}
                        accessibilityRole="button"
                        accessibilityLabel="Retry initialization"
                      >
                        <Text style={styles.retryBtnText}>Retry</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <Text style={styles.idleSubtitle}>
                      {isSoundPreparing ? 'Preparing sound…' : 'Pick a song to begin'}
                    </Text>
                  )}
                </View>
              ) : (
                <>
                  {state === 'WAITING_FOR_PLAY' && (
                    <View style={styles.readyPromptCard}>
                      <TouchableOpacity
                        style={styles.bigPlayActionBtn}
                        onPress={handlePlayPause}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel={t('play', language)}
                      >
                        <PlayIcon size={20} color="#000000" style={{ marginRight: 6 }} />
                        <Text style={styles.bigPlayActionText}>
                          {t('play', language).toUpperCase()}
                        </Text>
                      </TouchableOpacity>

                      {pendingQueue.length > 0 ? (
                        <View style={styles.queuePreviewSection}>
                          <Text style={styles.queuePreviewHeader}>
                            {t('pending_queue', language).toUpperCase()} ({pendingQueue.length})
                          </Text>
                          {pendingQueue.slice(0, 3).map((item, idx) => (
                            <View key={item.reservation_id || idx} style={styles.queuePreviewRow}>
                              <Text style={styles.queuePreviewIdx}>{idx + 1}</Text>
                              <Text style={styles.queuePreviewTitle} numberOfLines={1}>
                                {item.title || `Song #${item.song_code}`}
                              </Text>
                              <Text style={styles.queuePreviewCode}>[{item.song_code}]</Text>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.readyPromptSub}>{t('waiting_play', language)}</Text>
                      )}
                    </View>
                  )}

                  {lyricWindow.countdownDots > 0 && (
                    <View style={styles.countdownContainer}>
                      {[1, 2, 3, 4].map((dotIdx) => {
                        const isLit = dotIdx <= lyricWindow.countdownDots;
                        return (
                          <View
                            key={dotIdx}
                            style={[
                              styles.countdownDot,
                              isLit ? styles.countdownDotLit : styles.countdownDotUnlit,
                            ]}
                          />
                        );
                      })}
                    </View>
                  )}

                  <Text style={[styles.lyricLine, styles.lyricLinePortrait]} numberOfLines={2}>
                    {lyricWindow.line1Words && lyricWindow.line1Words.length > 0 ? (
                      lyricWindow.line1Words.map((word, wIdx) => (
                        <Text key={wIdx}>
                          {word.syllables.map((syl, sIdx) => {
                            const isSung = lyricWindow.activeLine === 1 && currentTimeMs >= syl.timeMs;
                            return (
                              <Text
                                key={sIdx}
                                style={
                                  lyricWindow.activeLine === 1
                                    ? isSung
                                      ? styles.syllableSung
                                      : styles.syllableActive
                                    : styles.syllableUpcoming
                                }
                              >
                                {syl.text}
                              </Text>
                            );
                          })}
                        </Text>
                      ))
                    ) : (
                      <Text
                        style={lyricWindow.activeLine === 1 ? styles.lyricActive : styles.lyricUpcoming}
                      >
                        {(!activeSong || (state !== 'PLAYING' && state !== 'PAUSED')) && lyricWindow.line1Text === 'KANTAHULAY' ? '' : lyricWindow.line1Text}
                      </Text>
                    )}
                  </Text>
                  <Text style={[styles.lyricLine, styles.lyricLinePortrait]} numberOfLines={2}>
                    {lyricWindow.line2Words && lyricWindow.line2Words.length > 0 ? (
                      lyricWindow.line2Words.map((word, wIdx) => (
                        <Text key={wIdx}>
                          {word.syllables.map((syl, sIdx) => {
                            const isSung = lyricWindow.activeLine === 2 && currentTimeMs >= syl.timeMs;
                            return (
                              <Text
                                key={sIdx}
                                style={
                                  lyricWindow.activeLine === 2
                                    ? isSung
                                      ? styles.syllableSung
                                      : styles.syllableActive
                                    : styles.syllableUpcoming
                                }
                              >
                                {syl.text}
                              </Text>
                            );
                          })}
                        </Text>
                      ))
                    ) : (
                      <Text
                        style={lyricWindow.activeLine === 2 ? styles.lyricActive : styles.lyricUpcoming}
                      >
                        {lyricWindow.line2Text}
                      </Text>
                    )}
                  </Text>
                </>
              )}
            </View>

            {/* Rotate to Landscape Floating Button (Portrait only, animated phone-turn icon, tap to rotate) */}
            {isPortrait && !isOnboardingVisible && (
              <View style={styles.rotateFloatingWrapper} pointerEvents="box-none">
                <TouchableOpacity
                  style={styles.rotateFloatingBtn}
                  onPress={handleRotateToLandscape}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Rotate to landscape"
                >
                  <Animated.View
                    style={{
                      transform: [
                        {
                          rotate: phoneRotateAnim.current
                            ? phoneRotateAnim.current.interpolate({
                                inputRange: [0, 1],
                                outputRange: ['0deg', '90deg'],
                              })
                            : '0deg',
                        },
                      ],
                    }}
                  >
                    <RotateDeviceIcon size={28} color="#FFD600" />
                  </Animated.View>
                </TouchableOpacity>
              </View>
            )}

            {/* Bottom Hardware Control Dock */}
            <View style={styles.controlDockPortrait}>
              {/* Key Transpose Row */}
              <View style={styles.keySectionPortrait}>
                <TouchableOpacity
                  style={[styles.controlBtn, styles.flexBtn]}
                  onPress={handleKeyDec}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Decrease Key"
                >
                  <MinusIcon size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.btnLabel}>KEY -</Text>
                </TouchableOpacity>

                <View style={styles.keyDisplay}>
                  <Text style={styles.keyText}>
                    {keyOffset > 0 ? `+${keyOffset}` : keyOffset}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.controlBtn, styles.flexBtn]}
                  onPress={handleKeyInc}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Increase Key"
                >
                  <PlusIcon size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.btnLabel}>KEY +</Text>
                </TouchableOpacity>
              </View>

              {/* Transport Controls Row */}
              <View style={styles.transportSectionPortrait}>
                <TouchableOpacity
                  style={[styles.controlBtn, styles.stopBtn, styles.flexBtn]}
                  onPress={handleStop}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={t('stop', language)}
                >
                  <StopIcon size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.btnLabel}>STOP</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.controlBtn, styles.playBtn, { flex: 1.5 }]}
                  onPress={handlePlayPause}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={(state === 'PLAYING' || state === 'LOADING') ? t('pause', language) : t('play', language)}
                >
                  {(state === 'PLAYING' || state === 'LOADING') ? (
                    <PauseIcon size={18} color="#000000" style={{ marginRight: 6 }} />
                  ) : (
                    <PlayIcon size={18} color="#000000" style={{ marginRight: 6 }} />
                  )}
                  <Text style={styles.playBtnText}>
                    {(state === 'PLAYING' || state === 'LOADING') ? 'PAUSE' : 'PLAY'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.controlBtn, styles.nextBtn, styles.flexBtn]}
                  onPress={handleNext}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={t('next', language)}
                >
                  <NextIcon size={16} color="#000000" style={{ marginRight: 6 }} />
                  <Text style={styles.nextBtnText}>NEXT</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        ) : (
          /* Landscape Dedicated Responsive Layout: 2 Columns */
          <View style={styles.landscapeStageContainer}>
            {/* Left Column: Lyrics Stage */}
            <View
              style={[
                styles.landscapeLyricsColumn,
                !isLandscapePanelExpanded && styles.landscapeLyricsColumnFullscreen,
              ]}
            >
              {playbackNotice && (
                <View style={styles.noticeBannerLandscape}>
                  <Text style={styles.noticeBannerText}>Notice: {playbackNotice}</Text>
                  <TouchableOpacity
                    onPress={() => setPlaybackNotice(null)}
                    style={styles.noticeDismissBtn}
                    accessibilityRole="button"
                    accessibilityLabel={t('dismiss', language)}
                  >
                    <Text style={styles.noticeDismissText}>{t('dismiss', language)}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {isIdleEmpty ? (
                <View style={styles.idleSplashLandscape}>
                  <Text style={styles.idleTitleLandscape}>KANTAHULAY</Text>
                  {startupError ? (
                    <View style={styles.startupErrorCard}>
                      <Text style={styles.startupErrorText}>{startupError}</Text>
                      <TouchableOpacity
                        style={styles.retryBtn}
                        onPress={runInitialization}
                        accessibilityRole="button"
                        accessibilityLabel="Retry initialization"
                      >
                        <Text style={styles.retryBtnText}>Retry</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <Text style={styles.idleSubtitle}>
                      {isSoundPreparing ? 'Preparing sound…' : 'Pick a song to begin'}
                    </Text>
                  )}
                </View>
              ) : (
                <View style={styles.lyricScreenLandscape}>
                  {lyricWindow.countdownDots > 0 && (
                    <View style={styles.countdownContainer}>
                      {[1, 2, 3, 4].map((dotIdx) => {
                        const isLit = dotIdx <= lyricWindow.countdownDots;
                        return (
                          <View
                            key={dotIdx}
                            style={[
                              styles.countdownDot,
                              isLit ? styles.countdownDotLit : styles.countdownDotUnlit,
                            ]}
                          />
                        );
                      })}
                    </View>
                  )}

                  <Text style={styles.lyricLineLandscape} numberOfLines={2}>
                    {lyricWindow.line1Words && lyricWindow.line1Words.length > 0 ? (
                      lyricWindow.line1Words.map((word, wIdx) => (
                        <Text key={wIdx}>
                          {word.syllables.map((syl, sIdx) => {
                            const isSung = lyricWindow.activeLine === 1 && currentTimeMs >= syl.timeMs;
                            return (
                              <Text
                                key={sIdx}
                                style={
                                  lyricWindow.activeLine === 1
                                    ? isSung
                                      ? styles.syllableSung
                                      : styles.syllableActive
                                    : styles.syllableUpcoming
                                }
                              >
                                {syl.text}
                              </Text>
                            );
                          })}
                        </Text>
                      ))
                    ) : (
                      <Text
                        style={lyricWindow.activeLine === 1 ? styles.lyricActive : styles.lyricUpcoming}
                      >
                        {(!activeSong || (state !== 'PLAYING' && state !== 'PAUSED')) && lyricWindow.line1Text === 'KANTAHULAY' ? '' : lyricWindow.line1Text}
                      </Text>
                    )}
                  </Text>
                  <Text style={styles.lyricLineLandscape} numberOfLines={2}>
                    {lyricWindow.line2Words && lyricWindow.line2Words.length > 0 ? (
                      lyricWindow.line2Words.map((word, wIdx) => (
                        <Text key={wIdx}>
                          {word.syllables.map((syl, sIdx) => {
                            const isSung = lyricWindow.activeLine === 2 && currentTimeMs >= syl.timeMs;
                            return (
                              <Text
                                key={sIdx}
                                style={
                                  lyricWindow.activeLine === 2
                                    ? isSung
                                      ? styles.syllableSung
                                      : styles.syllableActive
                                    : styles.syllableUpcoming
                                }
                              >
                                {syl.text}
                              </Text>
                            );
                          })}
                        </Text>
                      ))
                    ) : (
                      <Text
                        style={lyricWindow.activeLine === 2 ? styles.lyricActive : styles.lyricUpcoming}
                      >
                        {lyricWindow.line2Text}
                      </Text>
                    )}
                  </Text>
                </View>
              )}

              {/* Single Chevron-Left button at far right edge in collapsed state */}
              {!isLandscapePanelExpanded && (
                <TouchableOpacity
                  style={[
                    styles.collapseToggleBtnCollapsed,
                    { right: Math.max(insets.right + 8, 16) },
                  ]}
                  onPress={handleToggleLandscapePanel}
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel="Show controls"
                >
                  <ChevronLeftIcon size={18} color="#FFFFFF" />
                </TouchableOpacity>
              )}
            </View>

            {/* Right Column (approx 32-35%): Collapsible Control Panel */}
            {isLandscapePanelExpanded && (
              <View style={styles.landscapeSidebarColumn}>
                {/* Single Chevron-Right button at left edge in expanded state */}
                <TouchableOpacity
                  style={styles.collapseToggleBtnExpanded}
                  onPress={handleToggleLandscapePanel}
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel="Hide controls"
                >
                  <ChevronRightIcon size={18} color="#FFFFFF" />
                </TouchableOpacity>

                {/* Brand & Status Header */}
                <View style={styles.landscapeSidebarHeader}>
                  <View style={styles.brandGroup}>
                    <MusicIcon size={14} color="#FFD600" style={{ marginRight: 5 }} />
                    <Text style={styles.brandTitleLandscape} numberOfLines={1} maxFontSizeMultiplier={1.2}>KANTAHULAY</Text>
                  </View>
                  {renderStatusBadge()}
                </View>

                {/* Navigation Action Buttons */}
                <View style={styles.landscapeNavRow}>
                  <TouchableOpacity
                    style={styles.landscapeSongbookBtn}
                    onPress={() => setIsSongbookOpen(true)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={t('songbook', language)}
                  >
                    <BookIcon size={12} color="#000000" style={{ marginRight: 4 }} />
                    <Text style={styles.songbookBtnText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                      {t('songbook', language).toUpperCase()}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.landscapeQueueBtn}
                    onPress={() => setIsQueueOpen(true)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('queue', language)}, ${pendingQueue.length + (activeReservation ? 1 : 0)} items`}
                  >
                    <Text style={styles.queueBadgeText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                      {t('queue', language).toUpperCase()} ({pendingQueue.length + (activeReservation ? 1 : 0)})
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.landscapeSettingsBtn}
                    onPress={() => setIsSettingsOpen(true)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings', language)}
                  >
                    <SettingsIcon size={16} color="#B3B8C6" />
                  </TouchableOpacity>
                </View>

                {/* Compact Now Playing Card */}
                <TouchableOpacity
                  style={styles.landscapeNowPlayingCard}
                  onPress={() => setIsSongbookOpen(true)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={displayCode ? `Song #${displayCode}: ${displayTitle}${displayArtist ? ` by ${displayArtist}` : ''}` : 'Select Song'}
                >
                  <View style={styles.nowPlayingTopRow}>
                    <Text style={styles.nowPlayingCodeBadge} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                      {displayCode ? `[${displayCode}]` : '[------]'}
                    </Text>
                    {totalTimeMs > 0 ? (
                      <Text style={styles.nowPlayingTimeText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                        {formatTimeMs(currentTimeMs)} / {formatTimeMs(totalTimeMs)}
                      </Text>
                    ) : state === 'PLAYING' ? (
                      <Text style={styles.nowPlayingHintText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                        {t('now_playing', language)}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.nowPlayingTitleTextLandscape} numberOfLines={2} maxFontSizeMultiplier={1.25}>
                    {displayTitle}
                  </Text>
                  {displayArtist ? (
                    <Text style={styles.nowPlayingArtistText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                      {displayArtist}
                    </Text>
                  ) : null}
                  {pendingQueue.length > 0 && (
                    <Text style={styles.upNextBannerText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                      Up next: {pendingQueue[0].title || `Song #${pendingQueue[0].song_code}`}
                    </Text>
                  )}
                  {totalTimeMs > 0 && (
                    <View style={styles.progressBarTrackPortrait}>
                      <View style={[styles.progressBarFillPortrait, { width: `${progressPct}%` }]} />
                    </View>
                  )}
                </TouchableOpacity>

                {/* Key Transpose Row */}
                <View style={styles.landscapeKeyRow}>
                  <TouchableOpacity
                    style={[styles.controlBtn, styles.controlBtnLandscape, styles.flexBtn]}
                    onPress={handleKeyDec}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Decrease Key"
                  >
                    <MinusIcon size={12} color="#FFFFFF" style={{ marginRight: 3 }} />
                    <Text style={styles.btnLabel} numberOfLines={1} maxFontSizeMultiplier={1.2}>KEY -</Text>
                  </TouchableOpacity>

                  <View style={styles.keyDisplayLandscape}>
                    <Text style={styles.keyTextLandscape} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                      {keyOffset > 0 ? `+${keyOffset}` : keyOffset}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[styles.controlBtn, styles.controlBtnLandscape, styles.flexBtn]}
                    onPress={handleKeyInc}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Increase Key"
                  >
                    <PlusIcon size={12} color="#FFFFFF" style={{ marginRight: 3 }} />
                    <Text style={styles.btnLabel} numberOfLines={1} maxFontSizeMultiplier={1.2}>KEY +</Text>
                  </TouchableOpacity>
                </View>

                {/* Transport Controls Row: STOP | PLAY/PAUSE | NEXT */}
                <View style={styles.landscapeTransportRow}>
                  <TouchableOpacity
                    style={[styles.controlBtn, styles.controlBtnLandscape, styles.stopBtn, styles.flexBtn]}
                    onPress={handleStop}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={t('stop', language)}
                  >
                    <StopIcon size={11} color="#FFFFFF" style={{ marginRight: 3 }} />
                    <Text style={styles.btnLabel} numberOfLines={1} maxFontSizeMultiplier={1.2}>STOP</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.controlBtn, styles.controlBtnLandscape, styles.playBtn, { flex: 1.35 }]}
                    onPress={handlePlayPause}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={(state === 'PLAYING' || state === 'LOADING') ? t('pause', language) : t('play', language)}
                  >
                    {(state === 'PLAYING' || state === 'LOADING') ? (
                      <PauseIcon size={14} color="#000000" style={{ marginRight: 4 }} />
                    ) : (
                      <PlayIcon size={14} color="#000000" style={{ marginRight: 4 }} />
                    )}
                    <Text style={styles.playBtnText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                      {(state === 'PLAYING' || state === 'LOADING') ? 'PAUSE' : 'PLAY'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.controlBtn, styles.controlBtnLandscape, styles.nextBtn, styles.flexBtn]}
                    onPress={handleNext}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={t('next', language)}
                  >
                    <NextIcon size={11} color="#000000" style={{ marginRight: 3 }} />
                    <Text style={[styles.nextBtnText, styles.nextBtnTextLandscape]} numberOfLines={1} maxFontSizeMultiplier={1.2}>NEXT</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Songbook / Catalog Modal */}
      <Modal
        visible={isSongbookOpen}
        animationType="slide"
        transparent={false}
        statusBarTranslucent={true}
        onRequestClose={() => setIsSongbookOpen(false)}
      >
        <SafeAreaView edges={[]} style={styles.modalContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#161A24" translucent={true} />
          <View
            style={[
              styles.modalHeader,
              {
                paddingTop: (insets?.top ?? 0) + (isPortrait ? 8 : 4),
                paddingLeft: Math.max(insets?.left ?? 0, isPortrait ? 12 : 18),
                paddingRight: Math.max(insets?.right ?? 0, isPortrait ? 12 : 18),
              },
            ]}
          >
            <View style={styles.modalTitleRow}>
              <View style={styles.modalTitleWrap}>
                <BookIcon size={18} color="#FFD600" style={{ marginRight: 6 }} />
                <Text style={styles.modalTitle} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                  SONGBOOK
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => {
                  setIsSongbookOpen(false);
                  setSongbookError(null);
                }}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={t('close', language)}
              >
                <CloseIcon size={14} color="#ffffff" style={{ marginRight: 4 }} />
                <Text style={styles.closeBtnText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                  CLOSE
                </Text>
              </TouchableOpacity>
            </View>

            {songbookError && (
              <View style={styles.modalNoticeBanner}>
                <Text style={styles.modalNoticeText}>{songbookError}</Text>
                <TouchableOpacity
                  onPress={() => setSongbookError(null)}
                  style={styles.modalNoticeDismiss}
                  accessibilityRole="button"
                  accessibilityLabel={t('dismiss', language)}
                >
                  <Text style={styles.modalNoticeDismissText}>{t('dismiss', language)}</Text>
                </TouchableOpacity>
              </View>
            )}

            {reservedFeedback && (
              <View
                style={styles.feedbackBanner}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
              >
                <CheckIcon size={14} color="#000" />
                <Text style={styles.feedbackText}>{reservedFeedback}</Text>
              </View>
            )}

            {/* Search Input */}
            <View style={styles.searchContainer}>
              <SearchIcon size={18} color="#A0A0A0" style={{ marginRight: 8 }} />
              <TextInput
                style={styles.searchInputInner}
                placeholder={t('search_placeholder', language)}
                placeholderTextColor="#A0A0A0"
                value={searchQuery}
                onChangeText={handleSearchChange}
                autoCorrect={false}
                accessibilityLabel={t('search_placeholder', language)}
              />
            </View>
          </View>

          {/* Results List */}
          {isFallbackSearch && songList.length > 0 && (
            <View style={styles.didYouMeanContainer}>
              <Text style={styles.didYouMeanText} numberOfLines={1}>
                {t('did_you_mean', language)}
              </Text>
            </View>
          )}
          <FlatList
            data={songList}
            keyExtractor={(item) => item.code}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={10}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={{
              paddingBottom: Math.max(insets?.bottom ?? 0, 16),
              paddingLeft: insets?.left ?? 0,
              paddingRight: insets?.right ?? 0,
            }}
            onEndReached={loadMoreSongs}
            onEndReachedThreshold={0.5}
            renderItem={({ item }) => (
              <View
                style={[
                  styles.songRow,
                  isPortrait ? styles.songRowPortrait : styles.songRowLandscape,
                  {
                    paddingLeft: Math.max(insets?.left ?? 0, isPortrait ? 12 : 20),
                    paddingRight: Math.max(insets?.right ?? 0, isPortrait ? 12 : 20),
                  },
                ]}
              >
                <View style={styles.songRowDetails}>
                  <Text
                    style={styles.songRowTitle}
                    numberOfLines={isPortrait ? 2 : 1}
                    maxFontSizeMultiplier={1.25}
                  >
                    {item.title}
                  </Text>
                  <View style={styles.songMetaLine}>
                    <Text style={styles.songRowCode} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                      [{item.code}]
                    </Text>
                    <Text style={styles.songRowArtist} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                      {item.artist ? ` • ${item.artist}` : ''}
                      {!item.has_singable_lyrics && (
                        <Text style={styles.instrumentalTag}> · {t('instrumental_only', language)}</Text>
                      )}
                    </Text>
                  </View>
                </View>
                <View style={styles.songActionsRow}>
                  <TouchableOpacity
                    style={styles.reserveBtnSmall}
                    onPress={() => handleReserveSong(item)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('reserve', language)} ${item.title}`}
                  >
                    <Text style={styles.reserveBtnTextSmall} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                      {t('reserve', language)}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.playBtnSmall}
                    onPress={() => handlePlaySong(item)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('play', language)} ${item.title}`}
                  >
                    <PlayIcon size={11} color="#000000" style={{ marginRight: 3 }} />
                    <Text style={styles.playBtnTextSmall} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                      {t('play', language)}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  {totalSongs === 0
                    ? isCatalogReady
                      ? 'Song catalog is empty or missing.'
                      : catalogSyncTimedOut
                        ? 'Catalog sync timed out. Song catalog may be missing.'
                        : 'Syncing catalog, please wait...'
                    : 'No songs matched your search.'}
                </Text>
              </View>
            }
          />
        </SafeAreaView>
      </Modal>

      {/* Queue Modal with 5s Undo (M4.5) */}
      <QueueModal
        visible={isQueueOpen}
        onClose={() => setIsQueueOpen(false)}
        activeReservation={activeReservation}
        activeSong={activeSong}
        pendingQueue={pendingQueue}
        onRemovePending={async (id) => controller.removePending(id)}
        onRestorePending={async (item) => controller.restorePending(item)}
        onMovePending={async (id, dir) => controller.movePending(id, dir)}
        language={language}
        activeKeyOffset={keyOffset}
        queueNeedsRefresh={controller.getQueueNeedsRefresh ? controller.getQueueNeedsRefresh() : false}
        onRetryQueue={() => (controller.refreshQueueAsync ? controller.refreshQueueAsync() : Promise.resolve())}
      />

      {/* Settings & Bundled Library Info Modal (M6) */}
      <SettingsModal
        visible={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        language={language}
        onLanguageChange={(_l) => {
          setLanguage('en');
          setLangState('en');
          SettingsDao.setLanguage('en');
        }}
        totalSongs={totalSongs}
        onViewTutorial={handleOpenTutorial}
      />

      {/* First-Launch Onboarding & Tutorial Modal */}
      <OnboardingModal
        visible={isOnboardingVisible}
        onClose={handleCloseOnboarding}
        totalSongs={totalSongs}
        isTutorialMode={isTutorialMode}
      />
    </SafeAreaView>
  );
};

export default PlayerScreen;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B0D12',
  },
  stage: {
    flex: 1,
    backgroundColor: '#0B0D12',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  stagePortrait: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  stageLandscape: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },

  /* Landscape Dedicated 2-Column Stage */
  landscapeStageContainer: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
  },
  landscapeLyricsColumn: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  landscapeLyricsColumnFullscreen: {
    paddingRight: 56,
  },
  landscapeSidebarColumn: {
    width: '33%',
    minWidth: 265,
    maxWidth: 325,
    backgroundColor: '#131722',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#232B3E',
    padding: 8,
    justifyContent: 'space-between',
    position: 'relative',
  },
  collapseToggleBtnExpanded: {
    position: 'absolute',
    left: -20,
    top: '50%',
    marginTop: -24,
    width: 44,
    height: 48,
    borderRadius: 22,
    backgroundColor: '#1B2030',
    borderWidth: 1,
    borderColor: '#283248',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 30,
    elevation: 6,
    opacity: 0.5,
  },
  collapseToggleBtnCollapsed: {
    position: 'absolute',
    top: '50%',
    marginTop: -24,
    width: 44,
    height: 48,
    borderRadius: 22,
    backgroundColor: '#1B2030',
    borderWidth: 1,
    borderColor: '#283248',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 30,
    elevation: 6,
    opacity: 0.5,
  },
  landscapeSidebarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandTitle: {
    color: '#FFD600',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  brandTitleLandscape: {
    color: '#FFD600',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
  },
  landscapeNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  landscapeSongbookBtn: {
    backgroundColor: '#FFD600',
    flex: 1.25,
    minHeight: 44,
    borderRadius: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  landscapeQueueBtn: {
    backgroundColor: '#20283A',
    flex: 1,
    paddingHorizontal: 4,
    minHeight: 44,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#283248',
  },
  landscapeSettingsBtn: {
    backgroundColor: '#1B2030',
    width: 44,
    minHeight: 44,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#283248',
    flexShrink: 0,
  },
  landscapeNowPlayingCard: {
    backgroundColor: '#1B2030',
    borderRadius: 8,
    padding: 6,
    borderWidth: 1,
    borderColor: '#283248',
    marginBottom: 4,
  },
  nowPlayingTitleTextLandscape: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
    lineHeight: 17,
  },
  landscapeKeyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  keyDisplayLandscape: {
    minWidth: 36,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1B2030',
    borderRadius: 7,
    marginHorizontal: 3,
    borderWidth: 1,
    borderColor: '#283248',
    paddingHorizontal: 4,
  },
  keyTextLandscape: {
    color: '#FFD63D',
    fontSize: 15,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  landscapeTransportRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  controlBtnLandscape: {
    minWidth: 44,
    minHeight: 48,
    paddingHorizontal: 4,
    marginHorizontal: 2,
    borderRadius: 7,
  },

  /* Portrait Top Bar */
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
    borderBottomWidth: 1,
    borderBottomColor: '#232B3E',
    paddingHorizontal: 8,
  },
  topBarPortrait: {
    borderBottomWidth: 1,
    borderBottomColor: '#232B3E',
    paddingBottom: 8,
  },
  songInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
    marginBottom: 6,
  },
  brandGroupPortrait: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandTitlePortrait: {
    color: '#FFD600',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  headerActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  songbookBtnPortrait: {
    backgroundColor: '#FFD600',
    paddingHorizontal: 10,
    borderRadius: 8,
    minHeight: 42,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueBtnPortrait: {
    backgroundColor: '#20283A',
    paddingHorizontal: 12,
    borderRadius: 8,
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    borderWidth: 1,
    borderColor: '#283248',
  },
  iconBtnPortrait: {
    backgroundColor: '#1B2030',
    width: 42,
    minHeight: 42,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#283248',
    flexShrink: 0,
  },
  portraitNowPlayingBanner: {
    backgroundColor: '#1B2030',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#283248',
  },
  nowPlayingTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  nowPlayingCodeBadge: {
    color: '#FFD600',
    fontWeight: 'bold',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  nowPlayingTimeText: {
    color: '#B3B8C6',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  nowPlayingHintText: {
    color: '#FFD63D',
    fontSize: 11,
    fontWeight: '600',
  },
  nowPlayingTitleText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  nowPlayingArtistText: {
    color: '#B3B8C6',
    fontSize: 13,
    marginTop: 2,
  },
  upNextBannerText: {
    color: '#FFD600',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 3,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    marginLeft: 6,
  },
  songCode: {
    color: '#FFD600',
    fontWeight: 'bold',
    fontSize: 15,
    marginRight: 8,
    fontFamily: 'monospace',
  },
  songTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    maxWidth: '50%',
  },
  songArtist: {
    color: '#B3B8C6',
    fontSize: 14,
    marginLeft: 8,
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  headerBtnGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  iconBtn: {
    backgroundColor: '#1B2030',
    padding: 6,
    borderRadius: 6,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#283248',
    marginRight: 6,
  },
  queueBtn: {
    backgroundColor: '#20283A',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#283248',
  },
  queueBadgeText: {
    color: '#FFD63D',
    fontSize: 12,
    fontWeight: '700',
  },
  queueBadge: {
    color: '#E0E0E0',
    fontSize: 13,
    fontWeight: '600',
  },
  songbookBtn: {
    backgroundColor: '#FFD600',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginRight: 6,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
  },
  songbookBtnText: {
    color: '#000000',
    fontWeight: 'bold',
    fontSize: 12,
    letterSpacing: 0.5,
  },

  /* Idle Splash */
  idleSplash: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 24,
  },
  idleSplashLandscape: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  idleTitle: {
    color: '#FFD600',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 4,
    textShadowColor: 'rgba(255, 214, 0, 0.4)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  idleTitleLandscape: {
    color: '#FFD600',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 3,
    textShadowColor: 'rgba(255, 214, 0, 0.4)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  idleSubtitle: {
    color: '#7E88A0',
    fontSize: 14,
    marginTop: 8,
    fontWeight: '500',
  },
  startupErrorCard: {
    alignItems: 'center',
    backgroundColor: '#1E2433',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EF4444',
    marginTop: 12,
    maxWidth: 320,
  },
  startupErrorText: {
    color: '#F87171',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
    fontWeight: '500',
  },
  retryBtn: {
    backgroundColor: '#FFD600',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 6,
    minHeight: 44,
    minWidth: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  retryBtnText: {
    color: '#000000',
    fontWeight: '700',
    fontSize: 13,
  },

  /* Lyric Stage */
  lyricScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  lyricScreenPortrait: {
    paddingHorizontal: 12,
    justifyContent: 'flex-start',
    paddingTop: 12,
  },
  lyricScreenPortraitIdle: {
    justifyContent: 'center',
    paddingTop: 0,
  },
  lyricScreenLandscape: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  readyPromptCard: {
    backgroundColor: '#1B2030',
    borderWidth: 1,
    borderColor: '#283248',
    borderRadius: 12,
    padding: 14,
    width: '100%',
    marginBottom: 12,
  },
  bigPlayActionBtn: {
    backgroundColor: '#00E676',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  bigPlayActionText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1,
  },
  readyPromptSub: {
    color: '#B3B8C6',
    fontSize: 13,
    textAlign: 'center',
  },
  queuePreviewSection: {
    borderTopWidth: 1,
    borderTopColor: '#283248',
    paddingTop: 10,
  },
  queuePreviewHeader: {
    color: '#B3B8C6',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
  },
  queuePreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#20283A',
  },
  queuePreviewIdx: {
    color: '#FFD63D',
    fontSize: 12,
    fontWeight: '700',
    width: 20,
  },
  queuePreviewTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  queuePreviewCode: {
    color: '#FFD600',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  progressContainerPortrait: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginTop: 12,
    gap: 10,
  },
  timeTextPortrait: {
    color: '#B3B8C6',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  progressBarTrackPortrait: {
    width: '100%',
    height: 3,
    backgroundColor: '#20283A',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 6,
  },
  progressBarFillPortrait: {
    height: '100%',
    backgroundColor: '#FFD600',
    borderRadius: 2,
  },
  countdownContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 14,
    paddingVertical: 6,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 214, 61, 0.3)',
  },
  countdownDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  countdownDotLit: {
    backgroundColor: '#FFD63D',
    shadowColor: '#FFD63D',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 4,
  },
  countdownDotUnlit: {
    backgroundColor: '#20283A',
    borderWidth: 1,
    borderColor: '#283248',
  },
  lyricLine: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginVertical: 8,
    letterSpacing: 0.5,
    lineHeight: 40,
  },
  lyricLinePortrait: {
    fontSize: 30,
    lineHeight: 44,
    marginVertical: 10,
  },
  lyricLineLandscape: {
    fontSize: 34,
    lineHeight: 46,
    fontWeight: 'bold',
    textAlign: 'center',
    marginVertical: 8,
    letterSpacing: 0.5,
  },
  syllableSung: {
    color: '#FFD63D',
    fontWeight: 'bold',
    textShadowColor: 'rgba(255, 214, 61, 0.8)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  syllableActive: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  syllableUpcoming: {
    color: '#7E88A0',
    fontWeight: 'bold',
  },
  lyricActive: {
    color: '#FFFFFF',
    textShadowColor: 'rgba(255, 214, 0, 0.4)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  lyricUpcoming: {
    color: '#7E88A0',
  },

  /* Notice / Error Banner */
  noticeBanner: {
    position: 'absolute',
    top: 8,
    left: 12,
    right: 12,
    zIndex: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.95)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  noticeBannerLandscape: {
    backgroundColor: '#EF4444',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 10,
  },
  noticeBannerText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  noticeDismissBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderRadius: 6,
    minHeight: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noticeDismissText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  modalNoticeBanner: {
    backgroundColor: '#EF4444',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalNoticeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  modalNoticeDismiss: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 6,
    minHeight: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalNoticeDismissText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },

  /* Rotate Floating Button: Portrait only */
  rotateFloatingWrapper: {
    position: 'absolute',
    bottom: 135,
    right: 18,
    zIndex: 99,
  },
  rotateFloatingBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#161A24',
    borderWidth: 1.5,
    borderColor: '#283248',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 6,
    elevation: 8,
  },

  /* Controls: Portrait & Landscape */
  controlDock: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 64,
    borderTopWidth: 1,
    borderTopColor: '#232B3E',
    paddingHorizontal: 8,
  },
  controlDockPortrait: {
    borderTopWidth: 1,
    borderTopColor: '#232B3E',
    paddingTop: 8,
  },
  keySection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  keySectionPortrait: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  transportSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  transportSectionPortrait: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  controlBtn: {
    minWidth: 54,
    minHeight: 48,
    backgroundColor: '#20283A',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 10,
    marginHorizontal: 3,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#283248',
  },
  flexBtn: {
    flex: 1,
  },
  btnLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  keyDisplay: {
    minWidth: 44,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1B2030',
    borderRadius: 8,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: '#283248',
    paddingHorizontal: 8,
  },
  keyText: {
    color: '#FFD600',
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  playBtn: {
    backgroundColor: '#00E676',
    minWidth: 88,
    borderColor: '#00E676',
  },
  playBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  stopBtn: {
    backgroundColor: '#C62828',
    borderColor: '#C62828',
  },
  nextBtn: {
    backgroundColor: '#FFD600',
    borderColor: '#FFD600',
  },
  nextBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  nextBtnTextLandscape: {
    fontSize: 11,
    letterSpacing: 0,
  },

  /* Songbook Modal */
  modalOverlayPortrait: {
    flex: 1,
  },
  modalOverlayLandscape: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#0B0D12',
  },
  modalContainerLandscape: {
    width: '90%',
    maxWidth: 760,
    height: '88%',
    maxHeight: 540,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#283248',
  },
  modalHeader: {
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#283248',
    backgroundColor: '#161A24',
  },
  modalTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    flexWrap: 'wrap',
    marginRight: 8,
    gap: 6,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  songCountBadge: {
    backgroundColor: '#20283A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#283248',
  },
  songCountBadgeText: {
    color: '#FFD600',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  closeBtn: {
    minHeight: 38,
    minWidth: 44,
    paddingHorizontal: 10,
    backgroundColor: '#20283A',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#283248',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
  },
  closeBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  feedbackBanner: {
    backgroundColor: '#FFD600',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feedbackText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },
  searchContainer: {
    height: 44,
    backgroundColor: '#1B2030',
    borderRadius: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#283248',
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInputInner: {
    flex: 1,
    height: 44,
    color: '#FFFFFF',
    fontSize: 14,
  },
  songRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1B2030',
  },
  songRowPortrait: {
    paddingVertical: 10,
    minHeight: 56,
  },
  songRowLandscape: {
    paddingVertical: 8,
    minHeight: 50,
  },
  songRowDetails: {
    flex: 1,
    marginRight: 8,
    justifyContent: 'center',
  },
  songRowTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  songMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    marginTop: 2,
  },
  songRowCode: {
    color: '#FFD600',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    marginRight: 2,
  },
  songRowArtist: {
    color: '#B3B8C6',
    fontSize: 12,
    flex: 1,
  },
  instrumentalTag: {
    color: '#A3ADBD',
    fontStyle: 'italic',
    fontSize: 11,
  },
  songActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 0,
  },
  reserveBtnSmall: {
    backgroundColor: '#20283A',
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 6,
    minHeight: 38,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFD600',
  },
  reserveBtnTextSmall: {
    color: '#FFD600',
    fontSize: 11,
    fontWeight: '700',
  },
  playBtnSmall: {
    backgroundColor: '#00E676',
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 6,
    minHeight: 38,
    minWidth: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnTextSmall: {
    color: '#000000',
    fontSize: 11,
    fontWeight: '800',
  },
  didYouMeanContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#1B2030',
    borderBottomWidth: 1,
    borderBottomColor: '#283248',
  },
  didYouMeanText: {
    color: '#FFD600',
    fontSize: 13,
    fontWeight: '700',
    fontStyle: 'italic',
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    color: '#B3B8C6',
    fontSize: 16,
  },
});
