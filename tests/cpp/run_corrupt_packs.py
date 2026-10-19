"""Host checks against production sources. No app dependencies; build under TMPDIR.

Run: python tests/cpp/run_corrupt_packs.py
Optional: --zlib-dir <existing zlib sources> --asan --group pack|midi|all
CXX/CC may override the default isolated Zig compiler commands.
"""
import argparse
import hashlib
import os
from pathlib import Path
import shlex
import subprocess
import tarfile
import urllib.request


def run(command, cwd):
    print(shlex.join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), cwd=cwd, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zlib-dir", type=Path)
    parser.add_argument("--asan", action="store_true")
    parser.add_argument("--group", choices=("pack", "inflate", "midi", "all"), default="all")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    scratch = Path(os.environ.get("TMPDIR", root / "WORKSPACE")) / "b13-native"
    scratch.mkdir(parents=True, exist_ok=True)
    zlib = args.zlib_dir or scratch / "zlib-1.3.1"
    if not zlib.is_dir():
        if args.zlib_dir:
            parser.error("--zlib-dir must contain zlib C sources")
        archive = scratch / "zlib-1.3.1.tar.gz"
        data = urllib.request.urlopen("https://zlib.net/fossils/zlib-1.3.1.tar.gz", timeout=60).read()
        digest = hashlib.sha256(data).hexdigest()
        if digest != "9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23":
            raise RuntimeError("zlib archive SHA-256 mismatch")
        archive.write_bytes(data)
        with tarfile.open(archive) as source:
            source.extractall(scratch, filter="data")
    zlib = zlib.resolve()
    build = scratch / ("asan" if args.asan else "host")
    build.mkdir(exist_ok=True)
    cc = shlex.split(os.environ.get("CC", "uvx --from ziglang python-zig cc"))
    cxx = shlex.split(os.environ.get("CXX", "uvx --from ziglang python-zig c++"))
    flags = ["-O1" if args.asan else "-O2", "-g", "-UNDEBUG"]
    if args.asan:
        flags += ["-fsanitize=address,undefined", "-fno-omit-frame-pointer"]
    names = "adler32 crc32 deflate trees zutil inflate inftrees inffast"
    for name in names.split():
        run(cc + flags + ["-I", zlib, "-c", zlib / (name + ".c"), "-o", build / (name + ".o")], build)
    cpp = root / "modules/kantahulay-audio/android/src/main/cpp"
    executable = build / ("corrupt-packs.exe" if os.name == "nt" else "corrupt-packs")
    objects = [build / (name + ".o") for name in names.split()]
    run(cxx + flags + ["-std=c++17", "-Wno-nullability-completeness", "-I", zlib, "-I", cpp,
                      root / "tests/cpp/test_corrupt_packs.cpp", cpp / "pack_reader.cpp",
                      cpp / "midi_parser.cpp"] + objects + ["-o", executable], build)
    run([executable, args.group], root)
    baseline = build / ("midi-baseline.exe" if os.name == "nt" else "midi-baseline")
    run(cxx + flags + ["-std=c++17", "-Wno-nullability-completeness", "-I", cpp,
                      root / "tests/cpp/test_midi_parser.cpp", cpp / "midi_parser.cpp", "-o", baseline], build)
    run([baseline], root)


if __name__ == "__main__":
    main()
