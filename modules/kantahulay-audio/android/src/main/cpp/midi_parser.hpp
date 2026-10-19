#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <cstddef>

namespace kantahulay {

struct LyricEvent {
    uint32_t tick;
    uint32_t time_ms;
    std::string text;
    bool is_line_break;
    bool is_paragraph_break;
};

struct MidiEvent {
    uint32_t tick;
    uint32_t time_ms;
    uint8_t status;  // 0x90 NoteOn, 0x80 NoteOff, 0xB0 CC, 0xC0 Program, 0xE0 PitchBend
    uint8_t channel;
    uint8_t data1;
    uint8_t data2;
};

struct TempoChange {
    uint32_t tick;
    uint32_t us_per_quarter;
    double time_ms;
};

struct ParsedSong {
    uint16_t ppq = 480;
    uint32_t total_ticks = 0;
    uint32_t total_time_ms = 0;
    bool has_singable_lyrics = false;
    std::vector<LyricEvent> lyrics;
    std::vector<MidiEvent> events;
};

class MidiParser {
public:
    static bool parse(const uint8_t* data, size_t size, ParsedSong& out_song, std::string* error = nullptr);
    
private:
    static bool read_vlq(const uint8_t* data, size_t size, size_t& offset, uint32_t& value);
};

} // namespace kantahulay
