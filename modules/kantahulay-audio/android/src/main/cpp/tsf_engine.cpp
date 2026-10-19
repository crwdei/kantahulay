#include "tsf_engine.hpp"

#define TSF_IMPLEMENTATION
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wnull-pointer-subtraction"
#include "tsf.h"
#pragma clang diagnostic pop

#include <algorithm>
#include <cstring>

namespace kantahulay {

TsfEngine::TsfEngine() = default;

TsfEngine::~TsfEngine() {
    if (synth_) {
        tsf_close(synth_);
        synth_ = nullptr;
    }
}

void TsfEngine::silence_all() {
    if (!synth_) return;
    for (int ch = 0; ch < 16; ++ch) {
        tsf_channel_sounds_off_all(synth_, ch);
    }
    for (int i = 0; i < synth_->voiceNum; ++i) {
        synth_->voices[i].playingPreset = -1;
    }
}

bool TsfEngine::init(int sample_rate) {
    if (sample_rate <= 240) return false;
    sample_rate_ = sample_rate;
    if (synth_) {
        tsf_set_output(synth_, TSF_STEREO_INTERLEAVED, sample_rate_, 0.0f);
    }
    return true;
}

bool TsfEngine::load_soundfont(const char* filepath) {
    if (synth_) {
        tsf_close(synth_);
        synth_ = nullptr;
    }
    synth_ = tsf_load_filename(filepath);
    if (!synth_) return false;

    tsf_set_output(synth_, TSF_STEREO_INTERLEAVED, sample_rate_, 0.0f);
    tsf_set_max_voices(synth_, 64);
    reset_channels();
    return true;
}

bool TsfEngine::load_soundfont_memory(const uint8_t* data, size_t size) {
    if (synth_) {
        tsf_close(synth_);
        synth_ = nullptr;
    }
    synth_ = tsf_load_memory(data, static_cast<int>(size));
    if (!synth_) return false;

    tsf_set_output(synth_, TSF_STEREO_INTERLEAVED, sample_rate_, 0.0f);
    tsf_set_max_voices(synth_, 64);
    reset_channels();
    return true;
}

void TsfEngine::note_on(int channel, int key, int velocity) {
    if (!synth_ || channel < 0 || channel >= 16) return;
    if (velocity > 0) {
        tsf_channel_note_on(synth_, channel, key, velocity / 127.0f);
    } else {
        tsf_channel_note_off(synth_, channel, key);
    }
}

void TsfEngine::note_off(int channel, int key) {
    if (!synth_ || channel < 0 || channel >= 16) return;
    tsf_channel_note_off(synth_, channel, key);
}

void TsfEngine::cc(int channel, int num, int val) {
    if (!synth_ || channel < 0 || channel >= 16) return;
    tsf_channel_midi_control(synth_, channel, num, val);
    if (num == 121 && channel != 9 && key_offset_ != 0) {
        tsf_channel_set_tuning(synth_, channel, static_cast<float>(key_offset_));
    }
}

void TsfEngine::program_change(int channel, int program) {
    if (!synth_ || channel < 0 || channel >= 16) return;
    tsf_channel_set_presetnumber(synth_, channel, program, (channel == 9));
}

void TsfEngine::bank_select(int channel, int bank) {
    if (!synth_ || channel < 0 || channel >= 16) return;
    tsf_channel_set_bank(synth_, channel, bank);
}

void TsfEngine::pitch_bend(int channel, int bend) {
    if (!synth_ || channel < 0 || channel >= 16) return;
    tsf_channel_set_pitchwheel(synth_, channel, bend);
}

void TsfEngine::sysex(const uint8_t* /*data*/, size_t /*size*/) {
    // TSF does not process SysEx
}

void TsfEngine::set_key_offset(int semitones) {
    key_offset_ = std::clamp(semitones, -6, 6);
    if (!synth_) return;
    for (int ch = 0; ch < 16; ++ch) {
        if (ch != 9) {
            tsf_channel_set_tuning(synth_, ch, static_cast<float>(key_offset_));
        } else {
            tsf_channel_set_tuning(synth_, ch, 0.0f);
        }
    }
}

void TsfEngine::all_sounds_off(int channel) {
    if (!synth_) return;
    if (channel < 0) {
        silence_all();
    } else if (channel < 16) {
        tsf_channel_sounds_off_all(synth_, channel);
    }
}

void TsfEngine::reset_channels() {
    if (!synth_) return;
    silence_all();
    for (int ch = 0; ch < 16; ++ch) {
        tsf_channel_midi_control(synth_, ch, 121, 0); // Reset all controllers
        tsf_channel_set_bank(synth_, ch, (ch == 9 ? 128 : 0));
        tsf_channel_set_presetnumber(synth_, ch, 0, (ch == 9));
        tsf_channel_set_sustain(synth_, ch, 0);
        tsf_channel_set_pitchwheel(synth_, ch, 8192);
        tsf_channel_set_pan(synth_, ch, 0.5f);
        tsf_channel_midi_control(synth_, ch, 1, 0);   // Modulation = 0
        tsf_channel_midi_control(synth_, ch, 7, 100); // Standard GM channel volume: 100/127
        tsf_channel_midi_control(synth_, ch, 39, 127);// Reset fine volume between songs
        tsf_channel_midi_control(synth_, ch, 10, 64); // Pan center = 64
        tsf_channel_midi_control(synth_, ch, 42, 0);  // Reset fine pan between songs
        tsf_channel_midi_control(synth_, ch, 11, 127);// Expression = 127
        tsf_channel_midi_control(synth_, ch, 64, 0);  // Sustain = 0
        tsf_channel_set_tuning(synth_, ch, (ch == 9 ? 0.0f : static_cast<float>(key_offset_)));
    }
}

void TsfEngine::reset() {
    reset_channels();
}

void TsfEngine::set_gain(float gain) {
    if (synth_) {
        tsf_set_volume(synth_, gain);
    }
}

void TsfEngine::set_reverb(bool /*active*/) {}
void TsfEngine::set_chorus(bool /*active*/) {}

void TsfEngine::render(float* interleaved_stereo, int frames) {
    if (!synth_ || !interleaved_stereo || frames <= 0) return;
    tsf_render_float(synth_, interleaved_stereo, frames, 0);
}

} // namespace kantahulay
