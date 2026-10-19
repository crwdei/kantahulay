#!/usr/bin/env python3
"""Host-side verification of pack generation and raw DEFLATE round-trip."""

import hashlib
import json
import os
import sqlite3
import struct
import zlib

def verify_entry(kf, code, offset, p_size, u_size, expected_sha, pack_file_size):
    assert offset >= 16, f"Invalid offset {offset} for {code}"
    assert p_size > 0, f"Invalid packed_size {p_size} for {code}"
    assert u_size > 0, f"Invalid unpacked_size {u_size} for {code}"
    assert offset + p_size <= pack_file_size, f"Offset bounds overflow for {code}"

    kf.seek(offset)
    compressed_chunk = kf.read(p_size)
    assert len(compressed_chunk) == p_size, f"Failed to read {p_size} bytes for {code}"

    # Inflate raw DEFLATE (wbits = -15)
    decompressor = zlib.decompressobj(wbits=-zlib.MAX_WBITS)
    unpacked = decompressor.decompress(compressed_chunk) + decompressor.flush()

    assert len(unpacked) == u_size, f"Unpacked size mismatch for {code}: expected {u_size}, got {len(unpacked)}"
    actual_sha = hashlib.sha256(unpacked).hexdigest()
    assert actual_sha == expected_sha, f"SHA mismatch for {code}: expected {expected_sha}, got {actual_sha}"
    assert unpacked[:4] == b'MThd', f"Invalid MIDI header for {code}"

def test_pack_roundtrip():
    pack_path = os.path.join('build', 'bundled-library', 'songs.kpak')
    sqlite_path = os.path.join('build', 'bundled-library', 'catalog.sqlite')
    manifest_path = os.path.join('build', 'bundled-library', 'bundle_manifest.json')

    assert os.path.exists(pack_path), f"Missing {pack_path}"
    assert os.path.exists(sqlite_path), f"Missing {sqlite_path}"
    assert os.path.exists(manifest_path), f"Missing {manifest_path}"

    pack_file_size = os.path.getsize(pack_path)
    assert pack_file_size >= 16, f"Pack size under 16 bytes: {pack_file_size}"

    with open(pack_path, 'rb') as kf:
        header = kf.read(16)
        assert len(header) == 16, "Incomplete header"
        magic = header[:8]
        assert magic == b'KANTKPK1', f"Invalid magic: {magic}"
        version, count = struct.unpack('<II', header[8:16])
        assert version == 1, f"Expected version 1, got {version}"
        assert count > 0, f"Entry count must be positive, got {count}"

        # 2. Manifest check
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest = json.load(f)
        assert manifest['pack_format_version'] == 1
        assert manifest['entry_count'] == count
        assert manifest['pack_bytes'] == pack_file_size

        # 3. Catalog SQLite checks
        conn = sqlite3.connect(sqlite_path)
        cur = conn.cursor()

        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='songs';")
        assert cur.fetchone() is not None, "Missing songs table in catalog"

        cur.execute("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_songs_browse';")
        assert cur.fetchone() is not None, "Missing idx_songs_browse in catalog"

        total_rows = cur.execute("SELECT COUNT(*) FROM songs;").fetchone()[0]
        assert total_rows == count, f"Catalog count mismatch: {total_rows} vs {count}"

        # Spot-check first 5, middle 5, last 5
        sample_queries = [
            "SELECT code, title, artist, duration_ticks, has_singable_lyrics, pack_offset, packed_size, unpacked_size, midi_sha256 FROM songs ORDER BY code ASC LIMIT 5;",
            f"SELECT code, title, artist, duration_ticks, has_singable_lyrics, pack_offset, packed_size, unpacked_size, midi_sha256 FROM songs ORDER BY code ASC LIMIT 5 OFFSET {max(0, count // 2 - 2)};",
            "SELECT code, title, artist, duration_ticks, has_singable_lyrics, pack_offset, packed_size, unpacked_size, midi_sha256 FROM songs ORDER BY code DESC LIMIT 5;"
        ]

        verified_samples = 0
        for q in sample_queries:
            rows = cur.execute(q).fetchall()
            for code, title, artist, dur, has_lyrics, offset, p_size, u_size, expected_sha in rows:
                verify_entry(kf, code, offset, p_size, u_size, expected_sha, pack_file_size)
                verified_samples += 1

        conn.close()

    print(f"PASS: Verified pack header, manifest, catalog ({count} entries), and {verified_samples} sample entries round-trip.")

if __name__ == '__main__':
    test_pack_roundtrip()
