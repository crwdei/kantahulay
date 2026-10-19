# Kantahulay Sample Pack

This folder contains a minimal sample song pack for building and testing Kantahulay out-of-the-box.

### Included Content

The sample pack was built using `scripts/pack_library.py` from public-domain traditional folk songs:
1. `000001` — Bahay Kubo (Traditional)
2. `000002` — Leron Leron Sinta (Folk)
3. `000003` — Sitsiritsit (Folk)
4. `000004` — Paru-parong Bukid (Traditional)
5. `000005` — Magtanim Ay Di Biro (Work Song)

### Files

- `songs.kpak`: Uncompressed pack container containing raw DEFLATE-compressed MIDI/KAR sequences with 16-byte header.
- `catalog.sqlite`: Pre-indexed SQLite database table (`songs`) matching the app schema.
- `bundle_manifest.json`: Verification manifest containing catalog and pack SHA-256 digests.

### Making Your Own Song Pack

To build your own song pack with your own MIDI/KAR files:
```bash
python scripts/pack_library.py --input /path/to/midi/folder --output build/bundled-library
```
