#!/bin/sh
# Package the extension into site/pin-and-click.zip — the file the landing page
# serves as "Add to Chrome".
#
# This runs as the Vercel build command, so the download is rebuilt from source
# on every deploy and can never drift from the extension in that commit. It also
# runs locally, the same way: ./scripts/build-zip.sh
set -e
cd "$(dirname "$0")/.."

FILES="manifest.json content.js content.css popup.html popup.css popup.js background.js README.md"
STAGE=$(mktemp -d)
mkdir -p "$STAGE/pin-and-click"

for f in $FILES; do
  [ -f "$f" ] || { echo "✗ missing $f"; exit 1; }
  cp "$f" "$STAGE/pin-and-click/"
done

mkdir -p site
rm -f site/pin-and-click.zip

# `zip` exists on macOS but isn't guaranteed in a build image; python3 is the fallback.
if command -v zip >/dev/null 2>&1; then
  ( cd "$STAGE" && zip -qr pin-and-click.zip pin-and-click -x '*.DS_Store' )
  mv "$STAGE/pin-and-click.zip" site/pin-and-click.zip
elif command -v python3 >/dev/null 2>&1; then
  python3 - "$STAGE" <<'PY'
import os, sys, zipfile
stage = sys.argv[1]
with zipfile.ZipFile('site/pin-and-click.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(os.path.join(stage, 'pin-and-click')):
        for f in sorted(files):
            if f == '.DS_Store':
                continue
            full = os.path.join(root, f)
            z.write(full, os.path.relpath(full, stage))
PY
else
  echo "✗ need either zip or python3 to package"; exit 1
fi

rm -rf "$STAGE"
[ -s site/pin-and-click.zip ] || { echo "✗ zip is empty"; exit 1; }
echo "✓ site/pin-and-click.zip — $(wc -c < site/pin-and-click.zip | tr -d ' ') bytes"
