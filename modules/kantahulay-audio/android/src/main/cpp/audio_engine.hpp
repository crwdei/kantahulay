#pragma once

#include "midi_parser.hpp"
#include "synth_engine.hpp"
#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace kantahulay {

enum class AudioPlaybackState {
    IDLE = 0,
    LOADING = 1,
    PLAYING = 2,
    PAUSED = 3,
    WAITING_FOR_PLAY = 4,
    ERROR = 5
};

class AudioEngine {
public:
    static AudioEngine& instance();

    bool initialize(int sample_rate = 44100);
    bool load_soundfont(const uint8_t* sf2_data, size_t sf2_size);
    bool load_soundfont_file(const char* filepath);
    
    // Preparation: authorize a generation before dispatching worker I/O.
    void begin_preparation(uint32_t generation);
    bool prepare_song(const ParsedSong& song, int64_t reservation_id, uint32_t generation);
    
    // Transport commands
    void play();
    void pause();
    void stop();
    void set_key_offset(int semitones); // -6 to +6
    
    // Status
    AudioPlaybackState get_state() const { return state_.load(); }
    uint32_t get_current_time_ms();
    uint32_t get_total_time_ms() const { return total_time_ms_.load(); }
    int get_key_offset() const { return key_offset_.load(); }
    int64_t get_current_reservation_id() const { return current_reservation_id_.load(); }
    uint32_t get_current_generation() const { return current_generation_.load(); }
    bool is_song_ended() const { return song_ended_.load(); }

    std::vector<LyricEvent> get_current_lyrics();

    // Render buffer (called by Oboe callback or test harness)
    void render_samples(float* output, int frame_count);

    void reset();

    // Engine swap & timing controls
#ifndef NDEBUG
    void set_synth_engine(std::unique_ptr<ISynthEngine> engine);
#endif
    ISynthEngine* get_synth_engine() const { return synth_.get(); }
    const char* get_synth_engine_name() const { return synth_ ? synth_->get_name() : "None"; }

    void set_sample_accurate_timing(bool enabled) { sample_accurate_timing_ = enabled; }
    bool get_sample_accurate_timing() const { return sample_accurate_timing_; }

    void set_effects_level(int level);
    int get_effects_level() const;

    void set_master_gain(float gain); // 0.0f to 1.0f
    float get_master_gain() const { return master_gain_.load(); }

    // Output latency compensation & Bluetooth controls
    void reset_latency_tracking();
    void restore_channel_states();
    void set_bluetooth_active(bool active) { is_bluetooth_active_.store(active); }
    bool is_bluetooth_active() const { return is_bluetooth_active_.load(); }
    void set_bluetooth_lyric_offset_ms(int32_t offset_ms) { bluetooth_offset_ms_.store(offset_ms); }
    int32_t get_bluetooth_lyric_offset_ms() const { return bluetooth_offset_ms_.load(); }

private:
    AudioEngine();
    ~AudioEngine();

    std::unique_ptr<ISynthEngine> synth_;
    int sample_rate_ = 44100;
    
    std::mutex song_mutex_;
    ParsedSong current_song_;
    size_t event_index_ = 0;
    std::atomic<uint64_t> rendered_frames_{0};
    
    std::atomic<AudioPlaybackState> state_{AudioPlaybackState::IDLE};
    std::atomic<uint32_t> current_time_ms_{0};
    std::atomic<uint32_t> total_time_ms_{0};
    std::atomic<int> key_offset_{0};
    std::atomic<int64_t> current_reservation_id_{-1};
    std::atomic<uint32_t> current_generation_{0};
    bool preparation_pending_ = false;
    std::atomic<bool> song_ended_{false};
    int applied_shift_ = -999;
    bool sample_accurate_timing_ = true;
    std::atomic<float> master_gain_{1.0f};

    // Heard-time clock & Bluetooth sync
    std::atomic<uint32_t> last_reported_time_ms_{0};
    std::atomic<uint32_t> paused_time_ms_{0};
    std::atomic<bool> is_bluetooth_active_{false};
    std::atomic<int32_t> bluetooth_offset_ms_{0};

    std::mutex latency_mutex_;
    double smoothed_lag_frames_ = -1.0;
    int32_t last_device_id_ = -1;

    void process_output(float* output, int frame_count);
    float bass_b0_ = 1.0f, bass_b1_ = 0.0f, bass_a1_ = 0.0f;
    float bass_state_[2] = {};
    float output_power_ = 0.0f;
    float output_compressor_gain_ = 1.0f;
    float output_limiter_gain_ = 1.0f;
    float output_detector_ = 0.0f;
    float output_attack_ = 0.0f;
    float output_release_ = 0.0f;
    float output_limiter_release_ = 0.0f;
};

} // namespace kantahulay
