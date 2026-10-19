import React, { useRef, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookIcon, MusicIcon, PlayIcon } from './Icons';
import { SettingsDao } from '../db/settingsDao';

const KANTAHULAY_LOGO = require('../../assets/kantahulay_logo_transparent.png');

export interface OnboardingContentProps {
  onClose: (completed: boolean) => void;
  totalSongs?: number | null;
  isTutorialMode?: boolean;
}

export interface OnboardingModalProps extends OnboardingContentProps {
  visible: boolean;
}

function useOnboardingLogic(
  onClose: (completed: boolean) => void,
  isTutorialMode: boolean = false
) {
  const navigatingRef = useRef<boolean>(false);
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const insets = useSafeAreaInsets();

  const canNavigate = useCallback((): boolean => {
    if (navigatingRef.current) {
      return false;
    }
    navigatingRef.current = true;
    setTimeout(() => {
      navigatingRef.current = false;
    }, 200);
    return true;
  }, []);

  const handleFinish = useCallback(() => {
    if (!canNavigate()) return;
    if (!isTutorialMode) {
      SettingsDao.setOnboardingCompleted(true).catch(() => {});
    }
    onClose(true);
  }, [canNavigate, isTutorialMode, onClose]);

  return { insets, isLandscape, handleFinish };
}

function renderOnboardingTree(
  insets: { top: number; bottom: number; left: number; right: number },
  isLandscape: boolean,
  handleFinish: () => void
) {
  const features = [
    {
      id: 'search',
      title: 'Find Your Song',
      subtitle: 'Search. Queue. Sing.',
      description: 'Browse the Songbook, choose a song, and add it to your queue.',
      icon: (
        <View style={[styles.featureIconBox, { backgroundColor: 'rgba(255, 214, 0, 0.12)', borderColor: 'rgba(255, 214, 0, 0.3)' }]}>
          <BookIcon size={18} color="#FFD600" />
        </View>
      ),
    },
    {
      id: 'lyrics',
      title: 'Real Videoke Stage',
      subtitle: 'Real-time lyrics & vocal timing.',
      description: 'Follow synchronized syllable sweeps with a 4-dot entry meter.',
      icon: (
        <View style={[styles.featureIconBox, { backgroundColor: 'rgba(255, 214, 0, 0.12)', borderColor: 'rgba(255, 214, 0, 0.3)' }]}>
          <MusicIcon size={18} color="#FFD600" />
        </View>
      ),
    },
    {
      id: 'playback',
      title: 'Sing Your Way',
      subtitle: 'Portrait or Landscape. Your Choice.',
      description: 'Follow the lyrics, adjust the key, and enjoy karaoke your way.',
      icon: (
        <View style={[styles.featureIconBox, { backgroundColor: 'rgba(0, 230, 118, 0.12)', borderColor: 'rgba(0, 230, 118, 0.3)' }]}>
          <PlayIcon size={16} color="#00E676" />
        </View>
      ),
    },
  ];

  const renderHeader = () => (
    <View style={styles.headerBlock}>
      <View style={styles.logoBadgeRow}>
        <Image
          source={KANTAHULAY_LOGO}
          style={isLandscape ? styles.logoLandscape : styles.logoPortrait}
          resizeMode="contain"
          accessibilityLabel="Kantahulay Logo"
        />
        <View style={styles.brandTitles}>
          <Text style={styles.brandTitle} numberOfLines={1}>KANTAHULAY</Text>
          <Text style={styles.brandSubtitle} numberOfLines={1}>Your Karaoke, Anytime.</Text>
        </View>
      </View>

      <Text style={styles.brandDescription}>
        Welcome to Kantahulay. Sing your favorite songs, even offline.
      </Text>

      <View style={styles.catalogPill}>
        <View style={styles.catalogDot} />
        <Text style={styles.catalogPillText} numberOfLines={1}>
          40,000+ songs in offline library
        </Text>
      </View>
    </View>
  );

  const renderFeatureCards = () => (
    <View style={styles.featuresStack}>
      {features.map((item) => (
        <View key={item.id} style={styles.featureCard}>
          {item.icon}
          <View style={styles.featureTextCol}>
            <Text style={styles.featureTitle} numberOfLines={1} maxFontSizeMultiplier={1.2}>
              {item.title}
            </Text>
            <Text style={styles.featureSubtitle} numberOfLines={1} maxFontSizeMultiplier={1.2}>
              {item.subtitle}
            </Text>
            <Text style={styles.featureDesc} numberOfLines={2} maxFontSizeMultiplier={1.2}>
              {item.description}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );

  const renderActions = () => (
    <View style={styles.actionsContainer}>
      <TouchableOpacity
        style={styles.primaryButton}
        onPress={handleFinish}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Start Singing"
      >
        <Text style={styles.primaryButtonText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
          Start Singing →
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.skipButton}
        onPress={handleFinish}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Skip tutorial"
      >
        <Text style={styles.skipButtonText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
          Skip
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          isLandscape ? styles.scrollContentLandscape : styles.scrollContentPortrait,
        ]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {isLandscape ? (
          <View style={styles.landscapeRow}>
            <View style={styles.landscapeLeftCol}>
              {renderHeader()}
              {renderActions()}
            </View>
            <View style={styles.landscapeRightCol}>
              {renderFeatureCards()}
            </View>
          </View>
        ) : (
          <View style={styles.portraitWrapper}>
            {renderHeader()}
            {renderFeatureCards()}
            {renderActions()}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

export const OnboardingContent: React.FC<OnboardingContentProps> = ({
  onClose,
  isTutorialMode = false,
}) => {
  const { insets, isLandscape, handleFinish } = useOnboardingLogic(onClose, isTutorialMode);
  return renderOnboardingTree(insets, isLandscape, handleFinish);
};

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  visible,
  onClose,
  isTutorialMode = false,
}) => {
  const { insets, isLandscape, handleFinish } = useOnboardingLogic(onClose, isTutorialMode);
  return (
    <Modal
      visible={visible}
      transparent={false}
      statusBarTranslucent={true}
      animationType="fade"
      onRequestClose={handleFinish}
    >
      {renderOnboardingTree(insets, isLandscape, handleFinish)}
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0D12',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  scrollContentPortrait: {
    justifyContent: 'space-between',
  },
  scrollContentLandscape: {
    justifyContent: 'center',
  },

  /* Header */
  headerBlock: {
    alignItems: 'center',
    marginBottom: 16,
  },
  logoBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  logoPortrait: {
    width: 52,
    height: 52,
  },
  logoLandscape: {
    width: 44,
    height: 44,
  },
  brandTitles: {
    justifyContent: 'center',
  },
  brandTitle: {
    color: '#FFD600',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2.5,
  },
  brandSubtitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  brandDescription: {
    color: '#A3ADBD',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    maxWidth: 320,
    marginBottom: 10,
  },
  catalogPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#141A29',
    borderWidth: 1,
    borderColor: '#243048',
  },
  catalogDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00E676',
  },
  catalogPillText: {
    color: '#00E676',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  /* Feature Cards */
  featuresStack: {
    gap: 10,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    marginVertical: 10,
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141A29',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#243048',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
  },
  featureIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  featureTextCol: {
    flex: 1,
    gap: 2,
  },
  featureTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  featureSubtitle: {
    color: '#FFD600',
    fontSize: 11,
    fontWeight: '600',
  },
  featureDesc: {
    color: '#8E9BAC',
    fontSize: 11,
    lineHeight: 15,
  },

  /* Actions */
  actionsContainer: {
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
    alignItems: 'center',
    marginTop: 12,
    gap: 8,
  },
  primaryButton: {
    width: '100%',
    minHeight: 48,
    backgroundColor: '#FFD600',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  skipButton: {
    minHeight: 38,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipButtonText: {
    color: '#A3ADBD',
    fontSize: 13,
    fontWeight: '600',
  },

  /* Portrait / Landscape Wrappers */
  portraitWrapper: {
    flex: 1,
    justifyContent: 'space-between',
    width: '100%',
  },
  landscapeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: 20,
  },
  landscapeLeftCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  landscapeRightCol: {
    flex: 1.2,
    justifyContent: 'center',
  },
});
