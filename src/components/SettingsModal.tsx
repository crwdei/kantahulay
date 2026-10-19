import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { t, SupportedLanguage } from '../i18n';
import AudioModule from '../../modules/kantahulay-audio';
import { SettingsDao } from '../db/settingsDao';
import { CloseIcon, CheckIcon, ChevronRightIcon } from './Icons';
import { LicensesModal } from './LicensesModal';

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
  language: SupportedLanguage;
  onLanguageChange: (lang: SupportedLanguage) => void;
  theme?: string;
  onThemeChange?: (theme: string) => void;
  totalSongs: number | null;
  packFormatVersion?: number | null;
  onViewTutorial?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  visible,
  onClose,
  language,
  onLanguageChange,
  theme,
  onThemeChange,
  totalSongs,
  packFormatVersion,
  onViewTutorial,
}) => {
  const languages: { key: SupportedLanguage; label: string; sub: string }[] = [
    { key: 'en', label: 'English', sub: 'Default' },
    { key: 'fil', label: 'Filipino / Tagalog', sub: 'Pambansa' },
    { key: 'ceb', label: 'Cebuano / Bisaya', sub: 'Rehiyonal' },
  ];

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const [effectsLevel, setEffectsLevel] = React.useState<number>(() => {
    try {
      return AudioModule.getEffectsLevel?.() ?? 2;
    } catch {
      return 2;
    }
  });
  const [bluetoothOffset, setBluetoothOffset] = React.useState<number>(0);
  const [musicVolume, setMusicVolume] = React.useState<number>(1.0);
  const [isBluetoothActive, setIsBluetoothActive] = React.useState<boolean>(false);
  const insets = useSafeAreaInsets();
  const [licensesVisible, setLicensesVisible] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (!visible) return;
    SettingsDao.getBluetoothLyricOffset().then((val) => {
      setBluetoothOffset(val);
      AudioModule.setBluetoothLyricOffset?.(val);
    });
    SettingsDao.getMusicVolume().then((vol) => {
      setMusicVolume(vol);
      AudioModule.setMasterGain?.(vol);
    });
    SettingsDao.getVocalEffectsLevel().then((lvl) => {
      setEffectsLevel(lvl);
      AudioModule.setEffectsLevel?.(lvl);
    }).catch(() => Alert.alert('Settings unavailable', 'Could not load audio settings. Please reopen Settings.'));
    try {
      setIsBluetoothActive(AudioModule.isBluetoothActive?.() ?? false);
    } catch {}
  }, [visible]);

  const handleStepBluetoothOffset = (delta: number) => {
    setBluetoothOffset((prev) => {
      const next = Math.max(-500, Math.min(500, prev + delta));
      AudioModule.setBluetoothLyricOffset?.(next);
      SettingsDao.setBluetoothLyricOffset(next);
      return next;
    });
  };

  const handleResetBluetoothOffset = () => {
    setBluetoothOffset(0);
    AudioModule.setBluetoothLyricOffset?.(0);
    SettingsDao.setBluetoothLyricOffset(0);
  };

  const handleSelectEffectsLevel = async (lvl: number) => {
    try {
      await SettingsDao.setVocalEffectsLevel(lvl);
      AudioModule.setEffectsLevel?.(lvl);
      setEffectsLevel(lvl);
    } catch {
      Alert.alert('Settings not saved', 'Could not save vocal effects. Please try again.');
    }
  };

  const handleSetVolume = async (vol: number) => {
    const clamped = Math.max(0.0, Math.min(1.0, Math.round(vol * 100) / 100));
    setMusicVolume(clamped);
    AudioModule.setMasterGain?.(clamped);
    try {
      await SettingsDao.setMusicVolume(clamped);
    } catch {
      Alert.alert('Settings not saved', 'Could not save volume setting. Please try again.');
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
            <Text style={styles.title}>{t('settings', language)}</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={t('close', language)}
            >
              <CloseIcon size={24} color="#B3B8C6" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Language Selection: Hidden while English-only interface is active */}

            {/* Tutorial & Onboarding */}
            {onViewTutorial && (
              <View style={styles.sectionWrap}>
                <Text style={styles.sectionTitle}>TUTORIAL</Text>
                <View style={styles.card}>
                  <TouchableOpacity
                    style={styles.tutorialRow}
                    onPress={onViewTutorial}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="View Tutorial"
                  >
                    <View style={styles.tutorialTextGroup}>
                      <Text style={styles.tutorialTitle}>View Tutorial</Text>
                      <Text style={styles.tutorialSubtitle}>Replay introduction guide</Text>
                    </View>
                    <ChevronRightIcon size={16} color="#FFD600" />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Bundled Library & System Information */}
            <View style={styles.sectionWrap}>
              <Text style={styles.sectionTitle}>SYSTEM & CATALOG</Text>
              <View style={styles.card}>
                <View style={styles.badgeWrap}>
                  <Text style={styles.badgeText}>{t('library_offline_badge', language)}</Text>
                </View>

                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>{t('pack_version', language)}</Text>
                  <Text style={styles.infoValue}>
                    {packFormatVersion ? `v${packFormatVersion}.0 (songs.kpak)` : 'v1.0 (songs.kpak)'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Music Volume Control (U08) */}
            <View style={styles.sectionWrap}>
              <Text style={styles.sectionTitle}>MUSIC VOLUME</Text>
              <View style={styles.card}>
                <View style={styles.offsetHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.offsetTitle}>Master Music Gain</Text>
                    <Text style={styles.offsetSubtitle}>Adjust synth audio output level</Text>
                  </View>
                  <Text style={[styles.offsetDisplay, styles.offsetDisplayActive]}>
                    {Math.round(musicVolume * 100)}%
                  </Text>
                </View>
                <View style={styles.volumeBarTrack}>
                  <View style={[styles.volumeBarFill, { width: `${Math.round(musicVolume * 100)}%` }]} />
                </View>
                <View style={styles.volumePresetsRow}>
                  {[
                    { label: 'Mute', val: 0.0 },
                    { label: '-10%', delta: -0.1 },
                    { label: '50%', val: 0.5 },
                    { label: '80%', val: 0.8 },
                    { label: '+10%', delta: 0.1 },
                    { label: '100%', val: 1.0 },
                  ].map((p) => (
                    <TouchableOpacity
                      key={p.label}
                      style={[
                        styles.volumePresetBtn,
                        p.val !== undefined && Math.abs(musicVolume - p.val) < 0.02 && styles.volumePresetBtnActive,
                      ]}
                      onPress={() => {
                        if (p.val !== undefined) handleSetVolume(p.val);
                        else if (p.delta !== undefined) handleSetVolume(musicVolume + p.delta);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Set volume to ${p.label}`}
                    >
                      <Text
                        style={[
                          styles.volumePresetText,
                          p.val !== undefined && Math.abs(musicVolume - p.val) < 0.02 && styles.volumePresetTextActive,
                        ]}
                      >
                        {p.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            {/* Synth Effects (Reverb & Chorus) */}
            <View style={styles.sectionWrap}>
              <Text style={styles.sectionTitle}>SYNTH EFFECTS (REVERB & CHORUS)</Text>
              <View style={styles.card}>
                <View style={styles.effectsRow}>
                  {[
                    { label: 'Off', val: 0 },
                    { label: 'Low', val: 1 },
                    { label: 'Med', val: 2 },
                    { label: 'High', val: 3 },
                  ].map((item) => (
                    <TouchableOpacity
                      key={item.label}
                      style={[styles.effectBtn, effectsLevel === item.val && styles.effectBtnActive]}
                      onPress={() => handleSelectEffectsLevel(item.val)}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.effectBtnText, effectsLevel === item.val && styles.effectBtnTextActive]}>
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            {/* Advanced Section */}
            <View style={styles.sectionWrap}>
              <Text style={styles.sectionTitle}>ADVANCED</Text>
              <View style={styles.card}>
                <View style={styles.offsetHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.offsetTitle}>Bluetooth Lyric Offset</Text>
                    <Text style={styles.offsetSubtitle}>
                      {isBluetoothActive ? 'Active (Bluetooth connected)' : 'Standby (Speaker/Wired)'}
                    </Text>
                  </View>
                  <Text style={[styles.offsetDisplay, isBluetoothActive && styles.offsetDisplayActive]}>
                    {bluetoothOffset > 0 ? `+${bluetoothOffset} ms` : `${bluetoothOffset} ms`}
                  </Text>
                </View>

                <View style={styles.offsetControls}>
                  <TouchableOpacity
                    style={styles.offsetBtn}
                    onPress={() => handleStepBluetoothOffset(-50)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.offsetBtnText}>-50</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.offsetBtn}
                    onPress={() => handleStepBluetoothOffset(-10)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.offsetBtnText}>-10</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.offsetBtn, styles.offsetResetBtn]}
                    onPress={handleResetBluetoothOffset}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.offsetBtnText, styles.offsetResetText]}>Reset</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.offsetBtn}
                    onPress={() => handleStepBluetoothOffset(10)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.offsetBtnText}>+10</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.offsetBtn}
                    onPress={() => handleStepBluetoothOffset(50)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.offsetBtnText}>+50</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.offsetHint}>
                  Acoustic latency is automatically compensated. Use this offset only if your Bluetooth headset has unmeasured delay (-500 to +500 ms).
                </Text>
              </View>
            </View>

            {/* About & Developer Information (At the very bottom) */}
            <View style={styles.sectionWrap}>
              <Text style={styles.sectionTitle}>ABOUT</Text>
              <View style={styles.card}>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>App Name</Text>
                  <Text style={styles.infoValue}>Kantahulay</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Version</Text>
                  <Text style={styles.infoValue}>v1.0.0</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Developer</Text>
                  <Text style={[styles.infoValue, { color: '#FFD600' }]}>tonyo</Text>
                </View>

                <View style={styles.divider} />

                <TouchableOpacity
                  style={styles.licenseRow}
                  onPress={() => setLicensesVisible(true)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Open-source licenses"
                >
                  <Text style={styles.licenseRowLabel}>Open-source licenses</Text>
                  <ChevronRightIcon size={16} color="#8A94A8" />
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>

      <LicensesModal
        visible={licensesVisible}
        onClose={() => setLicensesVisible(false)}
      />
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
    maxHeight: '88%',
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
    width: '90%',
    maxWidth: 620,
    borderRadius: 16,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: '#283248',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 6,
    minWidth: 48,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionWrap: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: '#B3B8C6',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1B2030',
    padding: 14,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#283248',
  },
  optionRowSelected: {
    borderColor: '#FFD63D',
    backgroundColor: '#20283A',
  },
  optionLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  optionLabelSelected: {
    color: '#FFD63D',
  },
  optionSub: {
    color: '#B3B8C6',
    fontSize: 12,
  },
  themeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  themeBtn: {
    flex: 1,
    backgroundColor: '#1B2030',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#283248',
  },
  themeBtnSelected: {
    borderColor: '#FFD63D',
    backgroundColor: '#20283A',
  },
  themeBtnText: {
    color: '#B3B8C6',
    fontSize: 14,
    fontWeight: '600',
  },
  themeBtnTextSelected: {
    color: '#FFD63D',
  },
  card: {
    backgroundColor: '#1B2030',
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: '#283248',
  },
  badgeWrap: {
    backgroundColor: 'rgba(255, 214, 0, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  badgeText: {
    color: '#FFD600',
    fontSize: 12,
    fontWeight: '700',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginVertical: 4,
  },
  infoLabel: {
    color: '#B3B8C6',
    fontSize: 13,
    minWidth: 85,
    flexShrink: 0,
  },
  infoValue: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
    textAlign: 'right',
  },
  divider: {
    height: 1,
    backgroundColor: '#283248',
    marginVertical: 12,
  },
  noticeText: {
    color: '#B3B8C6',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 8,
  },
  baselineText: {
    color: '#7E88A0',
    fontSize: 11,
    lineHeight: 16,
  },
  tutorialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  tutorialTextGroup: {
    flex: 1,
    marginRight: 12,
  },
  tutorialTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  tutorialSubtitle: {
    color: '#A3ADBD',
    fontSize: 12,
  },
  effectsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  effectBtn: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: '#0F1626',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#243048',
    alignItems: 'center',
    justifyContent: 'center',
  },
  effectBtnActive: {
    borderColor: '#FFD600',
    backgroundColor: 'rgba(255, 214, 0, 0.12)',
  },
  effectBtnText: {
    color: '#B3B8C6',
    fontSize: 13,
    fontWeight: '600',
  },
  effectBtnTextActive: {
    color: '#FFD600',
    fontWeight: '700',
  },
  licenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  licenseRowLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  offsetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  offsetTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  offsetSubtitle: {
    color: '#7E88A0',
    fontSize: 12,
    marginTop: 1,
  },
  offsetDisplay: {
    color: '#7E88A0',
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  offsetDisplayActive: {
    color: '#FFD600',
  },
  volumeBarTrack: {
    height: 8,
    backgroundColor: '#0F1626',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#243048',
    overflow: 'hidden',
    marginBottom: 10,
  },
  volumeBarFill: {
    height: '100%',
    backgroundColor: '#FFD600',
    borderRadius: 3,
  },
  volumePresetsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 4,
  },
  volumePresetBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 2,
    backgroundColor: '#0F1626',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#243048',
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumePresetBtnActive: {
    borderColor: '#FFD600',
    backgroundColor: '#20283A',
  },
  volumePresetText: {
    color: '#B3B8C6',
    fontSize: 11,
    fontWeight: '700',
  },
  volumePresetTextActive: {
    color: '#FFD600',
  },
  offsetControls: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  offsetBtn: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 2,
    backgroundColor: '#0F1626',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#243048',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offsetResetBtn: {
    borderColor: '#364460',
  },
  offsetBtnText: {
    color: '#B3B8C6',
    fontSize: 12,
    fontWeight: '700',
  },
  offsetResetText: {
    color: '#E0E4EE',
  },
  offsetHint: {
    color: '#7E88A0',
    fontSize: 11,
    lineHeight: 16,
  },
});
