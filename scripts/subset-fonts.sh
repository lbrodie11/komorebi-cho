#!/usr/bin/env bash
# Rebuild the self-hosted UI fonts (both SIL OFL 1.1) as small WOFF2 subsets.
#
#   Pixelify Sans: Latin, the punctuation the UI uses, and ō for "Komorebi-chō".
#   Noto Sans JP:  only the characters in src/i18n/ja.ts (plus 日本語 on the language button).
#
# Needs fonttools with brotli (python3 -m venv .ft && .ft/bin/pip install fonttools brotli),
# and the source fonts from github.com/google/fonts (ofl/pixelifysans, ofl/notosansjp).
# Usage: scripts/subset-fonts.sh <dir with PixelifySans[wght].ttf and NotoSansJP[wght].ttf> [path to pyftsubset]
# Run it again whenever ja.ts gains characters (tests/i18n.test.ts checks the subset covers them).
set -euo pipefail
SRC=${1:?folder with the source .ttf files}
FT=${2:-pyftsubset}
OUT=src/ui/fonts
BIN=$(dirname "$(command -v "$FT")")
mkdir -p "$OUT"

# Latin: printable ASCII, Latin-1, Ō/ō, dashes, quotes, ellipsis, bullet, middle dot
"$FT" "$SRC/PixelifySans[wght].ttf" \
  --unicodes="U+0020-007E,U+00A0-00FF,U+014C-014D,U+2010-2027" \
  --layout-features='*' --flavor=woff2 --output-file="$OUT/pixelify-sans.woff2"

# Japanese: every character in ja.ts, then trimmed to the two weights the UI uses
TEXT=$(mktemp)
node -e "process.stdout.write([...new Set(require('fs').readFileSync('src/i18n/ja.ts','utf8')+'日本語')].join(''))" > "$TEXT"
TMP=$(mktemp -d)
"$BIN/fonttools" varLib.instancer "$SRC/NotoSansJP[wght].ttf" wght=400:500 -o "$TMP/noto.ttf" -q
"$FT" "$TMP/noto.ttf" --text-file="$TEXT" --layout-features='*' --flavor=woff2 --output-file="$OUT/noto-sans-jp.woff2"
rm -rf "$TMP" "$TEXT"
ls -la "$OUT"
