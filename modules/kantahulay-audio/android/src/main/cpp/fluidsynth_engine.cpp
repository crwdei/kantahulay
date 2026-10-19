#include "fluidsynth_engine.hpp"
#include <fluidsynth.h>
#include <algorithm>

namespace kantahulay {

FluidSynthEngine::FluidSynthEngine() = default;

FluidSynthEngine::~FluidSynthEngine() {
    destroy_synth();
}

void FluidSynthEngine::destroy_synth() {
    if (synth_) {
        delete_fluid_synth(synth_);
        synth_ = nullptr;
    }
    if (settings_) {
        delete_fluid_settings(settings_);
        settings_ = nullptr;
    }
    sfont_id_ = -1;
}

bool FluidSynthEngine::init(int sample_rate) {
    if (sample_rate <= 240) return false;

    if (synth_ && sample_rate_ == sample_rate) {
        return true;
    }

    if (synth_ && sfont_id_ >= 0) {
        // FluidSynth 2.6.1 allows changing sample rate dynamically without reloading soundfont
        sample_rate_ = sample_rate;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        fluid_synth_set_sample_rate(synth_, static_cast<float>(sample_rate_));
#pragma clang diagnostic pop
        return true;
    }

    sample_rate_ = sample_rate;
    std::string sf_path = last_soundfont_path_;
    destroy_synth();

    settings_ = new_fluid_settings();
    if (!settings_) return false;

    fluid_settings_setnum(settings_, "synth.sample-rate", static_cast<double>(sample_rate_));
    fluid_settings_setint(settings_, "synth.polyphony", 256);
    fluid_settings_setint(settings_, "synth.cpu-cores", 1);
    fluid_settings_setint(settings_, "synth.threadsafe-api", 0);
    fluid_settings_setint(settings_, "synth.reverb.active", reverb_active_ ? 1 : 0);
    fluid_settings_setint(settings_, "synth.chorus.active", chorus_active_ ? 1 : 0);
    fluid_settings_setnum(settings_, "synth.gain", static_cast<double>(gain_));

    synth_ = new_fluid_synth(settings_);
    if (!synth_) {
        delete_fluid_settings(settings_);
        settings_ = nullptr;
        return false;
    }

    // Default 4th-order (cubic) interpolation across all channels
    fluid_synth_set_interp_method(synth_, -1, FLUID_INTERP_4THORDER);

    // Channel 9 (0-indexed) is drum channel
    for (int ch = 0; ch < 16; ++ch) {
        fluid_synth_set_channel_type(synth_, ch, ch == 9 ? CHANNEL_TYPE_DRUM : CHANNEL_TYPE_MELODIC);
    }

    set_effects_level(effects_level_);

    if (!sf_path.empty()) {
        load_soundfont(sf_path.c_str());
    }

    return true;
}

bool FluidSynthEngine::load_soundfont(const char* filepath) {
    if (!filepath) return false;
    if (!synth_) {
        if (!init(sample_rate_)) return false;
    }

    if (sfont_id_ >= 0) {
        fluid_synth_sfunload(synth_, sfont_id_, 1);
        sfont_id_ = -1;
    }

    sfont_id_ = fluid_synth_sfload(synth_, filepath, 1);
    if (sfont_id_ < 0) {
        return false;
    }
    last_soundfont_path_ = filepath;
    reset_channels();
    return true;
}

bool FluidSynthEngine::load_soundfont_memory(const uint8_t* /*data*/, size_t /*size*/) {
    // Soundfonts are loaded from filesystem path
    return false;
}

void FluidSynthEngine::note_on(int channel, int key, int velocity) {
    if (!synth_ || channel < 0 || channel >= 16) return;
    if (velocity > 0) {
        fluid_synth_noteon(synth_, channel, key, velocity);
    } else {
        fluid_synth_noteoff(synth_, channel, key);
    }
}

void FluidSynthEngine::note_off(int channel, int key) {
    if (!synth_ || channel < 0 || channel >= 16) return;
    fluid_synth_noteoff(synth_, channel, key);
}

void FluidSynthEngine::cc(int channel, int num, int val) {
    if (!synth_ || channel < 0 || channel >= 16) return;
    fluid_synth_cc(synth_, channel, num, val);
    if (num == 121 && channel != 9 && key_offset_ != 0) {
        fluid_synth_set_gen(synth_, channel, GEN_COARSETUNE, static_cast<float>(key_offset_));
    }
}

void FluidSynthEngine::program_change(int channel, int program) {
    if (!synth_ || channel < 0 || channel >= 16) return;
    fluid_synth_program_change(synth_, channel, program);
}

void FluidSynthEngine::bank_select(int channel, int bank) {
    if (!synth_ || channel < 0 || channel >= 16) return;
    fluid_synth_bank_select(synth_, channel, bank);
}

void FluidSynthEngine::pitch_bend(int channel, int bend) {
    if (!synth_ || channel < 0 || channel >= 16) return;
    fluid_synth_pitch_bend(synth_, channel, bend);
}

void FluidSynthEngine::sysex(const uint8_t* data, size_t size) {
    if (!synth_ || !data || size == 0) return;
    fluid_synth_sysex(synth_, reinterpret_cast<const char*>(data), static_cast<int>(size), nullptr, nullptr, nullptr, 0);
}

void FluidSynthEngine::set_key_offset(int semitones) {
    key_offset_ = std::clamp(semitones, -6, 6);
    if (!synth_) return;
    for (int ch = 0; ch < 16; ++ch) {
        if (ch != 9) {
            fluid_synth_set_gen(synth_, ch, GEN_COARSETUNE, static_cast<float>(key_offset_));
        } else {
            fluid_synth_set_gen(synth_, ch, GEN_COARSETUNE, 0.0f);
        }
    }
}

void FluidSynthEngine::all_sounds_off(int channel) {
    if (!synth_) return;
    if (channel < 0) {
        fluid_synth_all_sounds_off(synth_, -1);
    } else if (channel < 16) {
        fluid_synth_all_sounds_off(synth_, channel);
    }
}

void FluidSynthEngine::reset_channels() {
    if (!synth_) return;
    fluid_synth_all_sounds_off(synth_, -1);

    for (int ch = 0; ch < 16; ++ch) {
        fluid_synth_cc(synth_, ch, 121, 0); // CC 121 Reset All Controllers
        fluid_synth_cc(synth_, ch, 64, 0);  // Sustain = 0
        fluid_synth_pitch_bend(synth_, ch, 8192); // Pitch wheel center
        fluid_synth_cc(synth_, ch, 10, 64); // Pan center = 64
        fluid_synth_cc(synth_, ch, 7, 100); // Standard GM volume = 100
        fluid_synth_cc(synth_, ch, 11, 127);// Expression = 127
        fluid_synth_cc(synth_, ch, 1, 0);   // Modulation = 0

        if (ch == 9) {
            fluid_synth_set_channel_type(synth_, 9, CHANNEL_TYPE_DRUM);
            fluid_synth_bank_select(synth_, 9, 128);
            fluid_synth_program_change(synth_, 9, 0);
            fluid_synth_set_gen(synth_, 9, GEN_COARSETUNE, 0.0f);
        } else {
            fluid_synth_set_channel_type(synth_, ch, CHANNEL_TYPE_MELODIC);
            fluid_synth_bank_select(synth_, ch, 0);
            fluid_synth_program_change(synth_, ch, 0);
            fluid_synth_set_gen(synth_, ch, GEN_COARSETUNE, static_cast<float>(key_offset_));
        }
    }
}

void FluidSynthEngine::reset() {
    if (synth_) {
        fluid_synth_system_reset(synth_);
    }
    reset_channels();
}

void FluidSynthEngine::set_gain(float gain) {
    gain_ = gain;
    if (synth_) {
        fluid_synth_set_gain(synth_, gain_);
    }
}

void FluidSynthEngine::set_reverb(bool active) {
    reverb_active_ = active;
    if (synth_) {
        fluid_synth_reverb_on(synth_, -1, active ? 1 : 0);
    }
}

void FluidSynthEngine::set_chorus(bool active) {
    chorus_active_ = active;
    if (synth_) {
        fluid_synth_chorus_on(synth_, -1, active ? 1 : 0);
    }
}

void FluidSynthEngine::set_effects_level(int level) {
    effects_level_ = std::clamp(level, 0, 3);
    if (!synth_) return;
    if (effects_level_ == 0) {
        reverb_active_ = false;
        chorus_active_ = false;
        fluid_synth_reverb_on(synth_, -1, 0);
        fluid_synth_chorus_on(synth_, -1, 0);
    } else {
        reverb_active_ = true;
        chorus_active_ = true;
        fluid_synth_reverb_on(synth_, -1, 1);
        fluid_synth_chorus_on(synth_, -1, 1);

        double rev_room = (effects_level_ == 1) ? 0.35 : (effects_level_ == 2 ? 0.55 : 0.80);
        double rev_damp = (effects_level_ == 1) ? 0.50 : (effects_level_ == 2 ? 0.40 : 0.25);
        double rev_width = (effects_level_ == 1) ? 0.60 : (effects_level_ == 2 ? 0.75 : 0.90);
        double rev_level = (effects_level_ == 1) ? 0.35 : (effects_level_ == 2 ? 0.55 : 0.80);

        int cho_nr = (effects_level_ == 3) ? 4 : 3;
        double cho_lvl = (effects_level_ == 1) ? 0.40 : (effects_level_ == 2 ? 0.65 : 0.90);
        double cho_spd = (effects_level_ == 1) ? 0.30 : (effects_level_ == 2 ? 0.35 : 0.45);
        double cho_dep = (effects_level_ == 1) ? 4.0 : (effects_level_ == 2 ? 6.0 : 8.0);

        fluid_synth_set_reverb_group_roomsize(synth_, -1, rev_room);
        fluid_synth_set_reverb_group_damp(synth_, -1, rev_damp);
        fluid_synth_set_reverb_group_width(synth_, -1, rev_width);
        fluid_synth_set_reverb_group_level(synth_, -1, rev_level);

        fluid_synth_set_chorus_group_nr(synth_, -1, cho_nr);
        fluid_synth_set_chorus_group_level(synth_, -1, cho_lvl);
        fluid_synth_set_chorus_group_speed(synth_, -1, cho_spd);
        fluid_synth_set_chorus_group_depth(synth_, -1, cho_dep);
    }
}

void FluidSynthEngine::render(float* interleaved_stereo, int frames) {
    if (!synth_ || !interleaved_stereo || frames <= 0) return;
    fluid_synth_write_float(synth_, frames,
                            interleaved_stereo, 0, 2,
                            interleaved_stereo, 1, 2);
}

} // namespace kantahulay
