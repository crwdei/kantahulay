#!/usr/bin/env bash
# Shell helper to install GeneralUser GS SoundFont for Kantahulay
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python "${SCRIPT_DIR}/download_soundfont.py" "$@"
