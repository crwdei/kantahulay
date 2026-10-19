#pragma once

#include <cstdint>
#include <cstddef>

namespace kantahulay {

class ISynthEngine {
public:
    virtual ~ISynthEngine() = default;

    virtual bool init(int sample_rate) = 0;
    virtual bool load_soundfont(const char* filepath) = 0;
    virtual bool load_soundfont_memory(const uint8_t* data, size_t size) = 0;

    virtual void note_on(int channel, int key, int velocity) = 0;
    virtual void note_off(int channel, int key) = 0;
    virtual void cc(int channel, int num, int val) = 0;
    virtual void program_change(int channel, int program) = 0;
    virtual void bank_select(int channel, int bank) = 0;
    virtual void pitch_bend(int channel, int bend) = 0; // 0..16383, center 8192
    virtual void sysex(const uint8_t* data, size_t size) = 0;
    virtual void set_key_offset(int semitones) = 0; // -6 to +6

    virtual void all_sounds_off(int channel = -1) = 0;
    virtual void reset_channels() = 0;
    virtual void reset() = 0;

    virtual void set_gain(float gain) = 0;
    virtual void set_reverb(bool active) = 0;
    virtual void set_chorus(bool active) = 0;
    virtual void set_effects_level(int level) = 0; // 0=Off, 1=Low, 2=Medium, 3=High
    virtual int get_effects_level() const = 0;

    // Renders interleaved stereo float samples
    virtual void render(float* interleaved_stereo, int frames) = 0;

    virtual const char* get_name() const = 0;
};

} // namespace kantahulay
