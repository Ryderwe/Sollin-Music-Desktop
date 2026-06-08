#!/bin/bash
set -euo pipefail

ICON="icon-master.png"
PADDED_ICON="icon-master-padded.png"
ICONSET="icon.iconset"

mkdir -p $ICONSET

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
cd "$SCRIPT_DIR"

swift pad_icon.swift "$ICON" "$PADDED_ICON" 1024 0.88

sips -z 16 16     "$PADDED_ICON" --out "$ICONSET/icon_16x16.png"
sips -z 32 32     "$PADDED_ICON" --out "$ICONSET/icon_16x16@2x.png"
sips -z 32 32     "$PADDED_ICON" --out "$ICONSET/icon_32x32.png"
sips -z 64 64     "$PADDED_ICON" --out "$ICONSET/icon_32x32@2x.png"
sips -z 128 128   "$PADDED_ICON" --out "$ICONSET/icon_128x128.png"
sips -z 256 256   "$PADDED_ICON" --out "$ICONSET/icon_128x128@2x.png"
sips -z 256 256   "$PADDED_ICON" --out "$ICONSET/icon_256x256.png"
sips -z 512 512   "$PADDED_ICON" --out "$ICONSET/icon_256x256@2x.png"
sips -z 512 512   "$PADDED_ICON" --out "$ICONSET/icon_512x512.png"
sips -z 1024 1024 "$PADDED_ICON" --out "$ICONSET/icon_512x512@2x.png"

iconutil -c icns "$ICONSET" -o icon.icns
