import { getDatabaseAsync } from './database';
import { SupportedLanguage } from '../i18n';

export class SettingsDao {
  static async getLanguage(): Promise<SupportedLanguage> {
    try {
      const db = await getDatabaseAsync();
      const row = await db.getFirstAsync<{ selected_language: string }>(
        'SELECT selected_language FROM app_state WHERE id = 1;'
      );
      if (
        row?.selected_language === 'fil' ||
        row?.selected_language === 'ceb' ||
        row?.selected_language === 'en'
      ) {
        return row.selected_language;
      }
      return 'en';
    } catch {
      return 'en';
    }
  }

  static async setLanguage(lang: SupportedLanguage): Promise<void> {
    try {
      const db = await getDatabaseAsync();
      await db.runAsync(
        'UPDATE app_state SET selected_language = ? WHERE id = 1;',
        [lang]
      );
    } catch {
      // fallback
    }
  }

  static async isOnboardingCompleted(): Promise<boolean> {
    try {
      const db = await getDatabaseAsync();
      const row = await db.getFirstAsync<{
        onboarding_completed?: number | null;
        catalog_hash?: string | null;
        last_successful_bundle_check?: number | null;
      }>(
        'SELECT onboarding_completed, catalog_hash, last_successful_bundle_check FROM app_state WHERE id = 1;'
      );

      if (!row) {
        return false;
      }

      if (row.onboarding_completed === 1) {
        return true;
      }

      // Upgrade check: existing users with catalog_hash or last_successful_bundle_check
      // are not forced through onboarding
      if (row.catalog_hash || row.last_successful_bundle_check) {
        await SettingsDao.setOnboardingCompleted(true);
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  static async setOnboardingCompleted(completed: boolean = true): Promise<void> {
    try {
      const db = await getDatabaseAsync();
      await db.runAsync(
        'UPDATE app_state SET onboarding_completed = ? WHERE id = 1;',
        [completed ? 1 : 0]
      );
    } catch {
      // fallback
    }
  }

  static async getBluetoothLyricOffset(): Promise<number> {
    try {
      const db = await getDatabaseAsync();
      const row = await db.getFirstAsync<{ bluetooth_lyric_offset_ms?: number }>(
        'SELECT bluetooth_lyric_offset_ms FROM app_state WHERE id = 1;'
      );
      return typeof row?.bluetooth_lyric_offset_ms === 'number' ? row.bluetooth_lyric_offset_ms : 0;
    } catch {
      return 0;
    }
  }

  static async setBluetoothLyricOffset(offsetMs: number): Promise<void> {
    try {
      const db = await getDatabaseAsync();
      try {
        await db.execAsync('ALTER TABLE app_state ADD COLUMN bluetooth_lyric_offset_ms INTEGER NOT NULL DEFAULT 0;');
      } catch {}
      await db.runAsync(
        'UPDATE app_state SET bluetooth_lyric_offset_ms = ? WHERE id = 1;',
        [offsetMs]
      );
    } catch {}
  }

  static async getVocalEffectsLevel(): Promise<number> {
    try {
      const db = await getDatabaseAsync();
      const row = await db.getFirstAsync<{ vocal_effects_level?: number }>(
        'SELECT vocal_effects_level FROM app_state WHERE id = 1;'
      );
      return Number.isFinite(row?.vocal_effects_level) ? Math.max(0, Math.min(3, Math.trunc(row!.vocal_effects_level!))) : 1;
    } catch {
      return 1;
    }
  }

  static async setVocalEffectsLevel(level: number): Promise<void> {
    if (!Number.isFinite(level)) throw new Error('Invalid vocal effects level');
    const db = await getDatabaseAsync();
    await db.runAsync(
      'UPDATE app_state SET vocal_effects_level = ? WHERE id = 1;',
      [Math.max(0, Math.min(3, Math.trunc(level)))]
    );
  }

  static async getMusicVolume(): Promise<number> {
    try {
      const db = await getDatabaseAsync();
      const row = await db.getFirstAsync<{ music_volume?: number }>(
        'SELECT music_volume FROM app_state WHERE id = 1;'
      );
      return Number.isFinite(row?.music_volume) ? Math.max(0.0, Math.min(1.0, row!.music_volume!)) : 1.0;
    } catch {
      return 1.0;
    }
  }

  static async setMusicVolume(volume: number): Promise<void> {
    if (!Number.isFinite(volume)) throw new Error('Invalid music volume');
    const clamped = Math.max(0.0, Math.min(1.0, volume));
    const db = await getDatabaseAsync();
    await db.runAsync(
      'UPDATE app_state SET music_volume = ? WHERE id = 1;',
      [clamped]
    );
  }
}
