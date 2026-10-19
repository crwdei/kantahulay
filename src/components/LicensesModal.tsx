import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CloseIcon, ChevronLeftIcon } from './Icons';

interface LicensesModalProps {
  visible: boolean;
  onClose: () => void;
}

export const LicensesModal: React.FC<LicensesModalProps> = ({ visible, onClose }) => {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const insets = useSafeAreaInsets();

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
            <TouchableOpacity
              onPress={onClose}
              style={styles.backBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <ChevronLeftIcon size={18} color="#FFD600" />
            </TouchableOpacity>
            <Text style={styles.title}>Open-source licenses</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <CloseIcon size={20} color="#B3B8C6" />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={true}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
          >
            {/* FluidSynth v2.6.1 */}
            <View style={styles.licenseCard}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pkgTitle}>FluidSynth</Text>
                  <Text style={styles.pkgVersion}>v2.6.1 · LGPL-2.1</Text>
                </View>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>LGPL-2.1</Text>
                </View>
              </View>

              <Text style={styles.pkgDesc}>
                Real-time software synthesizer based on SoundFont 2 specifications.
                Dynamically linked as a shared library (libfluidsynth.so) in compliance with LGPL-2.1.
              </Text>

              <View style={styles.linkBox}>
                <Text style={styles.linkLabel}>Source Code &amp; Upstream Tag</Text>
                <Text style={styles.linkText}>https://github.com/FluidSynth/fluidsynth/releases/tag/v2.6.1</Text>
              </View>

              <View style={styles.textContainer}>
                <Text style={styles.licenseBody}>
                  GNU LESSER GENERAL PUBLIC LICENSE{'\n'}
                  Version 2.1, February 1999{'\n\n'}
                  Copyright (C) 1991, 1999 Free Software Foundation, Inc.{'\n'}
                  51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA{'\n\n'}
                  This library is free software; you can redistribute it and/or
                  modify it under the terms of the GNU Lesser General Public
                  License as published by the Free Software Foundation; either
                  version 2.1 of the License, or (at your option) any later version.{'\n\n'}
                  This library is distributed in the hope that it will be useful,
                  but WITHOUT ANY WARRANTY; without even the implied warranty of
                  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
                  Lesser General Public License for more details.
                </Text>
              </View>
            </View>

            {/* GeneralUser GS v2.0.3 */}
            <View style={styles.licenseCard}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pkgTitle}>GeneralUser GS</Text>
                  <Text style={styles.pkgVersion}>v2.0.3 · SoundFont Bank</Text>
                </View>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>Freeware</Text>
                </View>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.authorLabel}>Author:</Text>
                <Text style={styles.authorValue}>S. Christian Collins</Text>
              </View>

              <View style={styles.linkBox}>
                <Text style={styles.linkLabel}>Official Website</Text>
                <Text style={styles.linkText}>https://www.schristiancollins.com</Text>
              </View>

              <View style={styles.textContainer}>
                <Text style={styles.licenseBody}>
                  GeneralUser GS v2.0.3 License v2.0{'\n\n'}
                  License of the complete work:{'\n'}
                  You may use GeneralUser GS without restriction for your own music
                  creation, private or commercial. This SoundFont bank is provided to
                  the community free of charge. Please feel free to use it in your software
                  projects, and to modify the SoundFont bank or its packaging to suit
                  your needs.{'\n\n'}
                  License of contained samples:{'\n'}
                  GeneralUser GS inherits the usage rights of the samples contained
                  within, all of which allow full use in music production, including
                  the ability to make profit from musical recordings created with
                  GeneralUser GS.
                </Text>
              </View>
            </View>
          </ScrollView>
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
    height: '90%',
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
    width: '90%',
    maxWidth: 620,
    borderRadius: 16,
    height: '90%',
    maxHeight: '92%',
    borderWidth: 1,
    borderColor: '#283248',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  backBtn: {
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
    marginLeft: 8,
  },
  closeBtn: {
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  licenseCard: {
    backgroundColor: '#1F2433',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#283248',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  pkgTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  pkgVersion: {
    color: '#A3ADBD',
    fontSize: 13,
    marginTop: 2,
  },
  badge: {
    backgroundColor: 'rgba(255, 214, 0, 0.12)',
    borderColor: '#FFD600',
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  badgeText: {
    color: '#FFD600',
    fontSize: 11,
    fontWeight: '700',
  },
  pkgDesc: {
    color: '#C7CEE0',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  authorLabel: {
    color: '#8A94A8',
    fontSize: 13,
  },
  authorValue: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  linkBox: {
    backgroundColor: '#121622',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#243048',
  },
  linkLabel: {
    color: '#8A94A8',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  linkText: {
    color: '#FFD600',
    fontSize: 12,
  },
  textContainer: {
    backgroundColor: '#111520',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E2538',
  },
  licenseBody: {
    color: '#9BA3B5',
    fontSize: 11,
    lineHeight: 16,
    fontFamily: 'monospace',
  },
});
