#!/usr/bin/env python3
"""
Downloads or installs GeneralUser GS SoundFont for Kantahulay.

Official source: S. Christian Collins (https://schristiancollins.com/generaluser.php)

Usage:
    python scripts/download_soundfont.py
    python scripts/download_soundfont.py --file /path/to/GeneralUser_GS.sf2
"""

import argparse
import os
import shutil
import sys
import urllib.request
import zipfile

DEFAULT_URL = "https://www.schristiancollins.com/soundfonts/GeneralUser_GS_1.471.zip"
TARGET_FILENAME = "soundfont-gugs-v2.sf2"


def main():
    parser = argparse.ArgumentParser(description="Install SoundFont for Kantahulay.")
    parser.add_argument("--url", default=DEFAULT_URL, help="SoundFont zip URL")
    parser.add_argument("--file", help="Path to existing .sf2 file to use")
    parser.add_argument(
        "--dest",
        default="sample-pack",
        help="Destination directory (default: sample-pack)",
    )
    args = parser.parse_args()

    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    dest_dir = os.path.join(project_root, args.dest)
    os.makedirs(dest_dir, exist_ok=True)
    target_path = os.path.join(dest_dir, TARGET_FILENAME)

    if args.file:
        src_file = os.path.abspath(args.file)
        if not os.path.exists(src_file):
            print(f"Error: file not found: {src_file}", file=sys.stderr)
            sys.exit(1)
        shutil.copy2(src_file, target_path)
        print(f"Copied {src_file} -> {target_path}")
        return

    print(f"Downloading GeneralUser GS from {args.url} ...")
    tmp_zip = os.path.join(dest_dir, "GeneralUser_temp.zip")
    try:
        urllib.request.urlretrieve(args.url, tmp_zip)
        print("Download complete. Extracting SoundFont...")
        with zipfile.ZipFile(tmp_zip, "r") as zf:
            sf2_entries = [n for n in zf.namelist() if n.lower().endswith(".sf2")]
            if not sf2_entries:
                print("Error: No .sf2 file found in downloaded zip archive.", file=sys.stderr)
                sys.exit(1)
            # Find primary soundfont file
            chosen = sf2_entries[0]
            for e in sf2_entries:
                if "generaluser" in e.lower() and not "live" in e.lower():
                    chosen = e
                    break
            print(f"Extracting {chosen} -> {target_path} ...")
            with zf.open(chosen) as sf_in, open(target_path, "wb") as sf_out:
                shutil.copyfileobj(sf_in, sf_out)
        print(f"SoundFont successfully installed to: {target_path}")
    except Exception as e:
        print(f"Failed to download/extract SoundFont: {e}", file=sys.stderr)
        print("\nManual instructions:")
        print("1. Visit https://schristiancollins.com/generaluser.php")
        print("2. Download GeneralUser GS SoundFont v1.471")
        print(f"3. Copy the .sf2 file to {target_path}")
        sys.exit(1)
    finally:
        if os.path.exists(tmp_zip):
            os.remove(tmp_zip)


if __name__ == "__main__":
    main()
