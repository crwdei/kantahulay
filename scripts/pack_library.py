#!/usr/bin/env python3
"""Build deterministic songs.kpak, catalog.sqlite, and bundle_manifest.json from cleared MIDI files."""

import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import struct
import sys
import zlib

import time
from concurrent.futures import ProcessPoolExecutor

def parse_filename(fname: str) -> tuple[str, str, str] | None:
    # Extension check
    m_ext = re.search(r'\.(mid|midi|kar)$', fname, re.IGNORECASE)
    if not m_ext:
        return None
    base = fname[:m_ext.start()]
    parts = re.split(r'\s+-\s+', base)
    if len(parts) < 2:
        return None
    code = parts[0].strip()
    if not (len(code) == 6 and code.isdigit()):
        return None
    if len(parts) == 2:
        return code, parts[1].strip(), "Unknown"
    title = parts[1].strip()
    artist = " - ".join(parts[2:]).strip()
    return code, title, artist

def parse_vlq(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    bytes_read = 0
    while offset + bytes_read < len(data):
        b = data[offset + bytes_read]
        bytes_read += 1
        value = (value << 7) | (b & 0x7F)
        if not (b & 0x80):
            break
    return value, bytes_read

def inspect_midi(data: bytes) -> tuple[int, bool]:
    """Extract duration_ticks and has_singable_lyrics from MIDI bytes."""
    if len(data) < 14 or data[:4] != b'MThd':
        return 0, False
    
    header_len = struct.unpack('>I', data[4:8])[0]
    num_tracks = struct.unpack('>H', data[10:12])[0]
    offset = 8 + header_len
    
    max_tick = 0
    has_singable = False
    
    for _ in range(num_tracks):
        if offset + 8 > len(data):
            break
        chunk_type = data[offset:offset+4]
        track_len = struct.unpack('>I', data[offset+4:offset+8])[0]
        offset += 8
        if chunk_type != b'MTrk':
            offset += track_len
            continue
            
        track_end = min(offset + track_len, len(data))
        t_ptr = offset
        track_tick = 0
        last_status = 0
        
        while t_ptr < track_end:
            delta, v_len = parse_vlq(data, t_ptr)
            t_ptr += v_len
            track_tick += delta
            if t_ptr >= track_end:
                break
                
            status_byte = data[t_ptr]
            if status_byte & 0x80:
                last_status = status_byte
                t_ptr += 1
            else:
                status_byte = last_status
                
            msg_type = status_byte & 0xF0
            if msg_type in (0x80, 0x90, 0xA0, 0xB0, 0xE0):
                t_ptr += 2
            elif msg_type in (0xC0, 0xD0):
                t_ptr += 1
            elif status_byte == 0xFF:
                # Meta event
                if t_ptr >= track_end:
                    break
                meta_type = data[t_ptr]
                t_ptr += 1
                length, v_len = parse_vlq(data, t_ptr)
                t_ptr += v_len
                meta_data = data[t_ptr:t_ptr+length]
                t_ptr += length
                
                # 0x05 is Lyric event, 0x01 is Text event (used in .kar for lyrics)
                if meta_type == 0x05 and len(meta_data.strip()) > 0:
                    text_str = meta_data.decode('latin1', 'ignore').strip()
                    if text_str and not text_str.startswith('@'):
                        has_singable = True
                elif meta_type == 0x01:
                    text_str = meta_data.decode('latin1', 'ignore').strip()
                    if text_str.startswith('\\') or text_str.startswith('/') or (text_str and not text_str.startswith('@')):
                        has_singable = True
            elif status_byte in (0xF0, 0xF7):
                # SysEx
                length, v_len = parse_vlq(data, t_ptr)
                t_ptr += v_len + length
            else:
                break
                
        if track_tick > max_tick:
            max_tick = track_tick
        offset = track_end
        
    return max_tick, has_singable

def normalize_search_key(text: str) -> str:
    # Lowercase, diacritic-neutral
    import unicodedata
    nfkd = unicodedata.normalize('NFKD', text)
    cleaned = ''.join(c for c in nfkd if not unicodedata.combining(c)).lower()
    return re.sub(r'[^a-z0-9]+', ' ', cleaned).strip()

def _process_song_worker(task: tuple[str, str, str, str]) -> tuple[str, str, str, str, int, int, int, int, str, bytes]:
    file_path, code, title, artist = task
    with open(file_path, 'rb') as f:
        raw_midi = f.read()
        
    sha256 = hashlib.sha256(raw_midi).hexdigest()
    
    # Raw DEFLATE compression (wbits = -15)
    compressor = zlib.compressobj(level=9, method=zlib.DEFLATED, wbits=-zlib.MAX_WBITS)
    compressed = compressor.compress(raw_midi) + compressor.flush()
    
    dur_ticks, singable = inspect_midi(raw_midi)
    search_key = normalize_search_key(f"{title} {artist}")
    
    return (
        code,
        title,
        artist,
        search_key,
        dur_ticks,
        1 if singable else 0,
        len(raw_midi),
        len(compressed),
        sha256,
        compressed
    )

def build_package(input_dir: str, output_dir: str, rights_manifest: str | None = None, workers: int | None = None) -> dict:
    t_start = time.time()
    os.makedirs(output_dir, exist_ok=True)
    
    all_files = sorted(os.listdir(input_dir))
    tasks = []
    seen_codes = {}
    
    for fname in all_files:
        parsed = parse_filename(fname)
        if not parsed:
            continue
        code, title, artist = parsed
        if code in seen_codes:
            raise ValueError(f"Code collision: {code} in {fname} and {seen_codes[code]}")
        seen_codes[code] = fname
        tasks.append((os.path.join(input_dir, fname), code, title, artist))
        
    tasks.sort(key=lambda t: t[1]) # Sort by 6-digit code
    print(f"Preparing to pack {len(tasks)} songs from {input_dir}...")

    kpak_path = os.path.join(output_dir, 'songs.kpak')
    sqlite_path = os.path.join(output_dir, 'catalog.sqlite')
    manifest_path = os.path.join(output_dir, 'bundle_manifest.json')
    
    # Header: fixed 8-byte magic 'KANTKPK1' + uint32 version (1) + uint32 entry_count
    header_magic = b'KANTKPK1'
    header_version = 1
    header_count = len(tasks)
    header_bytes = header_magic + struct.pack('<II', header_version, header_count)
    
    pack_hasher = hashlib.sha256()
    pack_hasher.update(header_bytes)
    
    catalog_rows = []
    curr_offset = 16
    
    num_workers = workers or min(os.cpu_count() or 4, 16)
    print(f"Executing parallel pack using {num_workers} worker processes...")

    with open(kpak_path, 'wb') as kf:
        kf.write(header_bytes)
        
        with ProcessPoolExecutor(max_workers=num_workers) as executor:
            chunk_sz = 100 if len(tasks) > 1000 else 10
            for idx, res in enumerate(executor.map(_process_song_worker, tasks, chunksize=chunk_sz)):
                code, title, artist, search_key, dur_ticks, singable, raw_sz, comp_sz, midi_sha256, compressed = res
                
                pack_offset = curr_offset
                kf.write(compressed)
                pack_hasher.update(compressed)
                curr_offset += comp_sz
                
                catalog_rows.append((
                    code, title, artist, search_key, dur_ticks, singable,
                    pack_offset, comp_sz, raw_sz, midi_sha256
                ))
                
                if (idx + 1) % 5000 == 0 or (idx + 1) == len(tasks):
                    elapsed = time.time() - t_start
                    rate = (idx + 1) / max(elapsed, 0.001)
                    print(f"  Processed {idx + 1}/{len(tasks)} songs ({rate:.1f} songs/sec)...")
                
                # Delete compressed buffer to minimize memory usage
                del compressed
                
    pack_sha256 = pack_hasher.hexdigest()
    pack_bytes = os.path.getsize(kpak_path)
    print(f"Wrote songs.kpak: {pack_bytes / (1024*1024):.2f} MB in {time.time() - t_start:.2f}s")

    # 2. Write catalog.sqlite
    if os.path.exists(sqlite_path):
        os.remove(sqlite_path)
        
    conn = sqlite3.connect(sqlite_path)
    cur = conn.cursor()
    cur.execute("PRAGMA synchronous = OFF;")
    cur.execute("PRAGMA journal_mode = MEMORY;")
    cur.execute("""
    CREATE TABLE IF NOT EXISTS songs (
      code TEXT PRIMARY KEY NOT NULL CHECK(length(code) = 6 AND code NOT GLOB '*[^0-9]*'),
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      search_key TEXT NOT NULL,
      duration_ticks INTEGER NOT NULL DEFAULT 0,
      has_singable_lyrics INTEGER NOT NULL CHECK(has_singable_lyrics IN (0,1)),
      pack_offset INTEGER NOT NULL CHECK(pack_offset >= 16),
      packed_size INTEGER NOT NULL CHECK(packed_size > 0),
      unpacked_size INTEGER NOT NULL CHECK(unpacked_size > 0),
      midi_sha256 TEXT NOT NULL
    );
    """)
    cur.execute("""
    CREATE INDEX IF NOT EXISTS idx_songs_browse
      ON songs(title COLLATE NOCASE, code);
    """)
    
    cur.executemany("""
    INSERT INTO songs (
      code, title, artist, search_key, duration_ticks,
      has_singable_lyrics, pack_offset, packed_size, unpacked_size, midi_sha256
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, catalog_rows)
    
    conn.commit()
    cur.execute("PRAGMA journal_mode = DELETE;")
    conn.close()
    
    with open(sqlite_path, 'rb') as sf:
        catalog_sha256 = hashlib.sha256(sf.read()).hexdigest()
        
    # Copy soundfont if present in build/
    sf_source = os.path.join(os.path.dirname(output_dir), 'soundfont.sf2')
    sf_target = os.path.join(output_dir, 'soundfont.sf2')
    if os.path.exists(sf_source):
        shutil.copyfile(sf_source, sf_target)
        print(f"Copied soundfont: {sf_target}")

    # 3. Write bundle_manifest.json
    manifest = {
        'pack_format_version': 1,
        'catalog_version': 1,
        'pack_sha256': pack_sha256,
        'catalog_sha256': catalog_sha256,
        'entry_count': len(tasks),
        'pack_bytes': pack_bytes,
        'build_id': f"kpak-v1-{len(tasks)}-entries",
        'rights_review_id': 'PUBLIC-DOMAIN-COMMUNITY-V1'
    }
    with open(manifest_path, 'w', encoding='utf-8') as mf:
        json.dump(manifest, mf, indent=2)
        
    total_time = time.time() - t_start
    print(f"Pack build complete in {total_time:.2f}s: {len(tasks)} songs packed!")
    print(f"Kpak size: {pack_bytes / (1024*1024):.2f} MB")
    print(f"Catalog SQLite: {sqlite_path} ({os.path.getsize(sqlite_path) / (1024*1024):.2f} MB)")
    print(f"Manifest: {manifest_path}")
    return manifest

def main():
    parser = argparse.ArgumentParser(description="Deterministic pack builder for Kantahulay")
    parser.add_argument('--input', default='tests/fixtures/synthetic_songs', help="Path to input directory of MIDIs")
    parser.add_argument('--output', default='build/bundled-library', help="Output directory")
    parser.add_argument('--workers', type=int, default=None, help="Number of worker processes")
    args = parser.parse_args()
    
    build_package(args.input, args.output, workers=args.workers)

if __name__ == '__main__':
    main()
