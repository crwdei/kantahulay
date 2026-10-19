#include "audio_engine.hpp"
#include <cassert>
#include <iostream>

int main() {
    auto& engine = kantahulay::AudioEngine::instance();
    engine.initialize(48000);
    kantahulay::ParsedSong old_song;
    old_song.total_time_ms = 1000;
    kantahulay::ParsedSong new_song;
    new_song.total_time_ms = 2000;

    engine.begin_preparation(1);
    engine.stop();
    bool stopped_load = engine.prepare_song(old_song, 1, 1);
    assert(!stopped_load);

    engine.begin_preparation(2);
    engine.begin_preparation(3);
    bool stale = engine.prepare_song(old_song, 2, 2);
    assert(!stale);
    bool current = engine.prepare_song(new_song, 3, 3);
    assert(current);
    engine.play();
    stale = engine.prepare_song(old_song, 2, 2);
    assert(!stale);
    assert(engine.get_current_reservation_id() == 3);
    assert(engine.get_total_time_ms() == 2000);
    assert(engine.get_state() == kantahulay::AudioPlaybackState::PLAYING);

    engine.begin_preparation(4);
    engine.pause();
    current = engine.prepare_song(new_song, 4, 4);
    assert(current);
    assert(engine.get_state() == kantahulay::AudioPlaybackState::PAUSED);
    engine.play();
    assert(engine.get_state() == kantahulay::AudioPlaybackState::PLAYING);
    std::cout << "PASS U04 native stale-load cancellation and B05 paused preparation\n";
}
