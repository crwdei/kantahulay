#include "../../modules/kantahulay-audio/android/src/main/cpp/midi_parser.hpp"
#include "../../modules/kantahulay-audio/android/src/main/cpp/sha256.hpp"
#include <algorithm>
#include <cassert>
#include <fstream>
#include <iostream>
#include <vector>

std::vector<uint8_t> read_file(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    assert(f.is_open() && "Failed to open file");
    return std::vector<uint8_t>((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
}

int main() {
    std::cout << "Running C++ host tests for kantahulay-audio..." << std::endl;

    // 1. Test Sha256 implementation
    const char* test_str = "hello kantahulay";
    std::string h = kantahulay::Sha256::hash(reinterpret_cast<const uint8_t*>(test_str), 16);
    // sha256("hello kantahulay") = c9ffea39265893a408719cbbd50b40eb93ea47e224e772f07ab3ebf7495b6cb1
    assert(!h.empty());
    assert(h.length() == 64);
    std::cout << "  Sha256 check passed: " << h << std::endl;

    // Same-tick newline and first syllable must retain their MIDI source order.
    std::vector<uint8_t> notes, track;
    for (int i = 0; i < 64; ++i) {
        notes.insert(notes.end(), {60, 0x90, 60, 100, 30, 0x80, 60, 0});
        track.insert(track.end(), {60, 0xFF, 5, 1, '\r',
                                   0, 0xFF, 5, 2, 'M', 'u',
                                   30, 0xFF, 5, 3, 'l', 'a', ' '});
    }
    notes.insert(notes.end(), {0, 0xFF, 0x2F, 0});
    track.insert(track.end(), {0, 0xFF, 0x2F, 0});
    std::vector<uint8_t> timed = {'M', 'T', 'h', 'd', 0, 0, 0, 6,
                                 0, 1, 0, 2, 0, 120};
    for (const auto* chunk : {&notes, &track}) {
        timed.insert(timed.end(), {'M', 'T', 'r', 'k'});
        for (int shift = 24; shift >= 0; shift -= 8) {
            timed.push_back(static_cast<uint8_t>(chunk->size() >> shift));
        }
        timed.insert(timed.end(), chunk->begin(), chunk->end());
    }
    kantahulay::ParsedSong ordered;
    assert(kantahulay::MidiParser::parse(timed.data(), timed.size(), ordered));
    assert(ordered.lyrics.size() == 128);
    for (size_t i = 0; i < 64; ++i) {
        const auto& first = ordered.lyrics[i * 2];
        const auto& second = ordered.lyrics[i * 2 + 1];
        assert(first.text == "Mu" && second.text == "la ");
        assert(first.is_line_break && !second.is_line_break && "Newline moved inside Mula");
        assert(first.time_ms == 250 + i * 375 && second.time_ms == 375 + i * 375);
    }
    std::cout << "  Same-tick newline ordering and syllable timestamps passed." << std::endl;

    // Same-tick syllable followed by trailing newline ([syllable, \r] as in #040019)
    // Must NOT break the current syllable; must break on the following syllable.
    std::vector<uint8_t> track_trailing;
    for (int i = 0; i < 64; ++i) {
        track_trailing.insert(track_trailing.end(), {60, 0xFF, 5, 2, 'M', 'u',
                                                     30, 0xFF, 5, 3, 'l', 'a', ' ',
                                                     0,  0xFF, 5, 1, '\r'});
    }
    track_trailing.insert(track_trailing.end(), {0, 0xFF, 0x2F, 0});
    std::vector<uint8_t> timed_trailing = {'M', 'T', 'h', 'd', 0, 0, 0, 6,
                                           0, 1, 0, 2, 0, 120};
    for (const auto* chunk : {&notes, &track_trailing}) {
        timed_trailing.insert(timed_trailing.end(), {'M', 'T', 'r', 'k'});
        for (int shift = 24; shift >= 0; shift -= 8) {
            timed_trailing.push_back(static_cast<uint8_t>(chunk->size() >> shift));
        }
        timed_trailing.insert(timed_trailing.end(), chunk->begin(), chunk->end());
    }
    kantahulay::ParsedSong ordered_trailing;
    assert(kantahulay::MidiParser::parse(timed_trailing.data(), timed_trailing.size(), ordered_trailing));
    assert(ordered_trailing.lyrics.size() == 128);
    for (size_t i = 0; i < 64; ++i) {
        const auto& first = ordered_trailing.lyrics[i * 2];
        const auto& second = ordered_trailing.lyrics[i * 2 + 1];
        assert(first.text == "Mu" && second.text == "la ");
        // First phrase in file has no prior newline, following phrases break on 'Mu'
        if (i == 0) {
            assert(!first.is_line_break);
        } else {
            assert(first.is_line_break && "Trailing newline failed to break next phrase on Mu");
        }
        assert(!second.is_line_break && "Trailing newline broke inside Mula before second syllable");
    }
    std::cout << "  Same-tick trailing newline [syllable, \\r] passed without mid-word breaks." << std::endl;

    // 2. Test MidiParser on 000001 - Bahay Kubo
    std::vector<uint8_t> midi1 = read_file("tests/fixtures/synthetic_songs/000001 - Bahay Kubo - Traditional.mid");
    assert(midi1.size() > 0);

    kantahulay::ParsedSong song1;
    bool ok = kantahulay::MidiParser::parse(midi1.data(), midi1.size(), song1);
    assert(ok && "Failed to parse Bahay Kubo");
    assert(song1.ppq == 480);
    assert(song1.has_singable_lyrics == true);
    assert(song1.lyrics.size() == 8);
    assert(song1.lyrics[0].text == "Ba-");
    assert(song1.lyrics[0].is_line_break == true);
    assert(song1.lyrics[0].is_paragraph_break == true);
    assert(song1.lyrics[4].text == "ka-");
    assert(song1.lyrics[4].is_line_break == true);
    assert(song1.lyrics[4].is_paragraph_break == false);
    assert(song1.events.size() > 0);
    std::cout << "  MidiParser song1 (Bahay Kubo) passed: " 
              << song1.lyrics.size() << " lyrics, " 
              << song1.events.size() << " events, duration_ms: " 
              << song1.total_time_ms << std::endl;

    // 3. Test MidiParser on 000002 - Leron Leron Sinta (.kar)
    std::vector<uint8_t> midi2 = read_file("tests/fixtures/synthetic_songs/000002 - Leron Leron Sinta - Folk.kar");
    kantahulay::ParsedSong song2;
    ok = kantahulay::MidiParser::parse(midi2.data(), midi2.size(), song2);
    assert(ok && "Failed to parse Leron Leron Sinta");
    assert(song2.has_singable_lyrics == true);
    assert(song2.lyrics.size() == 10);
    std::cout << "  MidiParser song2 (Leron Leron Sinta) passed: " 
              << song2.lyrics.size() << " lyrics" << std::endl;

    // 4. Test pitch shifting invariants
    int shift = 4;
    for (const auto& ev : song1.events) {
        if (ev.status == 0x90) { // Note on
            uint8_t note = ev.data1;
            uint8_t shifted;
            if (ev.channel == 9) {
                shifted = note; // Percussion channel NOT shifted
            } else {
                shifted = static_cast<uint8_t>(std::clamp(int(note) + shift, 0, 127));
            }
            if (ev.channel == 9) {
                assert(shifted == note);
            } else {
                assert(shifted == note + shift);
            }
        }
    }
    std::cout << "  Pitch shifting & channel 9 percussion preservation passed." << std::endl;

    // 5. Corrupt / invalid buffer handling
    std::vector<uint8_t> corrupt = { 'N', 'O', 'T', 'M', 'I', 'D', 'I' };
    kantahulay::ParsedSong song_corrupt;
    bool corrupt_ok = kantahulay::MidiParser::parse(corrupt.data(), corrupt.size(), song_corrupt);
    assert(!corrupt_ok && "Corrupt MIDI should fail");
    std::cout << "  Corrupt buffer rejection passed." << std::endl;

    std::cout << "ALL C++ HOST TESTS PASSED!" << std::endl;
    return 0;
}
