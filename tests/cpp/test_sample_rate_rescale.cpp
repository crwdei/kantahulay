#include <cassert>
#include <iostream>
#define private public
#include "audio_engine.hpp"
#include "tsf_engine.hpp"
#undef private
#include "audio_engine.cpp"
#include "tsf_engine.cpp"

using namespace kantahulay;

int main() {
    AudioEngine& engine = AudioEngine::instance();
    engine.initialize(48000);

    ParsedSong song;
    song.total_time_ms = 60000;
    engine.begin_preparation(1);
    engine.prepare_song(song, 1, 1);
    engine.state_.store(AudioPlaybackState::PLAYING);

    // Simulate 48,000 frames rendered at 48 kHz (= exactly 1,000 ms)
    engine.rendered_frames_.store(48000);
    uint32_t time_before = engine.get_current_time_ms();
    std::cout << "Time at 48kHz (48000 frames): " << time_before << " ms\n";
    assert(time_before == 1000);

    // Reopen stream at 44.1 kHz (e.g. Bluetooth route change)
    engine.initialize(44100);

    uint64_t rescaled_frames = engine.rendered_frames_.load();
    std::cout << "Rescaled frames at 44.1kHz: " << rescaled_frames << " frames\n";
    assert(rescaled_frames == 44100);

    uint32_t time_after = engine.get_current_time_ms();
    std::cout << "Time after switch to 44.1kHz: " << time_after << " ms\n";
    assert(time_after == 1000);

    std::cout << "PASS: B06 sample rate change rescales frames and preserves timeline clock.\n";
    return 0;
}
