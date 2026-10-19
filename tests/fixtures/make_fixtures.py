#!/usr/bin/env python3
"""Generate synthetic legally shareable SMF (Standard MIDI File) fixtures with timed lyrics."""

import os
import struct

def encode_vlq(value: int) -> bytes:
    buf = [value & 0x7F]
    value >>= 7
    while value > 0:
        buf.append((value & 0x7F) | 0x80)
        value >>= 7
    return bytes(reversed(buf))

def build_midi_file(ppq: int, tracks_events: list[list[tuple[int, bytes]]]) -> bytes:
    num_tracks = len(tracks_events)
    header = b'MThd' + struct.pack('>IHHH', 6, 1, num_tracks, ppq)
    track_data = []
    for events in tracks_events:
        t_bytes = bytearray()
        for delta_ticks, event_bytes in events:
            t_bytes.extend(encode_vlq(delta_ticks))
            t_bytes.extend(event_bytes)
        # End of track meta event
        t_bytes.extend(encode_vlq(0))
        t_bytes.extend(b'\xFF\x2F\x00')
        track_data.append(b'MTrk' + struct.pack('>I', len(t_bytes)) + bytes(t_bytes))
    return header + b''.join(track_data)

def make_song(title: str, artist: str, lyrics: list[tuple[int, str]], notes: list[tuple[int, int, int, int]]) -> bytes:
    ppq = 480
    # Track 0: Tempo and conductor track
    # Tempo 120 BPM -> 500,000 us/quarter note -> 0x07A120
    t0 = [
        (0, b'\xFF\x51\x03\x07\xA1\x20'), # 120 BPM
        (0, b'\xFF\x03' + encode_vlq(len(title)) + title.encode('utf-8')),
    ]
    
    # Track 1: Melody + Lyrics
    t1 = []
    # Interleave notes and lyrics
    # Note: (start_tick, duration_ticks, pitch, velocity)
    # Lyric: (tick, text)
    timeline = []
    for tick, text in lyrics:
        payload = b'\xFF\x05' + encode_vlq(len(text.encode('latin1', 'replace'))) + text.encode('latin1', 'replace')
        timeline.append((tick, payload))
    for start_tick, duration_ticks, pitch, vel in notes:
        note_on = bytes([0x90, pitch, vel])
        note_off = bytes([0x80, pitch, 0])
        timeline.append((start_tick, note_on))
        timeline.append((start_tick + duration_ticks, note_off))
    
    timeline.sort(key=lambda x: x[0])
    
    cur_tick = 0
    for tick, ev in timeline:
        delta = max(0, tick - cur_tick)
        t1.append((delta, ev))
        cur_tick = tick
        
    return build_midi_file(ppq, [t0, t1])

def main():
    out_dir = os.path.join(os.path.dirname(__file__), 'synthetic_songs')
    os.makedirs(out_dir, exist_ok=True)
    
    songs = [
        (
            "000001 - Bahay Kubo - Traditional.mid",
            "Bahay Kubo",
            "Traditional",
            [(0, "\\Ba-"), (480, "hay "), (960, "ku-"), (1440, "bo, "), (1920, "/ka-"), (2400, "hit "), (2880, "mun-"), (3360, "ti")],
            [(0, 480, 60, 90), (480, 480, 62, 90), (960, 480, 64, 90), (1440, 480, 65, 90),
             (1920, 480, 67, 90), (2400, 480, 65, 90), (2880, 480, 64, 90), (3360, 960, 60, 90)]
        ),
        (
            "000002 - Leron Leron Sinta - Folk.kar",
            "Leron Leron Sinta",
            "Folk",
            [(0, "\\Le-"), (480, "ron, "), (960, "Le-"), (1440, "ron "), (1920, "/sin-"), (2400, "ta, "), (2880, "bu-"), (3360, "ko ng pa-"), (3840, "pa-"), (4320, "ya")],
            [(0, 480, 64, 85), (480, 480, 64, 85), (960, 480, 65, 85), (1440, 480, 67, 85),
             (1920, 480, 69, 85), (2400, 480, 69, 85), (2880, 480, 67, 85), (3360, 480, 65, 85),
             (3840, 480, 64, 85), (4320, 960, 62, 85)]
        ),
        (
            "000003 - Sitsiritsit - Folk.mid",
            "Sitsiritsit",
            "Folk",
            [(0, "\\Sit-"), (480, "si-"), (960, "rit-"), (1440, "sit, "), (1920, "/a-"), (2400, "li-"), (2880, "bang-"), (3360, "bang")],
            [(0, 480, 67, 95), (480, 480, 67, 95), (960, 480, 67, 95), (1440, 480, 67, 95),
             (1920, 480, 69, 95), (2400, 480, 67, 95), (2880, 480, 65, 95), (3360, 960, 64, 95)]
        ),
        (
            "000004 - Paru-parong Bukid - Traditional.mid",
            "Paru-parong Bukid",
            "Traditional",
            [(0, "\\Pa-"), (480, "ru-"), (960, "pa-"), (1440, "rong "), (1920, "/bu-"), (2400, "kid, "), (2880, "na li-"), (3360, "lipad-lipad")],
            [(0, 480, 60, 80), (480, 480, 64, 80), (960, 480, 67, 80), (1440, 480, 72, 80),
             (1920, 480, 71, 80), (2400, 480, 69, 80), (2880, 480, 67, 80), (3360, 960, 65, 80)]
        ),
        (
            "000005 - Magtanim Ay Di Biro - Work Song.mid",
            "Magtanim Ay Di Biro",
            "Work Song",
            [(0, "\\Mag-"), (480, "ta-"), (960, "nim "), (1440, "ay "), (1920, "/di "), (2400, "bi-"), (2880, "ro, "), (3360, "mag-ha-pong yu-ko")],
            [(0, 480, 60, 88), (480, 480, 60, 88), (960, 480, 60, 88), (1440, 480, 62, 88),
             (1920, 480, 64, 88), (2400, 480, 64, 88), (2880, 480, 62, 88), (3360, 960, 60, 88)]
        ),
    ]
    
    for filename, title, artist, lyrics, notes in songs:
        data = make_song(title, artist, lyrics, notes)
        path = os.path.join(out_dir, filename)
        with open(path, 'wb') as f:
            f.write(data)
        print(f"Generated {filename} ({len(data)} bytes)")

if __name__ == '__main__':
    main()
