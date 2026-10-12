#!/bin/bash
# Builds "Session Band.app" next to this script: the notifier session-band uses for
# its cache warning on macOS. Needs Xcode's command line tools (swiftc). The icon is
# taken from the installed Claude.app at build time, not shipped in the repository.
set -euo pipefail
cd "$(dirname "$0")"

APP="Session Band.app"
ICON=/Applications/Claude.app/Contents/Resources/electron.icns
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -swift-version 5 -O -o "$APP/Contents/MacOS/session-band-notifier" Notifier.swift
cp Info.plist "$APP/Contents/Info.plist"
if [ -f "$ICON" ]; then
  cp "$ICON" "$APP/Contents/Resources/AppIcon.icns"
else
  echo "Claude.app not found: the notifier keeps the generic icon" >&2
fi
codesign --force --sign - "$APP"
# A click relaunches the app by its bundle id, so Launch Services must know it.
"$LSREGISTER" -f "$APP"

echo "Built $(pwd)/$APP"
