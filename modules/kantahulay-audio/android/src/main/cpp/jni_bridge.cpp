#include "audio_engine.hpp"
#include "midi_parser.hpp"
#include "pack_reader.hpp"
#if defined(__ANDROID__)
#include "audio_out_oboe.hpp"
#include "jni_safety.hpp"
#include <jni.h>

extern "C" {

JNIEXPORT jboolean JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativeInitialize(JNIEnv* env, jobject /*thiz*/) {
    return kantahulay::jni::guard<jboolean>(env, "nativeInitialize", JNI_FALSE, [&] {
        bool ok = kantahulay::AudioEngine::instance().initialize(44100);
        if (!ok) {
            kantahulay::jni::log_failure("nativeInitialize", "engine initialization failed");
            return JNI_FALSE;
        }
        bool oboe_ok = kantahulay::OboeAudioOutput::instance().start();
        if (!oboe_ok) {
            kantahulay::jni::log_failure("nativeInitialize", "audio output start failed");
            return JNI_FALSE;
        }
        return JNI_TRUE;
    });
}

JNIEXPORT jboolean JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativeLoadSoundFont(
    JNIEnv* env, jobject /*thiz*/, jstring sf2_path
) {
    return kantahulay::jni::guard<jboolean>(env, "nativeLoadSoundFont", JNI_FALSE, [&] {
        kantahulay::jni::UtfChars path(env, sf2_path, "nativeLoadSoundFont");
        if (!path) return JNI_FALSE;
        return kantahulay::AudioEngine::instance().load_soundfont_file(path.get()) ? JNI_TRUE : JNI_FALSE;
    });
}

JNIEXPORT jboolean JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativePrepareSong(
    JNIEnv* env, jobject /*thiz*/,
    jint fd,
    jlong asset_start_offset,
    jlong asset_len,
    jlong pack_offset,
    jint packed_size,
    jint unpacked_size,
    jstring expected_sha256,
    jlong reservation_id,
    jint generation
) {
    return kantahulay::jni::guard<jboolean>(env, "nativePrepareSong", JNI_FALSE, [&] {
        if (fd < 0 || asset_start_offset < 0 || asset_len <= 0 || pack_offset < 0 ||
            packed_size <= 0 || unpacked_size <= 0 || reservation_id < 0 || generation < 0) {
            kantahulay::jni::log_failure("nativePrepareSong", "invalid signed input");
            return JNI_FALSE;
        }
        std::string sha;
        {
            kantahulay::jni::UtfChars sha_chars(env, expected_sha256, "nativePrepareSong");
            if (!sha_chars) return JNI_FALSE;
            sha = sha_chars.get();
        }

        std::vector<uint8_t> midi_data;
        std::string pack_error;
        bool read_ok = kantahulay::PackReader::read_entry(
            fd,
            static_cast<uint64_t>(asset_start_offset),
            static_cast<uint64_t>(asset_len),
            static_cast<uint64_t>(pack_offset),
            static_cast<uint32_t>(packed_size),
            static_cast<uint32_t>(unpacked_size),
            sha,
            midi_data,
            &pack_error
        );
        if (!read_ok) {
            kantahulay::jni::log_failure("nativePrepareSong pack read failed", pack_error.c_str());
            return JNI_FALSE;
        }

        kantahulay::ParsedSong parsed;
        std::string parse_error;
        bool parse_ok = kantahulay::MidiParser::parse(midi_data.data(), midi_data.size(), parsed, &parse_error);
        if (!parse_ok) {
            kantahulay::jni::log_failure("nativePrepareSong MIDI parse failed", parse_error.c_str());
            return JNI_FALSE;
        }

        bool prep_ok = kantahulay::AudioEngine::instance().prepare_song(
            parsed,
            static_cast<int64_t>(reservation_id),
            static_cast<uint32_t>(generation)
        );
        if (!prep_ok) {
            kantahulay::jni::log_failure("nativePrepareSong", "engine preparation rejected");
            return JNI_FALSE;
        }
        return JNI_TRUE;
    });
}

JNIEXPORT void JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativeBeginPreparation(
    JNIEnv* env, jobject /*thiz*/, jint generation
) {
    kantahulay::jni::guard(env, "nativeBeginPreparation", [&] {
        if (generation < 0) {
            kantahulay::jni::log_failure("nativeBeginPreparation", "invalid generation");
            return;
        }
        kantahulay::AudioEngine::instance().begin_preparation(static_cast<uint32_t>(generation));
    });
}

JNIEXPORT void JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativePlay(JNIEnv* env, jobject /*thiz*/) {
    kantahulay::jni::guard(env, "nativePlay", [&] {
        kantahulay::AudioEngine::instance().play();
    });
}

JNIEXPORT void JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativePause(JNIEnv* env, jobject /*thiz*/) {
    kantahulay::jni::guard(env, "nativePause", [&] {
        kantahulay::AudioEngine::instance().pause();
    });
}

JNIEXPORT void JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativeStop(JNIEnv* env, jobject /*thiz*/) {
    kantahulay::jni::guard(env, "nativeStop", [&] {
        kantahulay::AudioEngine::instance().stop();
    });
}

JNIEXPORT void JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativeSetKeyOffset(
    JNIEnv* env, jobject /*thiz*/, jint semitones
) {
    kantahulay::jni::guard(env, "nativeSetKeyOffset", [&] {
        kantahulay::AudioEngine::instance().set_key_offset(semitones);
    });
}

JNIEXPORT jint JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativeGetPlaybackState(JNIEnv* env, jobject /*thiz*/) {
    return kantahulay::jni::guard<jint>(env, "nativeGetPlaybackState", static_cast<jint>(kantahulay::AudioPlaybackState::ERROR), [&] {
        return static_cast<jint>(kantahulay::AudioEngine::instance().get_state());
    });
}

JNIEXPORT jint JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativeGetCurrentTimeMs(JNIEnv* env, jobject /*thiz*/) {
    return kantahulay::jni::guard<jint>(env, "nativeGetCurrentTimeMs", 0, [&] {
        return static_cast<jint>(kantahulay::AudioEngine::instance().get_current_time_ms());
    });
}

JNIEXPORT jboolean JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativeIsSongEnded(JNIEnv* env, jobject /*thiz*/) {
    return kantahulay::jni::guard<jboolean>(env, "nativeIsSongEnded", JNI_FALSE, [&] {
        return kantahulay::AudioEngine::instance().is_song_ended() ? JNI_TRUE : JNI_FALSE;
    });
}

JNIEXPORT jstring JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativeGetLyricsJson(JNIEnv* env, jobject /*thiz*/) {
    return kantahulay::jni::guard<jstring>(env, "nativeGetLyricsJson", nullptr, [&] {
        auto lyrics = kantahulay::AudioEngine::instance().get_current_lyrics();
        std::string json = "[";
        for (size_t i = 0; i < lyrics.size(); ++i) {
            if (i > 0) json += ",";
            json += "{\"text\":\"";
            for (char c : lyrics[i].text) {
                if (c == '"') json += "\\\"";
                else if (c == '\\') json += "\\\\";
                else if (c == '\n') json += "\\n";
                else if (c == '\r') json += "\\r";
                else if (c == '\t') json += "\\t";
                else if (static_cast<unsigned char>(c) < 0x20) {
                    // skip control characters
                } else {
                    json += c;
                }
            }
            json += "\",\"timeMs\":";
            json += std::to_string(lyrics[i].time_ms);
            json += ",\"isLineBreak\":";
            json += lyrics[i].is_line_break ? "true" : "false";
            json += ",\"isParagraphBreak\":";
            json += lyrics[i].is_paragraph_break ? "true" : "false";
            json += "}";
        }
        json += "]";
        return kantahulay::jni::make_jstring_utf16(env, json, "nativeGetLyricsJson");
    });
}

JNIEXPORT jint JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativeGetTotalTimeMs(JNIEnv* env, jobject /*thiz*/) {
    return kantahulay::jni::guard<jint>(env, "nativeGetTotalTimeMs", 0, [&] {
        return static_cast<jint>(kantahulay::AudioEngine::instance().get_total_time_ms());
    });
}

JNIEXPORT void JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativeReset(JNIEnv* env, jobject /*thiz*/) {
    kantahulay::jni::guard(env, "nativeReset", [&] {
        kantahulay::AudioEngine::instance().reset();
    });
}

JNIEXPORT void JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativeSetEffectsLevel(
    JNIEnv* env, jobject /*thiz*/, jint level
) {
    kantahulay::jni::guard(env, "nativeSetEffectsLevel", [&] {
        kantahulay::AudioEngine::instance().set_effects_level(level);
    });
}

JNIEXPORT void JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativeSetMasterGain(
    JNIEnv* env, jobject /*thiz*/, jfloat gain
) {
    kantahulay::jni::guard(env, "nativeSetMasterGain", [&] {
        kantahulay::AudioEngine::instance().set_master_gain(gain);
    });
}

JNIEXPORT jfloat JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativeGetMasterGain(
    JNIEnv* env, jobject /*thiz*/
) {
    return kantahulay::jni::guard(env, "nativeGetMasterGain", 1.0f, [&]() -> jfloat {
        return kantahulay::AudioEngine::instance().get_master_gain();
    });
}

JNIEXPORT jint JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativeGetEffectsLevel(JNIEnv* env, jobject /*thiz*/) {
    return kantahulay::jni::guard<jint>(env, "nativeGetEffectsLevel", 0, [&] {
        return kantahulay::AudioEngine::instance().get_effects_level();
    });
}

JNIEXPORT void JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativeSetBluetoothActive(
    JNIEnv* env, jobject /*thiz*/, jboolean active
) {
    kantahulay::jni::guard(env, "nativeSetBluetoothActive", [&] {
        kantahulay::AudioEngine::instance().set_bluetooth_active(active == JNI_TRUE);
    });
}

JNIEXPORT jboolean JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativeIsBluetoothActive(JNIEnv* env, jobject /*thiz*/) {
    return kantahulay::jni::guard<jboolean>(env, "nativeIsBluetoothActive", JNI_FALSE, [&] {
        return kantahulay::AudioEngine::instance().is_bluetooth_active() ? JNI_TRUE : JNI_FALSE;
    });
}

JNIEXPORT void JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativeSetBluetoothLyricOffsetMs(
    JNIEnv* env, jobject /*thiz*/, jint offset_ms
) {
    kantahulay::jni::guard(env, "nativeSetBluetoothLyricOffsetMs", [&] {
        kantahulay::AudioEngine::instance().set_bluetooth_lyric_offset_ms(offset_ms);
    });
}

JNIEXPORT jint JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativeGetBluetoothLyricOffsetMs(JNIEnv* env, jobject /*thiz*/) {
    return kantahulay::jni::guard<jint>(env, "nativeGetBluetoothLyricOffsetMs", 0, [&] {
        return kantahulay::AudioEngine::instance().get_bluetooth_lyric_offset_ms();
    });
}

JNIEXPORT void JNICALL
Java_com_kantahulay_audio_KantahulayAudioModule_nativeResetLatencyTracking(JNIEnv* env, jobject /*thiz*/) {
    kantahulay::jni::guard(env, "nativeResetLatencyTracking", [&] {
        kantahulay::AudioEngine::instance().reset_latency_tracking();
    });
}

} // extern "C"
#endif
