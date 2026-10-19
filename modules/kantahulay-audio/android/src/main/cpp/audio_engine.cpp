#include "audio_engine.hpp"
#include "tsf_engine.hpp"
#if defined(KANTAHULAY_USE_FLUIDSYNTH) && KANTAHULAY_USE_FLUIDSYNTH
#include "fluidsynth_engine.hpp"
#endif

#if defined(__ANDROID__)
#include "audio_out_oboe.hpp"
#endif

#include <algorithm>
#include <cmath>
#include <cstring>

namespace kantahulay {

AudioEngine& AudioEngine::instance() {
    static AudioEngine engine;
    return engine;
}

AudioEngine::AudioEngine() {
#if defined(KANTAHULAY_USE_FLUIDSYNTH) && KANTAHULAY_USE_FLUIDSYNTH
    synth_ = std::make_unique<FluidSynthEngine>();
#else
    synth_ = std::make_unique<TsfEngine>();
#endif
}

AudioEngine::~AudioEngine() = default;

#ifndef NDEBUG
void AudioEngine::set_synth_engine(std::unique_ptr<ISynthEngine> engine) {
    std::lock_guard<std::mutex> lock(song_mutex_);
    synth_ = std::move(engine);
    if (synth_) {
        synth_->init(sample_rate_);
        synth_->set_key_offset(key_offset_.load());
    }
}
#endif

bool AudioEngine::initialize(int sample_rate) {
    std::lock_guard<std::mutex> lock(song_mutex_);
    if (sample_rate <= 240) return false;

    int old_rate = sample_rate_;
    if (old_rate > 0 && old_rate != sample_rate) {
        uint64_t old_rendered = rendered_frames_.load();
        if (old_rendered > 0) {
            uint64_t new_rendered = (old_rendered * static_cast<uint64_t>(sample_rate)) / static_cast<uint64_t>(old_rate);
            rendered_frames_.store(new_rendered);
        }
    }

    sample_rate_ = sample_rate;
    // First-order low shelf: +2 dB at DC, +1 dB at 120 Hz, unity at high frequencies.
    constexpr double shelf_a = 1.1220184543019633; // 10^(2/40)
    double k = std::tan(std::acos(-1.0) * 120.0 / sample_rate_);
    double normal = 1.0 + k / shelf_a;
    bass_b0_ = static_cast<float>((1.0 + shelf_a * k) / normal);
    bass_b1_ = static_cast<float>((shelf_a * k - 1.0) / normal);
    bass_a1_ = static_cast<float>((k / shelf_a - 1.0) / normal);
    bass_state_[0] = bass_state_[1] = 0.0f;
    output_detector_ = std::exp(-1.0f / (0.020f * sample_rate_));
    output_attack_ = std::exp(-1.0f / (0.010f * sample_rate_));
    output_release_ = std::exp(-1.0f / (0.200f * sample_rate_));
    output_limiter_release_ = std::exp(-1.0f / (0.010f * sample_rate_));
    if (synth_) {
        synth_->init(sample_rate_);
        restore_channel_states();
    }
    return true;
}

void AudioEngine::restore_channel_states() {
    if (!synth_) return;
    synth_->set_key_offset(key_offset_.load());
    applied_shift_ = key_offset_.load();

    for (size_t i = 0; i < event_index_ && i < current_song_.events.size(); ++i) {
        const auto& ev = current_song_.events[i];
        if (ev.status == 0xC0) {
            synth_->program_change(ev.channel, ev.data1);
        } else if (ev.status == 0xB0) {
            if (ev.data1 == 0 || ev.data1 == 32 || ev.data1 == 7 || ev.data1 == 10 || ev.data1 == 11 || ev.data1 == 91) {
                synth_->cc(ev.channel, ev.data1, ev.data2);
            }
        } else if (ev.status == 0xE0) {
            int bend = int(ev.data1) | (int(ev.data2) << 7);
            synth_->pitch_bend(ev.channel, bend);
        }
    }
}

bool AudioEngine::load_soundfont(const uint8_t* sf2_data, size_t sf2_size) {
    std::lock_guard<std::mutex> lock(song_mutex_);
    if (!synth_) return false;
    bool ok = synth_->load_soundfont_memory(sf2_data, sf2_size);
    if (!ok) return false;

    bass_state_[0] = bass_state_[1] = 0.0f;
    output_power_ = 0.0f;
    output_compressor_gain_ = 1.0f;
    output_limiter_gain_ = 1.0f;
    return true;
}

bool AudioEngine::load_soundfont_file(const char* filepath) {
    std::lock_guard<std::mutex> lock(song_mutex_);
    if (!synth_) return false;
    bool ok = synth_->load_soundfont(filepath);
    if (!ok) return false;

    bass_state_[0] = bass_state_[1] = 0.0f;
    output_power_ = 0.0f;
    output_compressor_gain_ = 1.0f;
    output_limiter_gain_ = 1.0f;
    return true;
}

void AudioEngine::begin_preparation(uint32_t generation) {
    std::lock_guard<std::mutex> lock(song_mutex_);
    current_generation_.store(generation);
    preparation_pending_ = true;
    song_ended_.store(false);
    state_.store(AudioPlaybackState::LOADING);
}

bool AudioEngine::prepare_song(const ParsedSong& song, int64_t reservation_id, uint32_t generation) {
    std::lock_guard<std::mutex> lock(song_mutex_);
    if (!preparation_pending_ || generation != current_generation_.load()) return false;
    const bool stay_paused = state_.load() == AudioPlaybackState::PAUSED;
    current_song_ = song;
    preparation_pending_ = false;
    total_time_ms_.store(song.total_time_ms);
    event_index_ = 0;
    rendered_frames_.store(0);
    last_reported_time_ms_.store(0);
    paused_time_ms_.store(0);
    current_time_ms_.store(0);
    current_reservation_id_.store(reservation_id);
    current_generation_.store(generation);
    song_ended_.store(false);
    key_offset_.store(0);
    applied_shift_ = 0;
    state_.store(stay_paused ? AudioPlaybackState::PAUSED : AudioPlaybackState::WAITING_FOR_PLAY);

    bass_state_[0] = bass_state_[1] = 0.0f;
    output_power_ = 0.0f;
    output_compressor_gain_ = 1.0f;
    output_limiter_gain_ = 1.0f;
    if (synth_) {
        synth_->set_key_offset(0);
        synth_->reset_channels();
    }
    return true;
}

void AudioEngine::play() {
    std::lock_guard<std::mutex> lock(song_mutex_);
    if (preparation_pending_ || current_reservation_id_.load() < 0) return;
    AudioPlaybackState expected = AudioPlaybackState::PAUSED;
    if (state_.compare_exchange_strong(expected, AudioPlaybackState::PLAYING)) {
        last_reported_time_ms_.store(paused_time_ms_.load());
        return;
    }
    state_.store(AudioPlaybackState::PLAYING);
}

void AudioEngine::pause() {
    std::lock_guard<std::mutex> lock(song_mutex_);
    if (state_.load() == AudioPlaybackState::PLAYING) {
        uint32_t curr = last_reported_time_ms_.load();
        paused_time_ms_.store(curr);
        state_.store(AudioPlaybackState::PAUSED);
    } else if (state_.load() == AudioPlaybackState::LOADING) {
        paused_time_ms_.store(0);
        state_.store(AudioPlaybackState::PAUSED);
    }
    bass_state_[0] = bass_state_[1] = 0.0f;
    if (synth_) {
        synth_->all_sounds_off(-1);
    }
}

void AudioEngine::stop() {
    std::lock_guard<std::mutex> lock(song_mutex_);
    preparation_pending_ = false;
    song_ended_.store(false);
    state_.store(AudioPlaybackState::WAITING_FOR_PLAY);
    bass_state_[0] = bass_state_[1] = 0.0f;
    output_power_ = 0.0f;
    output_compressor_gain_ = 1.0f;
    output_limiter_gain_ = 1.0f;
    if (synth_) {
        synth_->reset_channels();
    }
    rendered_frames_.store(0);
    last_reported_time_ms_.store(0);
    paused_time_ms_.store(0);
    current_time_ms_.store(0);
    event_index_ = 0;
}

void AudioEngine::set_key_offset(int semitones) {
    int clamped = std::clamp(semitones, -6, 6);
    key_offset_.store(clamped);
}

std::vector<LyricEvent> AudioEngine::get_current_lyrics() {
    std::lock_guard<std::mutex> lock(song_mutex_);
    return current_song_.lyrics;
}

void AudioEngine::reset() {
    std::lock_guard<std::mutex> lock(song_mutex_);
    preparation_pending_ = false;
    state_.store(AudioPlaybackState::IDLE);
    current_song_ = ParsedSong();
    event_index_ = 0;
    rendered_frames_.store(0);
    last_reported_time_ms_.store(0);
    paused_time_ms_.store(0);
    current_time_ms_.store(0);
    current_reservation_id_.store(-1);
    current_generation_.store(0);
    song_ended_.store(false);
    key_offset_.store(0);
    applied_shift_ = -999;
    bass_state_[0] = bass_state_[1] = 0.0f;
    output_power_ = 0.0f;
    output_compressor_gain_ = 1.0f;
    output_limiter_gain_ = 1.0f;
    if (synth_) {
        synth_->reset();
    }
    reset_latency_tracking();
}

uint32_t AudioEngine::get_current_time_ms() {
    AudioPlaybackState st = state_.load();
    if (st == AudioPlaybackState::IDLE) {
        return 0;
    }
    if (st == AudioPlaybackState::PAUSED) {
        return paused_time_ms_.load();
    }

    uint64_t rendered = rendered_frames_.load();
    if (rendered == 0) {
        return 0;
    }

    int sr = sample_rate_;
    if (sr <= 0) sr = 44100;

    double lag_frames = 0.0;
#if defined(__ANDROID__)
    auto est = OboeAudioOutput::instance().get_pipeline_lag(sr);
    std::lock_guard<std::mutex> lock(latency_mutex_);
    if (est.device_id != last_device_id_) {
        last_device_id_ = est.device_id;
        smoothed_lag_frames_ = -1.0;
    }

    if (est.valid) {
        if (smoothed_lag_frames_ < 0.0) {
            smoothed_lag_frames_ = est.lag_frames;
        } else {
            smoothed_lag_frames_ = 0.85 * smoothed_lag_frames_ + 0.15 * est.lag_frames;
        }
        lag_frames = smoothed_lag_frames_;
    } else if (smoothed_lag_frames_ >= 0.0) {
        lag_frames = smoothed_lag_frames_;
    }
#endif

    int64_t lag_int = static_cast<int64_t>(std::round(lag_frames));
    int64_t heard_frames = static_cast<int64_t>(rendered) - lag_int;
    if (heard_frames < 0) {
        heard_frames = 0;
    }

    uint32_t heard_ms = static_cast<uint32_t>((static_cast<uint64_t>(heard_frames) * 1000ULL) / static_cast<uint64_t>(sr));

    if (is_bluetooth_active_.load()) {
        int32_t bt_offset = bluetooth_offset_ms_.load();
        int64_t adjusted = static_cast<int64_t>(heard_ms) + bt_offset;
        heard_ms = static_cast<uint32_t>(std::max<int64_t>(0, adjusted));
    }

    uint32_t last = last_reported_time_ms_.load();
    if (heard_ms < last) {
        heard_ms = last;
    } else {
        last_reported_time_ms_.store(heard_ms);
    }

    current_time_ms_.store(heard_ms);
    return heard_ms;
}

void AudioEngine::reset_latency_tracking() {
    std::lock_guard<std::mutex> lock(latency_mutex_);
    smoothed_lag_frames_ = -1.0;
    last_device_id_ = -1;
}

void AudioEngine::set_effects_level(int level) {
    std::lock_guard<std::mutex> lock(song_mutex_);
    if (synth_) {
        synth_->set_effects_level(level);
    }
}

int AudioEngine::get_effects_level() const {
    if (synth_) {
        return synth_->get_effects_level();
    }
    return 2;
}

void AudioEngine::set_master_gain(float gain) {
    float clamped = std::clamp(gain, 0.0f, 1.0f);
    master_gain_.store(clamped);
}

void AudioEngine::process_output(float* output, int frame_count) {
    // ponytail: fixed shelf/dynamics; add user EQ controls only if tuning is requested.
    // Stereo-linked RMS detector (-21 dBFS threshold); reserve 2.5 dB for reconstructed peaks.
    constexpr float makeup = 2.81838293f;
    constexpr float threshold_power = 0.00794328235f;
    constexpr float ceiling = 0.74989421f;
    for (int i = 0; i < frame_count * 2; i += 2) {
        float left = output[i], right = output[i + 1];
        if (!std::isfinite(left) || !std::isfinite(right)) {
            output[i] = output[i + 1] = 0.0f;
            bass_state_[0] = bass_state_[1] = 0.0f;
            output_power_ = 0.0f;
            output_limiter_gain_ = 1.0f;
            continue;
        }
        float filtered_left = bass_b0_ * left + bass_state_[0];
        float filtered_right = bass_b0_ * right + bass_state_[1];
        bass_state_[0] = bass_b1_ * left - bass_a1_ * filtered_left;
        bass_state_[1] = bass_b1_ * right - bass_a1_ * filtered_right;
        left = filtered_left;
        right = filtered_right;
        float power = 0.5f * (left * left + right * right);
        output_power_ = output_detector_ * output_power_ + (1.0f - output_detector_) * power;
        float target_compression = output_power_ > threshold_power
            ? std::cbrt(threshold_power / output_power_) : 1.0f;
        float coefficient = target_compression < output_compressor_gain_ ? output_attack_ : output_release_;
        output_compressor_gain_ = coefficient * output_compressor_gain_ + (1.0f - coefficient) * target_compression;
        left *= makeup * output_compressor_gain_;
        right *= makeup * output_compressor_gain_;
        float peak = std::max(std::abs(left), std::abs(right));
        float target = peak > ceiling ? ceiling / peak : 1.0f;
        output_limiter_gain_ = target < output_limiter_gain_ ? target
            : output_limiter_release_ * output_limiter_gain_ + (1.0f - output_limiter_release_) * target;
        float gain = master_gain_.load();
        output[i] = std::clamp(left * output_limiter_gain_ * gain, -ceiling, ceiling);
        output[i + 1] = std::clamp(right * output_limiter_gain_ * gain, -ceiling, ceiling);
    }
}

void AudioEngine::render_samples(float* output, int frame_count) {
    if (!output || frame_count <= 0) return;

    if (state_.load() != AudioPlaybackState::PLAYING) {
        std::memset(output, 0, frame_count * 2 * sizeof(float));
        return;
    }

    std::unique_lock<std::mutex> lock(song_mutex_, std::try_to_lock);
    if (!lock.owns_lock() || state_.load() != AudioPlaybackState::PLAYING) {
        std::memset(output, 0, frame_count * 2 * sizeof(float));
        return;
    }

    uint32_t current_ms = static_cast<uint32_t>((rendered_frames_ * 1000) / sample_rate_);
    current_time_ms_.store(current_ms);

    int shift = key_offset_.load();
    if (synth_ && shift != applied_shift_) {
        synth_->set_key_offset(shift);
        applied_shift_ = shift;
    }

    if (!sample_accurate_timing_) {
        // Whole-buffer event dispatch (timing parity with original engine)
        uint32_t current_ms = static_cast<uint32_t>((rendered_frames_ * 1000) / sample_rate_);
        uint64_t next_frames = rendered_frames_ + frame_count;
        uint32_t next_ms = static_cast<uint32_t>((next_frames * 1000) / sample_rate_);
        current_time_ms_.store(current_ms);

        while (event_index_ < current_song_.events.size()) {
            const auto& ev = current_song_.events[event_index_];
            if (ev.time_ms > next_ms) {
                break;
            }

            if (synth_) {
                if (ev.status == 0x90) {
                    if (ev.data2 > 0) synth_->note_on(ev.channel, ev.data1, ev.data2);
                    else synth_->note_off(ev.channel, ev.data1);
                } else if (ev.status == 0x80) {
                    synth_->note_off(ev.channel, ev.data1);
                } else if (ev.status == 0xB0) {
                    synth_->cc(ev.channel, ev.data1, ev.data2);
                } else if (ev.status == 0xC0) {
                    synth_->program_change(ev.channel, ev.data1);
                } else if (ev.status == 0xE0) {
                    int bend = int(ev.data1) | (int(ev.data2) << 7);
                    synth_->pitch_bend(ev.channel, bend);
                }
            }

            event_index_++;
        }

        if (synth_) {
            synth_->render(output, frame_count);
            process_output(output, frame_count);
        } else {
            std::memset(output, 0, frame_count * 2 * sizeof(float));
        }

        rendered_frames_ = next_frames;
        if (event_index_ >= current_song_.events.size() && current_ms >= current_song_.total_time_ms + 500) {
            song_ended_.store(true);
        }
    } else {
        // Sample-accurate block splitting mode
        int frames_rendered = 0;
        while (frames_rendered < frame_count) {
            uint64_t current_buffer_frame = rendered_frames_ + frames_rendered;
            int next_event_offset = frame_count;

            if (event_index_ < current_song_.events.size()) {
                uint64_t ev_sample = (static_cast<uint64_t>(current_song_.events[event_index_].time_ms) * sample_rate_) / 1000;
                if (ev_sample <= current_buffer_frame) {
                    next_event_offset = frames_rendered;
                } else if (ev_sample < rendered_frames_ + frame_count) {
                    next_event_offset = static_cast<int>(ev_sample - rendered_frames_);
                }
            }

            if (next_event_offset == frames_rendered) {
                while (event_index_ < current_song_.events.size()) {
                    const auto& ev = current_song_.events[event_index_];
                    uint64_t ev_sample = (static_cast<uint64_t>(ev.time_ms) * sample_rate_) / 1000;
                    if (ev_sample > current_buffer_frame) {
                        break;
                    }
                    if (synth_) {
                        if (ev.status == 0x90) {
                            if (ev.data2 > 0) synth_->note_on(ev.channel, ev.data1, ev.data2);
                            else synth_->note_off(ev.channel, ev.data1);
                        } else if (ev.status == 0x80) {
                            synth_->note_off(ev.channel, ev.data1);
                        } else if (ev.status == 0xB0) {
                            synth_->cc(ev.channel, ev.data1, ev.data2);
                        } else if (ev.status == 0xC0) {
                            synth_->program_change(ev.channel, ev.data1);
                        } else if (ev.status == 0xE0) {
                            int bend = int(ev.data1) | (int(ev.data2) << 7);
                            synth_->pitch_bend(ev.channel, bend);
                        }
                    }
                    event_index_++;
                }
                continue;
            }

            int sub_frames = next_event_offset - frames_rendered;
            if (sub_frames > 0) {
                if (synth_) {
                    synth_->render(output + frames_rendered * 2, sub_frames);
                } else {
                    std::memset(output + frames_rendered * 2, 0, sub_frames * 2 * sizeof(float));
                }
                frames_rendered += sub_frames;
            }
        }

        if (synth_) {
            process_output(output, frame_count);
        }
        rendered_frames_.fetch_add(frame_count);
        uint64_t rend = rendered_frames_.load();
        uint32_t rend_ms = static_cast<uint32_t>((rend * 1000ULL) / static_cast<uint64_t>(sample_rate_));

        if (event_index_ >= current_song_.events.size() && rend_ms >= current_song_.total_time_ms + 500) {
            song_ended_.store(true);
        }
    }
}

} // namespace kantahulay
