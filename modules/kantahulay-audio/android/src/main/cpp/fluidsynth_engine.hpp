#pragma once

#include "synth_engine.hpp"
#include <fluidsynth/types.h>
#include <string>

namespace kantahulay {

class FluidSynthEngine : public ISynthEngine {
public:
    FluidSynthEngine();
    ~FluidSynthEngine() override;

    bool init(int sample_rate) override;
    bool load_soundfont(const char* filepath) override;
    bool load_soundfont_memory(const uint8_t* data, size_t size) override;

    void note_on(int channel, int key, int velocity) override;
    void note_off(int channel, int key) override;
    void cc(int channel, int num, int val) override;
    void program_change(int channel, int program) override;
    void bank_select(int channel, int bank) override;
    void pitch_bend(int channel, int bend) override;
    void sysex(const uint8_t* data, size_t size) override;
    void set_key_offset(int semitones) override;

    void all_sounds_off(int channel = -1) override;
    void reset_channels() override;
    void reset() override;

    void set_gain(float gain) override;
    void set_reverb(bool active) override;
    void set_chorus(bool active) override;
    void set_effects_level(int level) override;
    int get_effects_level() const override { return effects_level_; }

    void render(float* interleaved_stereo, int frames) override;

    const char* get_name() const override { return "FluidSynth"; }

    fluid_synth_t* get_synth() const { return synth_; }

private:
    fluid_settings_t* settings_ = nullptr;
    fluid_synth_t* synth_ = nullptr;
    int sfont_id_ = -1;
    int sample_rate_ = 44100;
    int key_offset_ = 0;
    float gain_ = 0.80f;
    bool reverb_active_ = true;
    bool chorus_active_ = true;
    int effects_level_ = 2; // 0=Off, 1=Low, 2=Medium, 3=High
    std::string last_soundfont_path_;

    void destroy_synth();
};

} // namespace kantahulay
