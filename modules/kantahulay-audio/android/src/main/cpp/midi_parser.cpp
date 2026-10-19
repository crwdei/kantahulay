#include "midi_parser.hpp"
#include <algorithm>
#include <cstring>

namespace kantahulay {

bool MidiParser::read_vlq(const uint8_t* data, size_t size, size_t& offset, uint32_t& value) {
    value = 0;
    for (int i = 0; i < 4; ++i) {
        if (offset >= size) return false;
        const uint8_t b = data[offset++];
        value = (value << 7) | (b & 0x7F);
        if (!(b & 0x80)) return true;
    }
    return false;
}

static std::string sanitize_to_utf8(const uint8_t* bytes, size_t len) {
    std::string out;
    out.reserve(len * 2);
    size_t i = 0;
    while (i < len) {
        uint8_t b = bytes[i];
        if (b < 0x80) {
            out.push_back(static_cast<char>(b));
            i++;
        } else if ((b & 0xE0) == 0xC0 && i + 1 < len && (bytes[i + 1] & 0xC0) == 0x80) {
            out.push_back(static_cast<char>(b));
            out.push_back(static_cast<char>(bytes[i + 1]));
            i += 2;
        } else if ((b & 0xF0) == 0xE0 && i + 2 < len &&
                   (bytes[i + 1] & 0xC0) == 0x80 && (bytes[i + 2] & 0xC0) == 0x80) {
            out.push_back(static_cast<char>(b));
            out.push_back(static_cast<char>(bytes[i + 1]));
            out.push_back(static_cast<char>(bytes[i + 2]));
            i += 3;
        } else if ((b & 0xF8) == 0xF0 && i + 3 < len &&
                   (bytes[i + 1] & 0xC0) == 0x80 && (bytes[i + 2] & 0xC0) == 0x80 && (bytes[i + 3] & 0xC0) == 0x80) {
            out.push_back(static_cast<char>(b));
            out.push_back(static_cast<char>(bytes[i + 1]));
            out.push_back(static_cast<char>(bytes[i + 2]));
            out.push_back(static_cast<char>(bytes[i + 3]));
            i += 4;
        } else {
            // Single-byte CP1252 / ISO-8859-1 conversion to valid UTF-8
            if (b >= 0x80 && b <= 0x9F) {
                static const uint16_t cp1252_map[32] = {
                    0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021,
                    0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008D, 0x017D, 0x008F,
                    0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
                    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178
                };
                uint16_t cp = cp1252_map[b - 0x80];
                if (cp < 0x80) {
                    out.push_back(static_cast<char>(cp));
                } else if (cp < 0x800) {
                    out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
                    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
                } else {
                    out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
                    out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
                    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
                }
            } else {
                out.push_back(static_cast<char>(0xC0 | (b >> 6)));
                out.push_back(static_cast<char>(0x80 | (b & 0x3F)));
            }
            i++;
        }
    }
    return out;
}

static uint32_t read_u32_be(const uint8_t* p) {
    return (uint32_t(p[0]) << 24) | (uint32_t(p[1]) << 16) | (uint32_t(p[2]) << 8) | uint32_t(p[3]);
}

static uint16_t read_u16_be(const uint8_t* p) {
    return (uint16_t(p[0]) << 8) | uint16_t(p[1]);
}

bool MidiParser::parse(const uint8_t* data, size_t size, ParsedSong& out_song, std::string* error) {
    out_song = {};
    if (error) error->clear();
    auto fail = [&](const char* message) {
        if (error) *error = message;
        return false;
    };
    ParsedSong song;
    if (!data || size < 14) {
        return false;
    }
    if (std::memcmp(data, "MThd", 4) != 0) {
        return false;
    }

    uint32_t header_len = read_u32_be(data + 4);
    if (header_len < 6 || header_len > size - 8) {
        return false;
    }
    uint16_t format = read_u16_be(data + 8);
    uint16_t num_tracks = read_u16_be(data + 10);
    uint16_t division = read_u16_be(data + 12);

    if (format > 1 || (division & 0x8000) != 0 || division == 0 ||
        num_tracks == 0 || (format == 0 && num_tracks != 1)) {
        return fail("Invalid or unsupported MIDI header");
    }
    song.ppq = division;

    struct RawTrackEvent {
        uint32_t tick;
        uint8_t status;
        uint8_t channel;
        uint8_t data1;
        uint8_t data2;
        std::string text;
        uint8_t meta_type;
    };

    std::vector<RawTrackEvent> all_raw_events;
    std::vector<TempoChange> tempo_map;
    // Default initial tempo: 120 BPM = 500,000 us/quarter
    tempo_map.push_back({0, 500000, 0.0});

    size_t offset = 8 + header_len;
    uint32_t max_song_tick = 0;

    for (uint16_t t = 0; t < num_tracks; ++t) {
        if (offset > size || size - offset < 8 || std::memcmp(data + offset, "MTrk", 4) != 0) {
            return false;
        }
        uint32_t track_len = read_u32_be(data + offset + 4);
        offset += 8;
        if (track_len > size - offset) return false;
        size_t track_end = offset + track_len;

        size_t t_ptr = offset;
        uint32_t track_tick = 0;
        uint8_t running_status = 0;
        bool ended = false;

        while (t_ptr < track_end) {
            uint32_t delta = 0;
            if (!read_vlq(data, track_end, t_ptr, delta)) return fail("Invalid MIDI delta VLQ");
            if (delta > UINT32_MAX - track_tick) return fail("MIDI tick overflow");
            track_tick += delta;
            if (t_ptr >= track_end) return fail("Missing MIDI event");

            uint8_t status = data[t_ptr];
            if (status & 0x80) {
                if (status < 0xF0) running_status = status;
                // Meta and SysEx never replace the last channel running status.
                ++t_ptr;
            } else {
                status = running_status;
            }

            if (status == 0xFF) {
                if (t_ptr >= track_end) return fail("Missing MIDI meta type");
                const uint8_t meta_type = data[t_ptr++];
                uint32_t length = 0;
                if (meta_type >= 0x80 || !read_vlq(data, track_end, t_ptr, length) || length > track_end - t_ptr) {
                    return fail("Invalid or truncated MIDI meta event");
                }
                const uint8_t* meta_bytes = data + t_ptr;
                t_ptr += length;
                if (meta_type == 0x2F) {
                    if (length != 0 || t_ptr != track_end) return fail("Invalid MIDI end-of-track");
                    ended = true;
                    break;
                }
                if (meta_type == 0x51) {
                    if (length != 3) return fail("Invalid MIDI tempo length");
                    const uint32_t us = (uint32_t(meta_bytes[0]) << 16) | (uint32_t(meta_bytes[1]) << 8) | uint32_t(meta_bytes[2]);
                    if (us == 0) return fail("Invalid zero MIDI tempo");
                    tempo_map.push_back({track_tick, us, 0.0});
                } else if ((meta_type == 0x05 || meta_type == 0x01) && length > 0) {
                    std::string text = sanitize_to_utf8(meta_bytes, length);
                    all_raw_events.push_back({track_tick, 0xFF, 0, 0, 0, std::move(text), meta_type});
                }
            } else if (status >= 0x80 && status <= 0xEF) {
                const uint8_t type = status & 0xF0;
                const uint8_t ch = status & 0x0F;
                const size_t length = (type == 0xC0 || type == 0xD0) ? 1 : 2;
                if (length > track_end - t_ptr || data[t_ptr] >= 0x80 || (length == 2 && data[t_ptr + 1] >= 0x80)) {
                    return fail("Invalid or truncated MIDI channel event");
                }
                const uint8_t d1 = data[t_ptr++];
                const uint8_t d2 = length == 2 ? data[t_ptr++] : 0;
                all_raw_events.push_back({track_tick, type, ch, d1, d2, "", 0});
            } else if (status == 0xF0 || status == 0xF7) {
                uint32_t length = 0;
                if (!read_vlq(data, track_end, t_ptr, length) || length > track_end - t_ptr) {
                    return fail("Invalid or truncated MIDI SysEx");
                }
                t_ptr += length;
            } else {
                return fail("Invalid MIDI status or missing running status");
            }
        }
        if (!ended) return fail("Missing MIDI end-of-track");
        if (track_tick > max_song_tick) {
            max_song_tick = track_tick;
        }
        offset = track_end;
    }

    if (offset != size) return fail("Undeclared trailing MIDI data");
    song.total_ticks = max_song_tick;

    // Sort tempo map and calculate cumulative time_ms for each tempo point
    std::sort(tempo_map.begin(), tempo_map.end(), [](const TempoChange& a, const TempoChange& b) {
        return a.tick < b.tick;
    });

    for (size_t i = 1; i < tempo_map.size(); ++i) {
        uint32_t delta_ticks = tempo_map[i].tick - tempo_map[i - 1].tick;
        double delta_ms = (double(delta_ticks) * double(tempo_map[i - 1].us_per_quarter)) / (double(song.ppq) * 1000.0);
        tempo_map[i].time_ms = tempo_map[i - 1].time_ms + delta_ms;
    }

    auto tick_to_ms = [&](uint32_t tick) -> uint32_t {
        size_t idx = 0;
        for (size_t i = 0; i < tempo_map.size(); ++i) {
            if (tempo_map[i].tick <= tick) {
                idx = i;
            } else {
                break;
            }
        }
        uint32_t delta_ticks = tick - tempo_map[idx].tick;
        double delta_ms = (double(delta_ticks) * double(tempo_map[idx].us_per_quarter)) / (double(song.ppq) * 1000.0);
        return uint32_t(tempo_map[idx].time_ms + delta_ms + 0.5);
    };

    song.total_time_ms = tick_to_ms(max_song_tick);

    auto event_priority = [](const RawTrackEvent& ev) -> int {
        if (ev.status == 0xFF) return 10;
        uint8_t status = ev.status & 0xF0;
        if (status == 0xB0 && ev.data1 == 121) return 1; // Reset all controllers
        if (status == 0xB0 && (ev.data1 == 0 || ev.data1 == 32)) return 2; // Bank select
        if (status == 0xC0) return 3; // Program change
        if (status == 0xB0) return 4; // Other CCs (volume, pan, expression)
        if (status == 0xE0) return 5; // Pitch bend
        if (status == 0x80 || (status == 0x90 && ev.data2 == 0)) return 6; // Note off
        if (status == 0x90) return 7; // Note on
        return 8;
    };

    // Sort by tick, then event priority (controllers/presets before notes), preserving source order for equal priority.
    std::stable_sort(all_raw_events.begin(), all_raw_events.end(), [&](const RawTrackEvent& a, const RawTrackEvent& b) {
        if (a.tick != b.tick) {
            return a.tick < b.tick;
        }
        int pa = event_priority(a);
        int pb = event_priority(b);
        if (pa != pb) {
            return pa < pb;
        }
        return false;
    });

    bool next_is_line = false;
    bool next_is_para = false;

    for (const auto& ev : all_raw_events) {
        uint32_t ms = tick_to_ms(ev.tick);
        if (ev.status == 0xFF) {
            // Lyric or text
            std::string t = ev.text;
            if (t.empty() || t[0] == '@') continue;

            // Dedicated newline / carriage return
            if (t == "\r" || t == "\n" || t == "\r\n") {
                next_is_line = true;
                continue;
            }

            bool is_para = next_is_para;
            bool is_line = next_is_line;
            next_is_para = false;
            next_is_line = false;

            if (!t.empty() && t[0] == '\\') {
                is_para = true;
                is_line = true;
                t = t.substr(1);
            } else if (!t.empty() && t[0] == '/') {
                is_line = true;
                t = t.substr(1);
            }

            // Trailing carriage return / newline triggers break on next syllable
            while (!t.empty() && (t.back() == '\r' || t.back() == '\n')) {
                next_is_line = true;
                t.pop_back();
            }

            // Leading carriage return / newline triggers break on this syllable
            while (!t.empty() && (t.front() == '\r' || t.front() == '\n')) {
                is_line = true;
                t.erase(0, 1);
            }

            if (t.empty()) {
                continue;
            }

            song.lyrics.push_back({ev.tick, ms, t, is_line, is_para});
            song.has_singable_lyrics = true;
        } else {
            song.events.push_back({ev.tick, ms, ev.status, ev.channel, ev.data1, ev.data2});
        }
    }

    out_song = std::move(song);
    return true;
}

} // namespace kantahulay
