#include "midi_parser.hpp"
#include "pack_reader.hpp"
#include <zlib.h>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <limits>
#include <vector>
#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#else
#include <unistd.h>
#endif

using namespace kantahulay;
using Bytes = std::vector<uint8_t>;
static constexpr uint32_t MiB = 1024 * 1024;
static size_t checks = 0;

static void check(bool ok, const char* label) {
    ++checks;
    if (!ok) {
        std::cerr << "FAIL: " << label << '\n';
        std::exit(1);
    }
}

static Bytes midi(const Bytes& track = {0, 0x90, 60, 100, 120, 0x80, 60, 0, 0, 0xFF, 0x2F, 0}) {
    Bytes bytes = {'M', 'T', 'h', 'd', 0, 0, 0, 6, 0, 0, 0, 1, 0, 120,
                   'M', 'T', 'r', 'k'};
    for (int shift = 24; shift >= 0; shift -= 8) bytes.push_back(uint8_t(track.size() >> shift));
    bytes.insert(bytes.end(), track.begin(), track.end());
    return bytes;
}

static Bytes deflate_raw(const Bytes& bytes) {
    z_stream stream{};
    int result = deflateInit2(&stream, 9, Z_DEFLATED, -15, 8, Z_DEFAULT_STRATEGY);
    check(result == Z_OK, "zlib compression setup");
    Bytes compressed(deflateBound(&stream, bytes.size()));
    stream.next_in = const_cast<Bytef*>(bytes.data());
    stream.avail_in = static_cast<uInt>(bytes.size());
    stream.next_out = compressed.data();
    stream.avail_out = static_cast<uInt>(compressed.size());
    result = deflate(&stream, Z_FINISH);
    check(result == Z_STREAM_END, "zlib compression complete");
    compressed.resize(stream.total_out);
    deflateEnd(&stream);
    return compressed;
}

struct PackFile {
    FILE* file = nullptr;
    int fd = -1;
    uint64_t start = 31; // Exercise APK asset-relative addressing, not offset zero only.
    uint64_t length = 0;
    explicit PackFile(const Bytes& compressed) {
        file = std::tmpfile();
        check(file != nullptr, "temporary pack file opens");
#ifdef _WIN32
        fd = _fileno(file);
        check(_setmode(fd, _O_BINARY) != -1, "temporary pack binary mode");
#else
        fd = fileno(file);
#endif
        check(fd >= 0, "real valid pack fd");
        Bytes bytes(start, 0xA5);
        bytes.insert(bytes.end(), {'K', 'A', 'N', 'T', 'K', 'P', 'K', '1', 1, 0, 0, 0, 1, 0, 0, 0});
        bytes.insert(bytes.end(), compressed.begin(), compressed.end());
        size_t written = std::fwrite(bytes.data(), 1, bytes.size(), file);
        check(written == bytes.size() && std::fflush(file) == 0, "temporary pack writes");
        length = 16 + compressed.size();
    }
    ~PackFile() { if (file) std::fclose(file); }
};

static void test_pack() {
    Bytes source = midi();
    Bytes compressed = deflate_raw(source);
    PackFile file(compressed);
    Bytes output{1, 2, 3};
    bool ok = PackReader::read_entry(file.fd, file.start, file.length, 16,
                                    uint32_t(compressed.size()), uint32_t(source.size()),
                                    PackReader::compute_sha256(source.data(), source.size()), output);
    check(ok && output == source, "production PackReader valid raw-DEFLATE/SHA roundtrip");
    ParsedSong song;
    ok = MidiParser::parse(output.data(), output.size(), song);
    check(ok && song.events.size() == 2 && song.total_time_ms == 500,
          "roundtrip reaches production MIDI parser");

    auto reject = [&](uint64_t start, uint64_t length, uint64_t offset, uint32_t packed,
                      uint32_t unpacked, const std::string& sha, const char* label) {
        output = {1, 2, 3};
        bool accepted = PackReader::read_entry(file.fd, start, length, offset, packed, unpacked, sha, output);
        check(!accepted, label);
        check(output.empty(), "failed PackReader clears stale output");
    };
    reject(file.start, file.length, UINT64_MAX - 10, 20, 100, "", "relative offset wrap rejected with valid fd");
    reject(file.start, file.length, 16, 17 * MiB, 100, "", "packed allocation cap");
    reject(file.start, file.length, 16, 1, 17 * MiB, "", "unpacked allocation cap");
    reject(file.start, file.length, 15, 1, 1, "", "pack header region rejected");
    reject(file.start, file.length, 16, 0, 1, "", "zero packed size");
    reject(file.start, file.length, 16, 1, 0, "", "zero unpacked size");
    reject(file.start, file.length - 1, 16, uint32_t(compressed.size()), uint32_t(source.size()), "", "asset-relative truncated entry");
    reject(file.start, file.length + 1, 16, uint32_t(compressed.size() + 1), uint32_t(source.size()), "", "physical truncated file");
    reject(file.start, file.length, 16, uint32_t(compressed.size()), uint32_t(source.size()), std::string(64, '0'), "wrong SHA");
    reject(UINT64_MAX - 15, file.length, 16, 1, 1, "", "absolute offset wrap");
    reject(uint64_t(INT64_MAX) - 15, file.length, 16, 1, 1, "", "absolute offset past signed file offset");
    reject(uint64_t(INT64_MAX) - 16, file.length, 16, 1, 1, "", "absolute read end past signed file offset");
    std::string error = "stale";
    ok = PackReader::read_entry(file.fd, uint64_t(INT64_MAX) - 15, file.length, 16, 1, 1, "", output, &error);
    check(!ok && error == "Pack entry exceeds file offset range", "signed file offset guard runs before OS read");
    ok = PackReader::read_entry(file.fd, UINT64_MAX - 15, file.length, 16, 1, 1, "", output, &error);
    check(!ok && error == "Pack entry exceeds file offset range", "absolute wrap guard runs before OS read");
    ok = PackReader::read_entry(file.fd, 0, UINT64_MAX, UINT64_MAX - 10, 20, 1, "", output, &error);
    check(!ok && error == "Pack entry outside asset", "relative wrap guard runs before OS read");
}

static void test_inflate() {
    Bytes source = midi();
    Bytes compressed = deflate_raw(source);
    Bytes output;
    auto reject = [&](const uint8_t* data, size_t length, uint32_t expected, const char* label) {
        output = {1, 2, 3};
        bool accepted = PackReader::inflate_raw_deflate(data, length, expected, output);
        check(!accepted, label);
        check(output.empty(), "failed inflate clears stale output");
    };
    reject(nullptr, compressed.size(), source.size(), "null compressed input");
    reject(compressed.data(), 0, source.size(), "empty compressed input");
    reject(compressed.data(), compressed.size(), 0, "zero inflate output");
    reject(compressed.data(), compressed.size() - 1, source.size(), "truncated DEFLATE");
    reject(compressed.data(), compressed.size(), source.size() - 1, "inflate output larger than declared");
    reject(compressed.data(), compressed.size(), source.size() + 1, "inflate output smaller than declared");
    reject(compressed.data(), compressed.size(), 16 * MiB + 1, "inflate output cap");
    Bytes padded = compressed;
    padded.resize(16 * MiB + 1, 0);
    reject(padded.data(), padded.size(), source.size(), "direct compressed input cap");
    if (sizeof(size_t) > 4) {
        reject(compressed.data(), size_t(UINT32_MAX) + 1 + compressed.size(), source.size(),
               "compressed size cannot narrow through zlib uInt");
    }
    compressed.push_back(0);
    reject(compressed.data(), compressed.size(), source.size(), "trailing DEFLATE garbage");
    Bytes large(16 * MiB, 'A');
    compressed = deflate_raw(large);
    bool ok = PackReader::inflate_raw_deflate(compressed.data(), compressed.size(), large.size(), output);
    check(ok && output == large, "inclusive 16 MiB inflate output boundary");
    large.push_back('A');
    compressed = deflate_raw(large);
    reject(compressed.data(), compressed.size(), 16 * MiB, "DEFLATE bomb cannot exceed output buffer");
    PackFile file(compressed);
    output = {1, 2, 3};
    ok = PackReader::read_entry(file.fd, file.start, file.length, 16, compressed.size(), 16 * MiB, "", output);
    check(!ok && output.empty(), "production read_entry rejects DEFLATE bomb");
}

static void test_midi() {
    ParsedSong song;
    Bytes valid = midi({0, 0xFF, 5, 1, 'x', 0, 0x90, 60, 100, 120, 0x80, 60, 0, 0, 0xFF, 0x2F, 0});
    bool ok = MidiParser::parse(valid.data(), valid.size(), song);
    check(ok && song.events.size() == 2 && song.has_singable_lyrics, "valid MIDI seeds reused output");
    auto reject = [&](const Bytes& bytes, const char* label) {
        song.total_ticks = 100;
        song.total_time_ms = 500;
        song.has_singable_lyrics = true;
        song.events.push_back({0, 0, 0x90, 0, 60, 100});
        song.lyrics.push_back({0, 0, "stale", false, false});
        bool accepted = MidiParser::parse(bytes.data(), bytes.size(), song);
        check(!accepted, label);
        check(song.ppq == 480 && song.total_ticks == 0 && song.total_time_ms == 0 &&
              !song.has_singable_lyrics && song.events.empty() && song.lyrics.empty(),
              "failed MIDI parse clears every output field");
    };
    Bytes corrupt = midi();
    corrupt[21] += 1;
    reject(corrupt, "declared track length cannot clamp to truncated file");
    std::memset(corrupt.data() + 4, 0xFF, 4);
    reject(corrupt, "huge MIDI header length");
    reject(Bytes{'M', 'T', 'h', 'd'}, "truncated MIDI header");
    check(!MidiParser::parse(nullptr, 0, song), "null MIDI data");
    corrupt = midi();
    corrupt[11] = 0;
    reject(corrupt, "zero declared tracks");
    corrupt = midi();
    corrupt[11] = 2;
    reject(corrupt, "format zero cannot declare multiple tracks");
    corrupt[9] = 1;
    reject(corrupt, "missing declared second track");
    corrupt = midi();
    corrupt[12] = 0;
    corrupt[13] = 0;
    reject(corrupt, "zero PPQ division");
    corrupt[12] = 0x80;
    reject(corrupt, "unsupported SMPTE division");
    corrupt = midi();
    corrupt[9] = 2;
    reject(corrupt, "unsupported format two");
    corrupt = midi();
    corrupt[14] = 'X';
    reject(corrupt, "wrong track magic");
    corrupt = midi();
    corrupt.resize(18);
    reject(corrupt, "partial track header");
    corrupt = midi();
    corrupt.push_back(0);
    reject(corrupt, "undeclared trailing MIDI data");
    reject(midi({}), "empty track lacks end-of-track");
    reject(midi({0, 0x90, 60, 100}), "missing end-of-track");
    reject(midi({0x81}), "unterminated delta VLQ");
    reject(midi({0x80, 0x80, 0x80, 0x80, 0, 0xFF, 0x2F, 0}), "five-byte delta VLQ");
    reject(midi({0}), "delta lacks event status");
    reject(midi({0, 0x90, 60}), "truncated two-byte channel event");
    reject(midi({0, 0xC0}), "truncated one-byte channel event");
    reject(midi({0, 0x90, 0x80, 0}), "status byte cannot be channel data one");
    reject(midi({0, 0x90, 60, 0x80}), "status byte cannot be channel data two");
    reject(midi({0, 60, 100}), "running status needs preceding channel event");
    reject(midi({0, 0xF1, 0}), "unsupported system event");
    reject(midi({0, 0xFF}), "meta lacks type");
    reject(midi({0, 0xFF, 5}), "meta lacks length");
    reject(midi({0, 0xFF, 5, 0x81}), "unterminated meta VLQ");
    reject(midi({0, 0xFF, 5, 0x80, 0x80, 0x80, 0x80, 0}), "five-byte meta VLQ");
    reject(midi({0, 0xFF, 5, 2, 'x'}), "truncated meta body");
    reject(midi({0, 0xFF, 0x80, 0}), "meta type must be seven bits");
    reject(midi({0, 0xFF, 0x51, 2, 1, 2, 0, 0xFF, 0x2F, 0}), "tempo length must be three");
    reject(midi({0, 0xFF, 0x51, 3, 0, 0, 0, 0, 0xFF, 0x2F, 0}), "tempo cannot be zero");
    reject(midi({0, 0xFF, 0x2F, 1, 0}), "end-of-track length must be zero");
    reject(midi({0, 0xFF, 0x2F, 0, 0}), "event bytes after end-of-track");
    reject(midi({0, 0xF0}), "SysEx lacks length");
    reject(midi({0, 0xF7, 0x81}), "unterminated SysEx VLQ");
    reject(midi({0, 0xF0, 0x80, 0x80, 0x80, 0x80, 0}), "five-byte SysEx VLQ");
    reject(midi({0, 0xF0, 2, 0x7E}), "truncated SysEx body");

    Bytes running = midi({0, 0x90, 60, 100, 0, 0xFF, 1, 0, 0, 61, 101,
                          0, 0xF0, 1, 0xF7, 0, 62, 102, 0, 0xF7, 0,
                          0, 63, 103, 0, 0xFF, 0x2F, 0});
    ok = MidiParser::parse(running.data(), running.size(), song);
    check(ok && song.events.size() == 4 && song.events[3].data1 == 63,
          "running status survives meta and SysEx without adopting system status");
    valid = midi({0, 0xFF, 0x7F, 0, 0, 0xF0, 0, 0, 0xFF, 0x2F, 0});
    ok = MidiParser::parse(valid.data(), valid.size(), song);
    check(ok && song.events.empty(), "well-formed unknown meta and empty SysEx supported");
}

int main(int argc, char** argv) {
    const std::string group = argc > 1 ? argv[1] : "all";
    if (group == "all" || group == "pack") test_pack();
    if (group == "all" || group == "inflate") test_inflate();
    if (group == "all" || group == "midi") test_midi();
    std::cout << "PASS: production corruption tests (" << checks << " checks, " << group << ")\n";
}

