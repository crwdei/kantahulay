#include "pack_reader.hpp"
#include "sha256.hpp"

#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
static int64_t platform_pread(int fd, void* buf, size_t count, int64_t offset) {
    int64_t cur = _lseeki64(fd, 0, SEEK_CUR);
    if (_lseeki64(fd, offset, SEEK_SET) == -1) return -1;
    int r = _read(fd, buf, static_cast<unsigned int>(count));
    _lseeki64(fd, cur, SEEK_SET);
    return r;
}
#else
#include <unistd.h>
static int64_t platform_pread(int fd, void* buf, size_t count, int64_t offset) {
    return pread(fd, buf, count, offset);
}
#endif

#include <zlib.h>
#include <cstring>
#include <limits>
#include <new>

namespace kantahulay {

std::string PackReader::compute_sha256(const uint8_t* data, size_t size) {
    return Sha256::hash(data, size);
}

bool PackReader::inflate_raw_deflate(
    const uint8_t* compressed,
    size_t compressed_size,
    uint32_t expected_unpacked_size,
    std::vector<uint8_t>& out_midi,
    std::string* error
) {
    out_midi.clear();
    if (error) error->clear();
    auto fail = [&](const char* message) {
        out_midi.clear();
        if (error) *error = message;
        return false;
    };
    constexpr uint32_t MAX_ENTRY_SIZE = 16 * 1024 * 1024;
    if (!compressed || compressed_size == 0 || expected_unpacked_size == 0) {
        return fail("Invalid DEFLATE input or output size");
    }
    if (compressed_size > MAX_ENTRY_SIZE || expected_unpacked_size > MAX_ENTRY_SIZE) {
        return fail("DEFLATE input or output exceeds 16 MiB");
    }
    try {
        out_midi.resize(expected_unpacked_size);
    } catch (const std::bad_alloc&) {
        return fail("DEFLATE allocation failed");
    }

    z_stream strm{};
    strm.next_in = const_cast<Bytef*>(compressed);
    strm.avail_in = static_cast<uInt>(compressed_size);
    strm.next_out = reinterpret_cast<Bytef*>(out_midi.data());
    strm.avail_out = static_cast<uInt>(expected_unpacked_size);

    // -15 = raw DEFLATE (no zlib / gzip header)
    if (inflateInit2(&strm, -15) != Z_OK) {
        return fail("DEFLATE initialization failed");
    }
    int ret = inflate(&strm, Z_FINISH);
    inflateEnd(&strm);
    if (ret != Z_STREAM_END || strm.total_out != expected_unpacked_size || strm.total_in != compressed_size) {
        return fail("Invalid DEFLATE stream or size mismatch");
    }
    return true;
}

bool PackReader::read_entry(
    int fd,
    uint64_t asset_start_offset,
    uint64_t asset_len,
    uint64_t pack_offset,
    uint32_t packed_size,
    uint32_t unpacked_size,
    const std::string& expected_sha256,
    std::vector<uint8_t>& out_midi,
    std::string* error
) {
    out_midi.clear();
    if (error) error->clear();
    auto fail = [&](const char* message) {
        out_midi.clear();
        if (error) *error = message;
        return false;
    };
    constexpr uint32_t MAX_ENTRY_SIZE = 16 * 1024 * 1024;
    if (packed_size > MAX_ENTRY_SIZE || unpacked_size > MAX_ENTRY_SIZE) {
        return fail("Pack entry exceeds 16 MiB");
    }
    if (fd < 0 || pack_offset < 16 || packed_size == 0 || unpacked_size == 0) {
        return fail("Invalid pack entry parameters");
    }
    if (pack_offset > asset_len || packed_size > asset_len - pack_offset) {
        return fail("Pack entry outside asset");
    }
#ifdef _WIN32
    constexpr uint64_t MAX_OFFSET = std::numeric_limits<int64_t>::max();
#else
    constexpr uint64_t MAX_OFFSET = std::numeric_limits<off_t>::max();
#endif
    // Check both the start and exclusive end before narrowing to the OS offset type.
    if (asset_start_offset > MAX_OFFSET || pack_offset > MAX_OFFSET - asset_start_offset ||
        packed_size > MAX_OFFSET - asset_start_offset - pack_offset) {
        return fail("Pack entry exceeds file offset range");
    }
    const int64_t absolute_offset = static_cast<int64_t>(asset_start_offset + pack_offset);
    try {
        std::vector<uint8_t> compressed_buf(packed_size);
        int64_t bytes_read = platform_pread(fd, compressed_buf.data(), packed_size, absolute_offset);
        if (bytes_read != static_cast<int64_t>(packed_size)) {
            return fail("Pack entry read failed or truncated");
        }
        if (!inflate_raw_deflate(compressed_buf.data(), packed_size, unpacked_size, out_midi, error)) {
            return false;
        }
        if (!expected_sha256.empty() && compute_sha256(out_midi.data(), out_midi.size()) != expected_sha256) {
            return fail("Pack entry SHA-256 mismatch");
        }
    } catch (const std::bad_alloc&) {
        return fail("Pack entry allocation failed");
    }
    return true;
}

} // namespace kantahulay
