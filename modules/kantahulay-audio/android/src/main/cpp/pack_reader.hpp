#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <cstddef>

namespace kantahulay {

class PackReader {
public:
    static bool read_entry(
        int fd,
        uint64_t asset_start_offset,
        uint64_t asset_len,
        uint64_t pack_offset,
        uint32_t packed_size,
        uint32_t unpacked_size,
        const std::string& expected_sha256,
        std::vector<uint8_t>& out_midi,
        std::string* error = nullptr
    );

    static bool inflate_raw_deflate(
        const uint8_t* compressed,
        size_t compressed_size,
        uint32_t expected_unpacked_size,
        std::vector<uint8_t>& out_midi,
        std::string* error = nullptr
    );

    static std::string compute_sha256(const uint8_t* data, size_t size);
};

} // namespace kantahulay
