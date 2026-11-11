#!/usr/bin/env bash
# Rebuild the self-hosted UI font (Pixelify Sans, SIL OFL 1.1) as a small WOFF2 subset:
# Latin, the punctuation the UI uses, and ō for "Komorebi-chō".
#
# Needs fonttools with brotli (python3 -m venv .ft && .ft/bin/pip install fonttools brotli),
# and the source font from github.com/google/fonts (ofl/pixelifysans).
# Usage: scripts/subset-fonts.sh <dir with PixelifySans[wght].ttf> [path to pyftsubset]
# Run it again if the copy in src/i18n/en.ts gains characters outside the ranges below.
set -euo pipefail
SRC=${1:?folder with the source .ttf files}
FT=${2:-pyftsubset}
OUT=src/ui/fonts
mkdir -p "$OUT"

# Latin: printable ASCII, Latin-1, Ō/ō, dashes, quotes, ellipsis, bullet, middle dot
"$FT" "$SRC/PixelifySans[wght].ttf" \
  --unicodes="U+0020-007E,U+00A0-00FF,U+014C-014D,U+2010-2027" \
  --layout-features='*' --flavor=woff2 --output-file="$OUT/pixelify-sans.woff2"
ls -la "$OUT"
